import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LegacyFingerprint } from "../../../scripts/academic-year/fingerprint";
import { compareLegacyFingerprints } from "../../../scripts/academic-year/fingerprint";
import { academicYearBounds } from "./calendar";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import { ROSTER_TX } from "./mutation";
import { CONFLICT_GROUPS_CTE, NEEDS_REVIEW_EXPR } from "./roster-sql";

/** 초기 이전 대상 학년도. 운영 DB의 ACTIVE 학년도와 일치해야 실행된다. */
export const INITIAL_ACADEMIC_YEAR = 2026;

export const ACADEMIC_BACKFILL_KEY = String(INITIAL_ACADEMIC_YEAR);

const surveyConfirmationSchema = z.object({
  applicationId: z.number().int().positive(),
  academicYear: z.literal(INITIAL_ACADEMIC_YEAR),
  kind: z.literal("DATELESS_INTENT_SURVEY"),
  expectedApprovedRegistrationCount: z.number().int().nonnegative(),
  expectedTotalRegistrationCount: z.number().int().nonnegative(),
  expectedSourceRowHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const surveyResolutionSchema = surveyConfirmationSchema.omit({ expectedSourceRowHash: true }).extend({
  sourceRowHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceFormat: z.literal("posanmeal-dateless-survey-v1"),
  reason: z.literal("USER_CONFIRMED_DATELESS_INTENT_SURVEY"),
  confirmedAt: z.iso.datetime(),
  registrations: z.array(z.object({ id: z.number().int().positive(), status: z.string() }).strict()),
}).strict();

export type DateLessSurveyConfirmation = z.infer<typeof surveyConfirmationSchema>;
type DateLessSurveyResolution = z.infer<typeof surveyResolutionSchema>;

export function parseDateLessSurveyConfirmations(raw: unknown): DateLessSurveyConfirmation[] {
  const parsed = z.array(surveyConfirmationSchema).min(1).safeParse(raw);
  if (!parsed.success || new Set(parsed.data.map((entry) => entry.applicationId)).size !== parsed.data.length) {
    throw new DomainError("NOT_READY", "희망조사 확인 자료의 형식과 중복 여부를 확인하세요.");
  }
  return parsed.data;
}

type SurveySource = {
  academicYear: number | null;
  applicationDateCount: number;
  registrationDateCount: number;
  registrations: { id: number; status: string }[];
  sourceRowHash: string;
};

export async function captureDateLessSurveySource(db: Db, applicationId: number): Promise<SurveySource | null> {
  const rows = await db.$queryRaw<(Omit<SurveySource, "sourceRowHash"> & { sourceText: string })[]>`
    SELECT a."academicYear",
      (SELECT count(*)::int FROM "MealApplicationMealDate" d WHERE d."applicationId" = a.id) AS "applicationDateCount",
      (SELECT count(*)::int FROM "MealRegistrationMealDate" d
        JOIN "MealRegistration" r ON r.id = d."registrationId" WHERE r."applicationId" = a.id) AS "registrationDateCount",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status) ORDER BY r.id)
        FROM "MealRegistration" r WHERE r."applicationId" = a.id), '[]'::jsonb) AS registrations,
      jsonb_build_array(
        to_jsonb(a) - 'academicYear',
        COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m."mealKind")
          FROM "MealApplicationMeal" m WHERE m."applicationId" = a.id), '[]'::jsonb),
        COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
          FROM "MealRegistration" r WHERE r."applicationId" = a.id), '[]'::jsonb),
        COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m."registrationId", m."mealKind")
          FROM "MealRegistrationMeal" m JOIN "MealRegistration" r ON r.id = m."registrationId"
          WHERE r."applicationId" = a.id), '[]'::jsonb)
      )::text AS "sourceText"
    FROM "MealApplication" a WHERE a.id = ${applicationId}
  `;
  const row = rows[0];
  if (!row) return null;
  const { sourceText, ...source } = row;
  // PostgreSQL 문자열을 직접 해시해 JS Date 변환의 마이크로초 손실을 피한다.
  return { ...source, sourceRowHash: createHash("sha256").update(sourceText, "utf8").digest("hex") };
}

function storedSurveyResolutions(manifest: Prisma.JsonValue | undefined): Prisma.JsonValue | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  return manifest.dateLessSurveyResolutions;
}

function matchesSurveySource(source: SurveySource | null, confirmation: DateLessSurveyConfirmation): source is SurveySource {
  return source !== null
    && (source.academicYear === null || source.academicYear === confirmation.academicYear)
    && source.applicationDateCount === 0 && source.registrationDateCount === 0
    && source.registrations.length === confirmation.expectedTotalRegistrationCount
    && source.registrations.filter((entry) => entry.status === "APPROVED").length === confirmation.expectedApprovedRegistrationCount
    && source.sourceRowHash === confirmation.expectedSourceRowHash;
}

async function validateSurveyResolutions(db: Db, stored: Prisma.JsonValue | undefined) {
  if (stored === undefined) return { accepted: [] as DateLessSurveyResolution[], issues: [] as string[] };
  const parsed = z.array(surveyResolutionSchema).safeParse(stored);
  if (!parsed.success || new Set(parsed.data.map((entry) => entry.applicationId)).size !== parsed.data.length) {
    return { accepted: [], issues: ["DATELESS_SURVEY_EVIDENCE_INVALID:1"] };
  }
  const accepted: DateLessSurveyResolution[] = [];
  let invalid = 0;
  for (const resolution of parsed.data) {
    const source = await captureDateLessSurveySource(db, resolution.applicationId);
    if (matchesSurveySource(source, { ...resolution, expectedSourceRowHash: resolution.sourceRowHash })
      && source.academicYear === resolution.academicYear
      && JSON.stringify(source.registrations) === JSON.stringify(resolution.registrations)) {
      accepted.push(resolution);
    } else {
      invalid += 1;
    }
  }
  return { accepted, issues: invalid > 0 ? [issue("DATELESS_SURVEY_EVIDENCE_INVALID", invalid)] : [] };
}

export interface BackfillResult {
  /** 이번 실행이 새로 만든 UserAcademicRecord 행 수. */
  inserted: number;
  blockingIssues: string[];
}

export interface VerifyResult {
  canEnable: boolean;
  issues: string[];
}

export interface PreflightReport {
  counts: {
    users: number;
    students: number;
    teachers: number;
    applications: number;
  };
  /** 개인 식별 정보를 담지 않는 종류별 건수. */
  issues: string[];
  notes: string[];
}

function issue(code: string, count: number): string {
  return `${code}:${count}`;
}

async function activeYear(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ year: number }[]>`
    SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'
  `;
  if (rows.length !== 1 || rows[0]?.year !== INITIAL_ACADEMIC_YEAR) {
    throw new DomainError("YEAR_MISMATCH", "초기 이전은 2026 학년도 하나만 활성일 때 실행할 수 있습니다.");
  }
  return INITIAL_ACADEMIC_YEAR;
}

