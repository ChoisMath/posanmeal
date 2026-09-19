import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { LegacyFingerprint } from "../../../scripts/academic-year/fingerprint";
import { compareLegacyFingerprints } from "../../../scripts/academic-year/fingerprint";
import { academicYearBounds } from "./calendar";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";

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
  needsReviewUserIds: number[];
  emailCollisionUserIds: number[];
  yearScopedApplicationIds: number[];
}

interface GroupRow {
  ids: number[];
}

function issue(code: string, count: number): string {
  return `${code}:${count}`;
}

async function activeYear(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ year: number }[]>`
    SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'
  `;
  const year = rows[0]?.year;
  if (year !== INITIAL_ACADEMIC_YEAR) {
    throw new DomainError("YEAR_MISMATCH", "초기 이전은 2026 학년도가 활성일 때만 실행할 수 있습니다.");
  }
  return year;
}

/**
 * 읽기 전용 사전 점검. 자동 병합·값 보정을 하지 않고, 사람이 고쳐야 하는
 * 충돌만 종류와 건수로 보고한다.
 */
export async function runPreflight(db: Db, year: number = INITIAL_ACADEMIC_YEAR): Promise<PreflightReport> {
  const bounds = academicYearBounds(year);

  const emailGroups = await db.$queryRaw<GroupRow[]>`
    SELECT array_agg(id ORDER BY id)::int[] AS ids
    FROM "User"
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  `;

  const seatGroups = await db.$queryRaw<GroupRow[]>`
    SELECT array_agg(id ORDER BY id)::int[] AS ids
    FROM "User"
    WHERE role = 'STUDENT' AND grade IS NOT NULL AND "classNum" IS NOT NULL AND number IS NOT NULL
    GROUP BY grade, "classNum", number
    HAVING count(*) > 1
  `;

  const missingSeat = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM "User"
    WHERE role = 'STUDENT' AND (grade IS NULL OR "classNum" IS NULL OR number IS NULL)
  `;

  const missingGender = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM "User" WHERE role = 'STUDENT' AND gender IS NULL
  `;

  const applications = await db.$queryRaw<{ id: number; minDate: Date | null; maxDate: Date | null }[]>`
    WITH "dates" AS (
      SELECT "applicationId" AS "appId", "date" FROM "MealApplicationMealDate"
      UNION ALL
      SELECT r."applicationId", d."date"
      FROM "MealRegistrationMealDate" d
      JOIN "MealRegistration" r ON r.id = d."registrationId"
      WHERE r.status = 'APPROVED'
    )
    SELECT a.id, min(d."date") AS "minDate", max(d."date") AS "maxDate"
    FROM "MealApplication" a
    LEFT JOIN "dates" d ON d."appId" = a.id
    GROUP BY a.id
  `;

  const registrationsWithoutDates = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "MealRegistration" r
    WHERE r.status = 'APPROVED'
      AND NOT EXISTS (SELECT 1 FROM "MealRegistrationMealDate" d WHERE d."registrationId" = r.id)
  `;

  const counts = await db.$queryRaw<{ users: number; students: number; teachers: number }[]>`
    SELECT count(*)::int AS users,
           count(*) FILTER (WHERE role = 'STUDENT')::int AS students,
           count(*) FILTER (WHERE role = 'TEACHER')::int AS teachers
    FROM "User"
  `;

  const inScope: number[] = [];
  let outOfYear = 0;
  let unknownYear = 0;
  for (const application of applications) {
    if (!application.minDate || !application.maxDate) {
      unknownYear += 1;
      continue;
    }
    const min = application.minDate.toISOString().slice(0, 10);
    const max = application.maxDate.toISOString().slice(0, 10);
    if (min >= bounds.startDate && max <= bounds.endDate) {
      inScope.push(application.id);
    } else {
      outOfYear += 1;
    }
  }

  const emailCollisionUserIds = emailGroups.flatMap((group) => group.ids);
  const duplicateSeatUserIds = seatGroups.flatMap((group) => group.ids);
  const needsReviewUserIds = [
    ...new Set([
      ...duplicateSeatUserIds,
      ...missingSeat.map((row) => row.id),
      ...missingGender.map((row) => row.id),
      ...emailCollisionUserIds,
    ]),
  ].sort((a, b) => a - b);

  const issues: string[] = [];
  if (emailGroups.length > 0) issues.push(issue("EMAIL_COLLISION", emailGroups.length));
  if (seatGroups.length > 0) issues.push(issue("DUPLICATE_SEAT", seatGroups.length));
  if (missingSeat.length > 0) issues.push(issue("MISSING_SEAT", missingSeat.length));
  if (outOfYear > 0) issues.push(issue("APPLICATION_OUT_OF_YEAR", outOfYear));
  if (unknownYear > 0) issues.push(issue("APPLICATION_YEAR_UNKNOWN", unknownYear));
  const orphanRegistrations = registrationsWithoutDates[0]?.n ?? 0;
  if (orphanRegistrations > 0) issues.push(issue("REGISTRATION_WITHOUT_DATES", orphanRegistrations));

  const notes: string[] = [];
  if (missingGender.length > 0) notes.push(issue("MISSING_GENDER", missingGender.length));

  return {
    counts: {
      users: counts[0]?.users ?? 0,
      students: counts[0]?.students ?? 0,
      teachers: counts[0]?.teachers ?? 0,
      applications: applications.length,
    },
    issues: issues.sort(),
    notes,
    needsReviewUserIds,
    emailCollisionUserIds: [...emailCollisionUserIds].sort((a, b) => a - b),
    yearScopedApplicationIds: inScope.sort((a, b) => a - b),
  };
}

// 고정 SQL + 바인딩 파라미터만 사용한다. 식별자 보간은 하지 않으며,
// id 목록은 jsonb 한 개로 넘겨 드라이버의 배열 직렬화에 의존하지 않는다.
const INSERT_RECORDS_SQL = `
  INSERT INTO "UserAcademicRecord" (
    "year", "userId", "role", "name", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "memberState", "needsReview", "version", "updatedAt"
  )
  SELECT $1::int, u.id, u.role, u.name, u.grade, u."classNum", u.number, u.gender,
         u.subject, u.homeroom, u.position,
         CASE WHEN u.role = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END,
         u.id IN (SELECT (jsonb_array_elements_text($2::jsonb))::int),
         0, CURRENT_TIMESTAMP
  FROM "User" u
  ON CONFLICT DO NOTHING
`;

const INSERT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" ("id", "year", "userId", "emailKey", "included", "baseUserVersion", "version")
  SELECT 'backfill-' || $1::text || '-' || u.id::text, $1::int, u.id, lower(btrim(u.email)),
         true, u."profileVersion", 0
  FROM "User" u
  WHERE u.id NOT IN (SELECT (jsonb_array_elements_text($2::jsonb))::int)
  ON CONFLICT DO NOTHING
`;

const FILL_EMAIL_KEY_SQL = `
  UPDATE "User" SET "emailKey" = lower(btrim(email))
  WHERE "emailKey" IS NULL
    AND id NOT IN (SELECT (jsonb_array_elements_text($1::jsonb))::int)
`;

const FILL_APPLICATION_YEAR_SQL = `
  UPDATE "MealApplication" SET "academicYear" = $1::int
  WHERE "academicYear" IS NULL
    AND id IN (SELECT (jsonb_array_elements_text($2::jsonb))::int)
`;

const COUNT_RECORD_MISMATCH_SQL = `
  SELECT count(*)::int AS n
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u.id = r."userId"
  WHERE r."year" = $1::int
    AND (
      r."role" <> u."role"
      OR r."name" <> u."name"
      OR r."grade" IS DISTINCT FROM u."grade"
      OR r."classNum" IS DISTINCT FROM u."classNum"
      OR r."number" IS DISTINCT FROM u."number"
      OR r."gender" IS DISTINCT FROM u."gender"
      OR r."subject" IS DISTINCT FROM u."subject"
      OR r."homeroom" IS DISTINCT FROM u."homeroom"
      OR r."position" IS DISTINCT FROM u."position"
    )
`;

async function countRecordMismatch(db: Db, year: number): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(COUNT_RECORD_MISMATCH_SQL, year);
  return rows[0]?.n ?? 0;
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
 * 이미 있는 행은 덮어쓰지 않고, 기존 컬럼은 어떤 경로로도 수정하지 않는다.
 * 이미 COPIED 이후라면 다시 복사하지 않고 사전 점검 결과만 갱신한다.
 */
export async function backfill2026(db: PrismaClient, source: LegacyFingerprint): Promise<BackfillResult> {
  const year = await activeYear(db);
  const existing = await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } });

  if (existing && existing.state !== "PENDING") {
    const report = await runPreflight(db, year);
    const issues = [...report.issues];
    const mismatch = await countRecordMismatch(db, year);
    if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));
    issues.sort();

    await db.academicBackfill.update({
      where: { key: ACADEMIC_BACKFILL_KEY },
      data: { sourceManifest: buildManifest(source, report, issues) },
    });
    return { inserted: 0, blockingIssues: issues };
  }

  const report = await runPreflight(db, year);

  return db.$transaction(async (tx: Tx) => {
    const needsReview = JSON.stringify(report.needsReviewUserIds);
    const collided = JSON.stringify(report.emailCollisionUserIds);

    const inserted = await tx.$executeRawUnsafe(INSERT_RECORDS_SQL, year, needsReview);
    await tx.$executeRawUnsafe(INSERT_ENTRIES_SQL, year, collided);
    await tx.$executeRawUnsafe(FILL_EMAIL_KEY_SQL, collided);
    await tx.$executeRawUnsafe(
      FILL_APPLICATION_YEAR_SQL,
      year,
      JSON.stringify(report.yearScopedApplicationIds),
    );

    const issues = [...report.issues];
    const mismatch = await countRecordMismatch(tx, year);
    if (mismatch > 0) issues.push(issue("RECORD_MISMATCH", mismatch));
    issues.sort();

    await tx.academicBackfill.upsert({
      where: { key: ACADEMIC_BACKFILL_KEY },
      create: {
        key: ACADEMIC_BACKFILL_KEY,
        state: "COPIED",
        sourceManifest: buildManifest(source, report, issues),
        completedAt: new Date(),
      },
      update: {
        state: "COPIED",
        sourceManifest: buildManifest(source, report, issues),
        completedAt: new Date(),
      },
    });

    return { inserted, blockingIssues: issues };
  });
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
