import type { PrismaClient } from "@/generated/prisma/client";
import { INITIAL_ACADEMIC_YEAR } from "./backfill";
import type { Tx } from "./db";
import { DomainError } from "./errors";
import { ROSTER_TX } from "./mutation";
import { CONFLICT_GROUPS_CTE, NEEDS_REVIEW_EXPR } from "./roster-sql";

const BATCH_CTE = `
  ${CONFLICT_GROUPS_CTE},
  "batch" AS (SELECT * FROM "keyed" WHERE "id" = ANY($2::int[]))
`;

// 옛 주소로 남은 키는 다른 사용자의 정규화 주소를 막을 수 있으므로 먼저 비운다.
const CLEAR_STALE_EMAIL_KEY_SQL = `
  UPDATE "User" u SET "emailKey" = NULL
  WHERE u."id" = ANY($1::int[])
    AND u."emailKey" IS NOT NULL
    AND u."emailKey" <> lower(btrim(u.email))
`;

const FILL_EMAIL_KEY_SQL = `
  WITH ${CONFLICT_GROUPS_CTE}
  UPDATE "User" u SET "emailKey" = lower(btrim(u.email))
  WHERE u."id" = ANY($1::int[])
    AND u."emailKey" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = lower(btrim(u.email)))
`;

/**
 * 좌석이 바뀌는 기록만 부분 unique 색인 밖으로 잠시 빼 둔다. 같은 문장 안에서
 * 두 학생이 좌석을 맞바꾸면 행 단위 검사가 중간 상태에서 23505를 낼 수 있다.
 * 값이 그대로인 기록은 건드리지 않아 뒤따르는 upsert가 헛되이 version을 올리지 않는다.
 */
const PARK_MOVED_RECORDS_SQL = `
  UPDATE "UserAcademicRecord" r SET "needsReview" = true
  FROM "User" u
  WHERE r."year" = $1::int AND r."userId" = u."id"
    AND u."id" = ANY($2::int[])
    AND r."needsReview" = false
    AND (r."grade", r."classNum", r."number", r."role")
        IS DISTINCT FROM (u."grade", u."classNum", u."number", u."role")
`;

// 기록 쪽 좌석 충돌. 배치 밖 기록은 needsReview와 무관하게 전부 살펴야, 이번에
// 색인에 들어가는 행이 어떤 기존 행과도 부딪히지 않음이 보장된다.
const RECORD_SEAT_TAKEN_EXPR = `
  EXISTS (
    SELECT 1 FROM "UserAcademicRecord" r
    WHERE r."year" = $1::int
      AND NOT (r."userId" = ANY($2::int[]))
      AND r."role" = 'STUDENT' AND r."memberState" = 'ENROLLED'
      AND r."grade" = k."grade" AND r."classNum" = k."classNum" AND r."number" = k."number"
  )
`;

const UPSERT_RECORDS_SQL = `
  WITH ${BATCH_CTE}
  INSERT INTO "UserAcademicRecord" (
    "year", "userId", "role", "name", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "memberState", "needsReview", "version", "updatedAt"
  )
  SELECT $1::int, k."id", k."role", k."name", k."grade", k."classNum", k."number", k."gender",
         k."subject", k."homeroom", k."position",
         CASE WHEN k."role" = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END,
         (${NEEDS_REVIEW_EXPR} OR (k."role" = 'STUDENT' AND ${RECORD_SEAT_TAKEN_EXPR})),
         0, CURRENT_TIMESTAMP
  FROM "batch" k
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "role" = EXCLUDED."role",
    "name" = EXCLUDED."name",
    "grade" = EXCLUDED."grade",
    "classNum" = EXCLUDED."classNum",
    "number" = EXCLUDED."number",
    "gender" = EXCLUDED."gender",
    "subject" = EXCLUDED."subject",
    "homeroom" = EXCLUDED."homeroom",
    "position" = EXCLUDED."position",
    "memberState" = EXCLUDED."memberState",
    "needsReview" = EXCLUDED."needsReview",
    "version" = "UserAcademicRecord"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE (
    "UserAcademicRecord"."role", "UserAcademicRecord"."name", "UserAcademicRecord"."grade",
    "UserAcademicRecord"."classNum", "UserAcademicRecord"."number", "UserAcademicRecord"."gender",
    "UserAcademicRecord"."subject", "UserAcademicRecord"."homeroom", "UserAcademicRecord"."position",
    "UserAcademicRecord"."memberState", "UserAcademicRecord"."needsReview"
  ) IS DISTINCT FROM (
    EXCLUDED."role", EXCLUDED."name", EXCLUDED."grade",
    EXCLUDED."classNum", EXCLUDED."number", EXCLUDED."gender",
    EXCLUDED."subject", EXCLUDED."homeroom", EXCLUDED."position",
    EXCLUDED."memberState", EXCLUDED."needsReview"
  )
`;