/**
 * 이미 COPIED/VERIFIED 이후의 재확인 전용 경로가 쓰는 완화된 확인. 이 완화는
 * 일회성이 아니라 영구적이다 — 학년도 전환 뒤(활성 연도가 2026을 지난 뒤)의
 * 재실행도 계속 조회 전용 no-op이어야 하므로, "활성 연도가 정확히 2026"이
 * 아니라 "활성 학년도가 정확히 하나 있다(2026 이후)"만 확인한다. 대상 연도
 * 자체는 여전히 이 초기 이전이 다루는 2026으로 고정한다.
 */
async function requireSingleActiveYear(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ year: number }[]>`
    SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'
  `;
  if (rows.length !== 1 || (rows[0]?.year ?? 0) < INITIAL_ACADEMIC_YEAR) {
    throw new DomainError("YEAR_MISMATCH", "활성 학년도가 하나가 아닙니다. 관리자 설정을 확인하세요.");
  }
  return INITIAL_ACADEMIC_YEAR;
}

const INSERT_RECORDS_SQL = `
  WITH ${CONFLICT_GROUPS_CTE}
  INSERT INTO "UserAcademicRecord" (
    "year", "userId", "role", "name", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "memberState", "needsReview", "version", "updatedAt"
  )
  SELECT $1::int, k."id", k."role", k."name", k."grade", k."classNum", k."number", k."gender",
         k."subject", k."homeroom", k."position",
         CASE WHEN k."role" = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END,
         ${NEEDS_REVIEW_EXPR},
         0, CURRENT_TIMESTAMP
  FROM "keyed" k
  ON CONFLICT DO NOTHING
`;

