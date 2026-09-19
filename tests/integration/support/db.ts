import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  ACADEMIC_TEST_DATABASE,
  ACADEMIC_TEST_DATABASE_URL,
  ACADEMIC_TEST_IDENTITY_MARKER,
  ACADEMIC_TEST_USER,
  parseAcademicTestTarget,
} from "@/lib/academic-year/test-target";

const GUARD_FAILURE_MESSAGE = "전용 테스트 DB 설정을 확인하세요";

/** 마이그레이션이 ACTIVE로 심어 두는 학년도. reset 후에도 같은 값으로 복원한다. */
export const ACADEMIC_TEST_SEED_YEAR = 2026;

const APP_TABLES = [
  "LocalCheckInReview",
  "KioskSnapshot",
  "AcademicBackfill",
  "EligibilityEvent",
  "UserAccessEvent",
  "RosterMutation",
  "RosterDecision",
  "RosterImport",
  "RosterFile",
  "RosterEntry",
  "UserAcademicRecord",
  "RosterControl",
  "AcademicYear",
  "FaceProfile",
  "CheckIn",
  "MealRegistrationMealDate",
  "MealRegistrationMeal",
  "MealRegistration",
  "MealApplicationMealDate",
  "MealApplicationMeal",
  "MealApplication",
  "SystemSetting",
  "User",
  "Admin",
] as const;

async function assertIdentityMarker(client: pg.ClientBase): Promise<void> {
  const identity = await client.query<{ db: string; usr: string }>(
    "SELECT current_database() AS db, current_user AS usr",
  );
  const row = identity.rows[0];
  if (row?.db !== ACADEMIC_TEST_DATABASE || row?.usr !== ACADEMIC_TEST_USER) {
    throw new Error(GUARD_FAILURE_MESSAGE);
  }

  const marker = await client.query("SELECT key FROM academic_meta.academic_test_identity WHERE key = $1", [
    ACADEMIC_TEST_IDENTITY_MARKER,
  ]);
  if (marker.rowCount !== 1) {
    throw new Error(GUARD_FAILURE_MESSAGE);
  }
}

/**
 * Prisma 클라이언트를 여는 전용 통로. 연결 전 URL 가드, 연결 후 marker 검사를
 * 모두 통과해야 앱 코드가 이 DB에 닿을 수 있다.
 */
export async function openAcademicTestDb(): Promise<PrismaClient> {
  const url = parseAcademicTestTarget(ACADEMIC_TEST_DATABASE_URL);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });

  const probe = await pool.connect();
  try {
    await assertIdentityMarker(probe);
  } finally {
    probe.release();
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/**
 * fingerprint 계산 등 raw SQL이 필요한 경로를 위한 pg 클라이언트.
 * 동일한 가드를 다시 적용한다 (호출 경로가 다르므로 재검사가 필요).
 */
export async function openAcademicTestPgClient(): Promise<pg.Client> {
  const url = parseAcademicTestTarget(ACADEMIC_TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await assertIdentityMarker(client);
  return client;
}

/**
 * marker를 다시 검증한 뒤 앱 테이블만 비운다. _prisma_migrations와
 * academic_test_identity는 절대 건드리지 않는다.
 */
export async function resetAcademicTestDb(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ db: string; usr: string }[]>`
    SELECT current_database() AS db, current_user AS usr
  `;
  const row = rows[0];
  if (row?.db !== ACADEMIC_TEST_DATABASE || row?.usr !== ACADEMIC_TEST_USER) {
    throw new Error(GUARD_FAILURE_MESSAGE);
  }

  const markerRows = await db.$queryRaw<{ key: string }[]>`
    SELECT key FROM academic_meta.academic_test_identity WHERE key = ${ACADEMIC_TEST_IDENTITY_MARKER}
  `;
  if (markerRows.length !== 1) {
    throw new Error(GUARD_FAILURE_MESSAGE);
  }

  const tableList = APP_TABLES.map((name) => `"${name}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  // 마이그레이션이 심은 두 행은 모든 후속 코드가 존재를 전제하므로 다시 만든다.
  await db.$executeRaw`INSERT INTO "RosterControl" ("id", "mode", "version") VALUES (1, 'PREPARING', 0)`;
  await db.$executeRaw`
    INSERT INTO "AcademicYear" ("year", "state", "version", "createdAt", "updatedAt")
    VALUES (${ACADEMIC_TEST_SEED_YEAR}, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
}