// 충돌은 양쪽의 문제이므로 부딪힌 기존 기록도 검토 대상으로 올린다. 색인에서
// 빠지기만 하므로 유일성은 깨지지 않는다.
const FLAG_COLLIDING_RECORDS_SQL = `
  UPDATE "UserAcademicRecord" r
  SET "needsReview" = true, "version" = r."version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE r."year" = $1::int
    AND NOT (r."userId" = ANY($2::int[]))
    AND r."needsReview" = false
    AND r."role" = 'STUDENT' AND r."memberState" = 'ENROLLED'
    AND EXISTS (
      SELECT 1 FROM "UserAcademicRecord" b
      WHERE b."year" = $1::int AND b."userId" = ANY($2::int[])
        AND b."role" = 'STUDENT' AND b."memberState" = 'ENROLLED'
        AND b."grade" = r."grade" AND b."classNum" = r."classNum" AND b."number" = r."number"
    )
`;

const DROP_UNKEYED_ENTRIES_SQL = `
  DELETE FROM "RosterEntry" e
  USING "User" u
  WHERE e."year" = $1::int AND e."userId" = u."id"
    AND u."id" = ANY($2::int[]) AND u."emailKey" IS NULL
`;

const UPSERT_ENTRIES_SQL = `
  WITH "batch" AS (SELECT * FROM "User" WHERE "id" = ANY($2::int[]) AND "emailKey" IS NOT NULL)
  INSERT INTO "RosterEntry" ("id", "year", "userId", "emailKey", "included", "baseUserVersion", "version")
  SELECT 'compat-' || $1::text || '-' || k."id"::text, $1::int, k."id", k."emailKey",
         true, k."profileVersion", 0
  FROM "batch" k
  WHERE NOT EXISTS (
    SELECT 1 FROM "RosterEntry" o
    WHERE o."year" = $1::int AND o."emailKey" = k."emailKey"
      AND (o."userId" IS NULL OR o."userId" <> k."id")
  )
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "baseUserVersion" = EXCLUDED."baseUserVersion",
    "version" = "RosterEntry"."version" + 1
  WHERE ("RosterEntry"."emailKey", "RosterEntry"."baseUserVersion")
        IS DISTINCT FROM (EXCLUDED."emailKey", EXCLUDED."baseUserVersion")
`;

async function activeYear(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'`;
  if (rows.length === 1) return rows[0]!.year;
  if (rows.length > 1) {
    throw new DomainError("YEAR_MISMATCH", "활성 학년도가 하나가 아닙니다.");
  }

  // 마이그레이션이 미리 넣어 두는 것이 정상이고, 이 삽입은 방어용이다.
  await tx.$executeRaw`
    INSERT INTO "AcademicYear" ("year", "state", "version", "createdAt", "updatedAt")
    VALUES (${INITIAL_ACADEMIC_YEAR}, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO NOTHING
  `;

  const retry = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'`;
  if (retry.length !== 1) {
    throw new DomainError("YEAR_MISMATCH", "활성 학년도를 찾지 못했습니다.");
  }
  return retry[0]!.year;
}

/**
 * ACTIVE 학년도의 기록·명부를 `User` 현재값에 맞춘다. 집합 기반 고정 문장만
 * 쓰므로 어떤 입력도 unique·check 위반으로 기존 쓰기를 실패시키지 못한다.
 * 좌석·이메일이 겹치면 값을 지어내지 않고 양쪽을 `needsReview`로 남긴다.
 */
export async function mirrorUsersToActiveYear(tx: Tx, userIds: number[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  const year = await activeYear(tx);

  await tx.$executeRawUnsafe(CLEAR_STALE_EMAIL_KEY_SQL, ids);
  await tx.$executeRawUnsafe(FILL_EMAIL_KEY_SQL, ids);

  await tx.$executeRawUnsafe(PARK_MOVED_RECORDS_SQL, year, ids);
  const changedRecords = await tx.$executeRawUnsafe(UPSERT_RECORDS_SQL, year, ids);
  const flagged = await tx.$executeRawUnsafe(FLAG_COLLIDING_RECORDS_SQL, year, ids);

  await tx.$executeRawUnsafe(DROP_UNKEYED_ENTRIES_SQL, year, ids);
  await tx.$executeRawUnsafe(UPSERT_ENTRIES_SQL, year, ids);

  if (changedRecords + flagged > 0) {
    await tx.$executeRaw`
      UPDATE "AcademicYear" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "year" = ${year}
    `;
  }
}

export interface CompatWriteResult<T> {
  value: T;
  /** 이번 트랜잭션이 만들었거나 고친 사용자 id. 명부 반영은 이 목록 하나로 끝낸다. */
  userIds: number[];
}

/**
 * `User`의 명부 항목을 건드리는 기존 경로가 쓰는 유일한 통로. control 행 공유
 * 잠금을 첫 문장으로 잡아 진행 중인 초기 이전 뒤에 줄을 세우고, 호출자가 돌려준
 * id를 같은 트랜잭션에서 학년도 기록에 반영한다.
 */
export async function withCompatUserWrite<T>(
  db: PrismaClient,
  run: (tx: Tx) => Promise<CompatWriteResult<T>>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR SHARE`;
    const { value, userIds } = await run(tx);
    await mirrorUsersToActiveYear(tx, userIds);
    return value;
  }, ROSTER_TX);
}