const INSERT_ENTRIES_SQL = `
  WITH ${CONFLICT_GROUPS_CTE}
  INSERT INTO "RosterEntry" ("id", "year", "userId", "emailKey", "included", "baseUserVersion", "version")
  SELECT 'backfill-' || $1::text || '-' || k."id"::text, $1::int, k."id", k."emailKeyValue",
         true, k."profileVersion", 0
  FROM "keyed" k
  WHERE NOT EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = k."emailKeyValue")
  ON CONFLICT DO NOTHING
`;

const FILL_EMAIL_KEY_SQL = `
  WITH ${CONFLICT_GROUPS_CTE}
  UPDATE "User" u SET "emailKey" = lower(btrim(u."email"))
  WHERE u."emailKey" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = lower(btrim(u."email")))
    -- 남이 이미 쥔 키를 다시 쓰면 unique 위반으로 전체가 멈춘다.
    AND NOT EXISTS (
      SELECT 1 FROM "User" o WHERE o."id" <> u."id" AND o."emailKey" = lower(btrim(u."email"))
    )
`;

// 신청의 확정일 범위 판정은 SQL의 date 비교로 끝낸다. JS Date 재해석을 거치지 않는다.
const APPLICATION_DATES_CTE = `
  "appDates" AS (
    SELECT "applicationId" AS "appId", "date" FROM "MealApplicationMealDate"
    UNION ALL
    SELECT r."applicationId", d."date"
    FROM "MealRegistrationMealDate" d
    JOIN "MealRegistration" r ON r."id" = d."registrationId"
    WHERE r."status" = 'APPROVED'
  ),
  "appRange" AS (
    SELECT a."id", min(d."date") AS "minDate", max(d."date") AS "maxDate"
    FROM "MealApplication" a
    LEFT JOIN "appDates" d ON d."appId" = a."id"
    GROUP BY a."id"
  )
`;

const FILL_APPLICATION_YEAR_SQL = `
  WITH ${APPLICATION_DATES_CTE}
  UPDATE "MealApplication" a SET "academicYear" = $1::int
  FROM "appRange" r
  WHERE r."id" = a."id"
    AND a."academicYear" IS NULL
    AND r."minDate" >= $2::date
    AND r."maxDate" <= $3::date
`;

const COUNT_APPLICATION_SCOPE_SQL = `
  WITH ${APPLICATION_DATES_CTE}
  SELECT count(*)::int AS "total",
         count(*) FILTER (WHERE "minDate" IS NULL)::int AS "unknown",
         count(*) FILTER (
           WHERE "minDate" IS NOT NULL AND ("minDate" < $1::date OR "maxDate" > $2::date)
         )::int AS "outOfYear"
  FROM "appRange"
`;

const COUNT_CONFLICTS_SQL = `
  WITH ${CONFLICT_GROUPS_CTE}
  SELECT
    (SELECT count(*)::int FROM "emailDup") AS "emailGroups",
    (SELECT count(*)::int FROM "seatDup") AS "seatGroups",
    (SELECT count(*)::int FROM "keyed" k
      WHERE k."role" = 'STUDENT' AND (k."grade" IS NULL OR k."classNum" IS NULL OR k."number" IS NULL)
    ) AS "missingSeat",
    (SELECT count(*)::int FROM "keyed" k WHERE k."role" = 'STUDENT' AND k."gender" IS NULL) AS "missingGender",
    (SELECT count(*)::int FROM "keyed") AS "users",
    (SELECT count(*)::int FROM "keyed" k WHERE k."role" = 'STUDENT') AS "students",
    (SELECT count(*)::int FROM "keyed" k WHERE k."role" = 'TEACHER') AS "teachers",
    (SELECT count(*)::int FROM "MealRegistration" r
      WHERE r."status" = 'APPROVED'
        AND NOT EXISTS (SELECT 1 FROM "MealRegistrationMealDate" d WHERE d."registrationId" = r."id")
    ) AS "orphanRegistrations"
`;

