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
export async function runPreflight(db: Db, year: number = INITIAL_ACADEMIC_YEAR): Promise<PreflightReport> {
  const bounds = academicYearBounds(year);

  const conflictRows = await db.$queryRawUnsafe<ConflictCounts[]>(COUNT_CONFLICTS_SQL);
  const conflicts = conflictRows[0];
  if (!conflicts) throw new DomainError("MISSING_PROFILE", "사전 점검 결과를 읽지 못했습니다.");

  const scopeRows = await db.$queryRawUnsafe<{ total: number; unknown: number; outOfYear: number }[]>(
    COUNT_APPLICATION_SCOPE_SQL,
    bounds.startDate,
    bounds.endDate,
  );
  const scope = scopeRows[0] ?? { total: 0, unknown: 0, outOfYear: 0 };

  const issues: string[] = [];
  if (conflicts.emailGroups > 0) issues.push(issue("EMAIL_COLLISION", conflicts.emailGroups));
  if (conflicts.seatGroups > 0) issues.push(issue("DUPLICATE_SEAT", conflicts.seatGroups));
  if (conflicts.missingSeat > 0) issues.push(issue("MISSING_SEAT", conflicts.missingSeat));
  if (scope.outOfYear > 0) issues.push(issue("APPLICATION_OUT_OF_YEAR", scope.outOfYear));
  if (scope.unknown > 0) issues.push(issue("APPLICATION_YEAR_UNKNOWN", scope.unknown));
  if (conflicts.orphanRegistrations > 0) {
    issues.push(issue("REGISTRATION_WITHOUT_DATES", conflicts.orphanRegistrations));
  }

  const notes: string[] = [];
  if (conflicts.missingGender > 0) notes.push(issue("MISSING_GENDER", conflicts.missingGender));

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
): Prisma.InputJsonObject {
  return {
    year: INITIAL_ACADEMIC_YEAR,
    counts: report.counts,
    issues,
    notes: report.notes,
    // 해시와 건수만 담는다. 이름·이메일·학번은 어떤 형태로도 남기지 않는다.
    source: source.tables as unknown as Prisma.InputJsonObject,
  };
}

/**
 * 기존 User 전체를 2026 학년도 기록·명부로 한 번 복사한다. 운영 중에 돌아가므로
 * control 행을 배타 잠금해 호환 쓰기와 줄을 세우고, 점검·복사·상태 기록을 한
 * 트랜잭션에서 끝낸다. 이미 COPIED 이후라면 다시 복사하지 않는다.
 */
export async function backfill2026(db: PrismaClient, source: LegacyFingerprint): Promise<BackfillResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;

    const existing = await tx.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const alreadyCopied = existing !== null && existing.state !== "PENDING";

    // 이미 복사된 뒤에는 학년도 전환으로 활성 연도가 2026을 지났어도(Task 9의
    // 명부 삭제 뒤 재실행 등) 그 사실만 재확인한다. 처음 복사할 때만 활성 연도가
    // 정말 2026인지를 엄격히 확인한다.
    const year = alreadyCopied ? INITIAL_ACADEMIC_YEAR : await activeYear(tx);

    const report = await runPreflight(tx, year);
    const inserted = alreadyCopied ? 0 : await copyAcademicRecords(tx, year);

    const issues = [...report.issues];
    const mismatch = await countRecordMismatch(tx, year);
    if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));
    issues.sort();

    const manifest = buildManifest(source, report, issues);
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

/**
 * 원본 훼손 여부와 남은 충돌을 함께 판정한다. 둘 다 깨끗할 때만 VERIFIED로
 * 올리며, 이 상태가 되어야 메인 관리자가 새 학년도 기능을 켤 수 있다.
 */
export async function verifyBackfill(
  db: PrismaClient,
  before: LegacyFingerprint,
  after: LegacyFingerprint,
): Promise<VerifyResult> {
  const year = await activeYear(db);
  const issues: string[] = [];

  const diff = compareLegacyFingerprints(before, after);
  for (const table of diff.differingTables) {
    issues.push(`LEGACY_MODIFIED:${table}`);
  }

  const backfill = await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });
  if (!backfill || backfill.state === "PENDING") {
    issues.push("BACKFILL_NOT_COPIED:1");
  }

  const report = await runPreflight(db, year);
  issues.push(...report.issues);

  const mismatch = await countRecordMismatch(db, year);
  if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));

  const recordCount = await db.userAcademicRecord.count({ where: { year } });
  if (recordCount !== report.counts.users) {
    issues.push(issue("RECORD_COUNT_MISMATCH", Math.abs(report.counts.users - recordCount)));
  }

  issues.sort();
  if (issues.length > 0 || !backfill) {
    return { canEnable: false, issues };
  }

  await db.academicBackfill.update({
    where: { key: ACADEMIC_BACKFILL_KEY },
    data: {
      state: "VERIFIED",
      verifiedAt: new Date(),
      sourceManifest: buildManifest(before, report, []),
    },
  });

  return { canEnable: true, issues: [] };
}