const COUNT_RECORD_MISMATCH_SQL = `
  SELECT count(*)::int AS n
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  WHERE r."year" = $1::int
    AND (
      r."role" <> u."role"
      OR r."name" <> u."name"
      OR r."memberState" <> CASE WHEN u."role" = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END
      OR r."grade" IS DISTINCT FROM u."grade"
      OR r."classNum" IS DISTINCT FROM u."classNum"
      OR r."number" IS DISTINCT FROM u."number"
      OR r."gender" IS DISTINCT FROM u."gender"
      OR r."subject" IS DISTINCT FROM u."subject"
      OR r."homeroom" IS DISTINCT FROM u."homeroom"
      OR r."position" IS DISTINCT FROM u."position"
    )
`;

interface ConflictCounts {
  emailGroups: number;
  seatGroups: number;
  missingSeat: number;
  missingGender: number;
  users: number;
  students: number;
  teachers: number;
  orphanRegistrations: number;
}

/**
 * 읽기 전용 사전 점검. 자동 병합·값 보정을 하지 않고, 사람이 고쳐야 하는
 * 충돌만 종류와 건수로 보고한다. 복사와 같은 트랜잭션에서 호출하면 보고한
 * 건수와 실제로 복사된 내용이 같은 스냅샷을 본다.
 */
export async function runPreflight(
  db: Db,
  year: number = INITIAL_ACADEMIC_YEAR,
  surveyEvidence?: Prisma.JsonValue,
): Promise<PreflightReport> {
  const bounds = academicYearBounds(year);
  const stored = surveyEvidence === undefined
    ? storedSurveyResolutions((await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } }))?.sourceManifest)
    : surveyEvidence;
  const surveys = await validateSurveyResolutions(db, stored);

  const conflictRows = await db.$queryRawUnsafe<ConflictCounts[]>(COUNT_CONFLICTS_SQL);
  const conflicts = conflictRows[0];
  if (!conflicts) throw new DomainError("MISSING_PROFILE", "사전 점검 결과를 읽지 못했습니다.");

  const scopeRows = await db.$queryRawUnsafe<{ total: number; unknown: number; outOfYear: number }[]>(
    COUNT_APPLICATION_SCOPE_SQL,
    bounds.startDate,
    bounds.endDate,
  );
  const scope = scopeRows[0] ?? { total: 0, unknown: 0, outOfYear: 0 };

  const issues: string[] = [...surveys.issues];
  if (conflicts.emailGroups > 0) issues.push(issue("EMAIL_COLLISION", conflicts.emailGroups));
  if (conflicts.seatGroups > 0) issues.push(issue("DUPLICATE_SEAT", conflicts.seatGroups));
  if (conflicts.missingSeat > 0) issues.push(issue("MISSING_SEAT", conflicts.missingSeat));
  if (scope.outOfYear > 0) issues.push(issue("APPLICATION_OUT_OF_YEAR", scope.outOfYear));
  const unresolvedApplications = scope.unknown - surveys.accepted.length;
  const surveyRegistrations = surveys.accepted.reduce((sum, entry) => sum + entry.expectedApprovedRegistrationCount, 0);
  const unresolvedRegistrations = conflicts.orphanRegistrations - surveyRegistrations;
  if (unresolvedApplications > 0) issues.push(issue("APPLICATION_YEAR_UNKNOWN", unresolvedApplications));
  if (unresolvedRegistrations > 0) {
    issues.push(issue("REGISTRATION_WITHOUT_DATES", unresolvedRegistrations));
  }

  const notes: string[] = [];
  if (conflicts.missingGender > 0) notes.push(issue("MISSING_GENDER", conflicts.missingGender));
  if (surveys.accepted.length > 0) notes.push(issue("CONFIRMED_DATELESS_SURVEY_APPLICATION", surveys.accepted.length));
  if (surveyRegistrations > 0) notes.push(issue("CONFIRMED_DATELESS_SURVEY_REGISTRATION", surveyRegistrations));

  return {
    counts: {
      users: conflicts.users,
      students: conflicts.students,
      teachers: conflicts.teachers,
      applications: scope.total,
    },
    issues: issues.sort(),
    notes,
  };
}

async function countRecordMismatch(db: Db, year: number): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(COUNT_RECORD_MISMATCH_SQL, year);
  return rows[0]?.n ?? 0;
}

/**
 * 복사 단계. 네 개의 집합 기반 문장이 스스로 충돌 그룹을 계산하므로, 사전
 * 점검 이후 들어온 행이 있어도 unique 위반 없이 같은 규칙으로 처리된다.
 * 이미 있는 행은 덮어쓰지 않고, 새 컬럼 두 개만 채운다.
 */
export async function copyAcademicRecords(tx: Tx, year: number = INITIAL_ACADEMIC_YEAR): Promise<number> {
  const bounds = academicYearBounds(year);

  const inserted = await tx.$executeRawUnsafe(INSERT_RECORDS_SQL, year);
  await tx.$executeRawUnsafe(INSERT_ENTRIES_SQL, year);
  await tx.$executeRawUnsafe(FILL_EMAIL_KEY_SQL);
  await tx.$executeRawUnsafe(FILL_APPLICATION_YEAR_SQL, year, bounds.startDate, bounds.endDate);

  return inserted;
}

function buildManifest(
  source: LegacyFingerprint,
  report: PreflightReport,
  issues: string[],
  surveyEvidence?: Prisma.JsonValue,
): Prisma.InputJsonObject {
  return {
    year: INITIAL_ACADEMIC_YEAR,
    fingerprintFormat: source.format ?? null,
    fingerprintVersion: source.version ?? null,
    counts: report.counts,
    issues,
    notes: report.notes,
    // 해시와 건수만 담는다. 이름·이메일·학번은 어떤 형태로도 남기지 않는다.
    source: source.tables as unknown as Prisma.InputJsonObject,
    ...(surveyEvidence !== undefined ? { dateLessSurveyResolutions: surveyEvidence } : {}),
  };
}

/**
 * 기존 User 전체를 2026 학년도 기록·명부로 한 번 복사한다. 운영 중에 돌아가므로
 * control 행을 배타 잠금해 호환 쓰기와 줄을 세우고, 점검·복사·상태 기록을 한
 * 트랜잭션에서 끝낸다. 이미 COPIED 이후라면 다시 복사하지 않는다.
 */
export async function backfill2026(
  db: PrismaClient,
  source: LegacyFingerprint,
  surveyConfirmations: DateLessSurveyConfirmation[] = [],
): Promise<BackfillResult> {
  const confirmations = surveyConfirmations.length > 0 ? parseDateLessSurveyConfirmations(surveyConfirmations) : [];
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;

    const existing = await tx.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const alreadyCopied = existing !== null && existing.state !== "PENDING";

    // 이미 복사된 뒤에는 학년도 전환으로 활성 연도가 2026을 지났어도(Task 9의
    // 명부 삭제 뒤 재실행 등) 활성 학년도가 하나라는 것만 재확인한다. 처음
    // 복사할 때만 활성 연도가 정말 2026인지를 엄격히 확인한다.
    const year = alreadyCopied ? await requireSingleActiveYear(tx) : await activeYear(tx);

    let surveyEvidence = storedSurveyResolutions(existing?.sourceManifest);
    if (confirmations.length > 0) {
      const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
      if (alreadyCopied || control.mode !== "PREPARING" || surveyEvidence !== undefined) {
        throw new DomainError("NOT_READY", "희망조사 확인은 최초 이전에만 추가할 수 있습니다.");
      }
      await lockBackfillVerificationSources(tx);
      const resolutions: DateLessSurveyResolution[] = [];
      for (const confirmation of confirmations) {
        const surveySource = await captureDateLessSurveySource(tx, confirmation.applicationId);
        if (!matchesSurveySource(surveySource, confirmation)) {
          throw new DomainError("NOT_READY", "희망조사 확인 자료와 현재 신청 원본이 일치하지 않습니다.");
        }
        const { expectedSourceRowHash, ...confirmed } = confirmation;
        resolutions.push({
          ...confirmed,
          sourceRowHash: expectedSourceRowHash,
          sourceFormat: "posanmeal-dateless-survey-v1",
          reason: "USER_CONFIRMED_DATELESS_INTENT_SURVEY",
          confirmedAt: new Date().toISOString(),
          registrations: surveySource.registrations,
        });
        await tx.$executeRaw`UPDATE "MealApplication" SET "academicYear" = ${year}
          WHERE id = ${confirmation.applicationId} AND "academicYear" IS NULL`;
      }
      surveyEvidence = resolutions;
    } else if (surveyEvidence !== undefined) {
      await lockBackfillVerificationSources(tx);
    }

    const report = await runPreflight(tx, year, surveyEvidence);
    const inserted = alreadyCopied ? 0 : await copyAcademicRecords(tx, year);

    const issues = [...report.issues];
    const mismatch = await countRecordMismatch(tx, year);
    if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));
    issues.sort();

    const manifest = buildManifest(source, report, issues, surveyEvidence);
    if (alreadyCopied) {
      await tx.academicBackfill.update({
        where: { key: ACADEMIC_BACKFILL_KEY },
        data: { sourceManifest: manifest },
      });
    } else {
      await tx.academicBackfill.upsert({
        where: { key: ACADEMIC_BACKFILL_KEY },
        create: {
          key: ACADEMIC_BACKFILL_KEY,
          state: "COPIED",
          sourceManifest: manifest,
          completedAt: new Date(),
        },
        update: { state: "COPIED", sourceManifest: manifest, completedAt: new Date() },
      });
    }

    return { inserted, blockingIssues: issues };
  }, ROSTER_TX);
}

export async function checkCurrentBackfill(db: Db) {
  const year = await activeYear(db);
  const issues: string[] = [];
  const backfill = await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });
  if (!backfill || backfill.state === "PENDING") {
    issues.push("BACKFILL_NOT_COPIED:1");
  }

  const report = await runPreflight(db, year, storedSurveyResolutions(backfill?.sourceManifest));
  issues.push(...report.issues);

  const mismatch = await countRecordMismatch(db, year);
  if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));

  const recordCount = await db.userAcademicRecord.count({ where: { year } });
  if (recordCount !== report.counts.users) {
    issues.push(issue("RECORD_COUNT_MISMATCH", Math.abs(report.counts.users - recordCount)));
  }
  const missingApplicationYears = await db.mealApplication.count({ where: { academicYear: null } });
  if (missingApplicationYears > 0) issues.push(issue("APPLICATION_YEAR_MISSING", missingApplicationYears));

  return { backfill, report, issues };
}

async function inspectBackfillWithDb(db: Db, before: LegacyFingerprint, after: LegacyFingerprint) {
  const { backfill, report, issues } = await checkCurrentBackfill(db);
  const diff = compareLegacyFingerprints(before, after);
  if (diff.formatMismatch) issues.push("FINGERPRINT_FORMAT_MISMATCH:1");
  for (const table of diff.differingTables) {
    issues.push(`LEGACY_MODIFIED:${table}`);
  }
  issues.sort();
  return { backfill, report, result: { canEnable: issues.length === 0, issues } };
}

export async function inspectBackfill(db: PrismaClient, before: LegacyFingerprint, after: LegacyFingerprint): Promise<VerifyResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return (await inspectBackfillWithDb(tx, before, after)).result;
  }, { ...ROSTER_TX, isolationLevel: "RepeatableRead" });
}

/** 신청 쓰기는 control 잠금을 쓰지 않으므로 최종 검증 중에만 대상 테이블 쓰기를 잠깐 기다린다. */
export async function lockBackfillVerificationSources(tx: Tx): Promise<void> {
  await tx.$executeRaw`LOCK TABLE "MealApplication", "MealApplicationMealDate", "MealRegistration", "MealRegistrationMealDate", "MealApplicationMeal", "MealRegistrationMeal" IN SHARE MODE`;
}

export async function verifyBackfill(db: PrismaClient, before: LegacyFingerprint, after: LegacyFingerprint): Promise<VerifyResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;
    const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    if (control.mode !== "PREPARING") {
      throw new DomainError("NOT_READY", "기능 공개 후에는 읽기 전용 검증을 사용하세요.");
    }
    await lockBackfillVerificationSources(tx);
    const { backfill, report, result } = await inspectBackfillWithDb(tx, before, after);
    if (backfill && backfill.state !== "PENDING") {
      await tx.academicBackfill.update({
        where: { key: ACADEMIC_BACKFILL_KEY },
        data: {
          state: result.canEnable ? "VERIFIED" : "COPIED",
          verifiedAt: result.canEnable ? new Date() : null,
          sourceManifest: buildManifest(before, report, result.issues, storedSurveyResolutions(backfill.sourceManifest)),
        },
      });
    }
    // 실패를 throw하면 오래된 VERIFIED를 취소한 UPDATE도 rollback된다.
    return result;
  }, ROSTER_TX);
}
