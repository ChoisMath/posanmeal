import type { PrismaClient } from "@/generated/prisma/client";
import { INITIAL_ACADEMIC_YEAR } from "./backfill";
import type { Tx } from "./db";
import { DomainError } from "./errors";
import { ROSTER_TX } from "./mutation";
import { CONFLICT_GROUPS_CTE, MIRROR_CONFLICT_GROUPS_CTE, NEEDS_REVIEW_EXPR } from "./roster-sql";

const EMAIL_DUP_CTE = `
  "emailDup" AS (
    SELECT lower(btrim(u.email)) AS "emailKeyValue" FROM "User" u
    GROUP BY lower(btrim(u.email)) HAVING count(*) > 1
  )
`;

/**
 * 충돌 그룹의 구성원은 한 명도 키를 쥐지 못한다. 옛 주소로 남은 키도 함께 비운다 —
 * 남의 정규화 주소를 막아 다음 채우기를 unique 위반으로 실패시킬 수 있다.
 */
const CLEAR_EMAIL_KEYS_SQL = `
  WITH ${EMAIL_DUP_CTE}
  UPDATE "User" u SET "emailKey" = NULL
  WHERE u."emailKey" IS NOT NULL
    AND (
      u."emailKey" <> lower(btrim(u.email))
      OR EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = lower(btrim(u.email)))
    )
`;

// 충돌이 풀린 사용자도 이 문장에서 키를 되찾으므로 배치로 좁히지 않는다.
const FILL_EMAIL_KEYS_SQL = `
  WITH ${EMAIL_DUP_CTE}
  UPDATE "User" u SET "emailKey" = lower(btrim(u.email))
  WHERE u."emailKey" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = lower(btrim(u.email)))
    AND NOT EXISTS (
      SELECT 1 FROM "User" o WHERE o."id" <> u."id" AND o."emailKey" = lower(btrim(u.email))
    )
`;

/**
 * 좌석이 바뀌는 기록을 부분 unique 색인 밖으로 먼저 뺀다. 같은 문장 안에서 두
 * 학생이 좌석을 맞바꾸면 행 단위 검사가 중간 상태에서 23505를 낼 수 있다.
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

/**
 * 배치 구성원의 기록을 `User` 현재값으로 맞춘다. PARK이 좌석을 옮기는 행을 미리
 * 색인에서 빼 두었고, 여기서 다시 색인에 들어가는 행은 배치 안팎 어느 좌석과도
 * 겹치지 않음을 확인한 것뿐이라 23505가 날 수 없다. 역할이 뒤집힐 때만 반대 역할의
 * 칸을 비우고 소속 상태를 그 역할의 기본값으로 되돌린다.
 */
const UPSERT_RECORDS_SQL = `
  WITH ${CONFLICT_GROUPS_CTE},
  "batch" AS (SELECT * FROM "keyed" WHERE "id" = ANY($2::int[]))
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
    "grade" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'TEACHER' THEN NULL ELSE EXCLUDED."grade" END,
    "classNum" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'TEACHER' THEN NULL ELSE EXCLUDED."classNum" END,
    "number" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'TEACHER' THEN NULL ELSE EXCLUDED."number" END,
    "gender" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'TEACHER' THEN NULL ELSE EXCLUDED."gender" END,
    "subject" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'STUDENT' THEN NULL ELSE EXCLUDED."subject" END,
    "homeroom" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'STUDENT' THEN NULL ELSE EXCLUDED."homeroom" END,
    "position" = CASE WHEN "UserAcademicRecord"."role" <> EXCLUDED."role" AND EXCLUDED."role" = 'STUDENT' THEN NULL ELSE EXCLUDED."position" END,
    "memberState" = CASE
      WHEN "UserAcademicRecord"."role" = EXCLUDED."role" THEN "UserAcademicRecord"."memberState"
      ELSE EXCLUDED."memberState"
    END,
    "needsReview" = EXCLUDED."needsReview",
    "version" = "UserAcademicRecord"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "UserAcademicRecord"."role" IS DISTINCT FROM EXCLUDED."role"
     OR (
       "UserAcademicRecord"."name", "UserAcademicRecord"."grade", "UserAcademicRecord"."classNum",
       "UserAcademicRecord"."number", "UserAcademicRecord"."gender", "UserAcademicRecord"."subject",
       "UserAcademicRecord"."homeroom", "UserAcademicRecord"."position",
       "UserAcademicRecord"."needsReview"
     ) IS DISTINCT FROM (
       EXCLUDED."name", EXCLUDED."grade", EXCLUDED."classNum",
       EXCLUDED."number", EXCLUDED."gender", EXCLUDED."subject",
       EXCLUDED."homeroom", EXCLUDED."position", EXCLUDED."needsReview"
     )
  RETURNING "userId"
`;

const BUMP_PROFILE_VERSION_SQL = `
  UPDATE "User" SET "profileVersion" = "profileVersion" + 1 WHERE "id" = ANY($1::int[])
`;

// 올리는 쪽을 먼저 돌려야 색인에서 빠질 행이 전부 빠진 뒤에 내리는 쪽이 들어간다.
const REVIEW_SET_SQL = `
  WITH ${MIRROR_CONFLICT_GROUPS_CTE}
  UPDATE "UserAcademicRecord" r
  SET "needsReview" = true, "version" = r."version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM "keyed" k
  WHERE k."id" = r."id" AND r."needsReview" = false AND ${NEEDS_REVIEW_EXPR}
`;

const REVIEW_CLEAR_SQL = `
  WITH ${MIRROR_CONFLICT_GROUPS_CTE}
  UPDATE "UserAcademicRecord" r
  SET "needsReview" = false, "version" = r."version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM "keyed" k
  WHERE k."id" = r."id" AND r."needsReview" = true AND NOT ${NEEDS_REVIEW_EXPR}
`;

/**
 * 기록이 있는 사용자면 명부 항목도 따라온다. 충돌로 키를 잃은 사람의 항목은 지우지
 * 않고 그대로 두며, 키가 비어 있는 동안에는 새로 만들지도 않는다. 충돌이 풀리면
 * 이 문장이 그때 만들어 준다 — 그래서 INSERT 쪽은 배치 밖까지 본다.
 *
 * 반대로 UPDATE 쪽은 이번 배치이거나 키가 실제로 달라진 항목만 건드린다.
 * `baseUserVersion`은 Release B가 "내보낸 뒤 서버가 바뀌었는가"를 판정하는 기준선이라,
 * 남의 편집이 지나가며 다시 찍으면 그 신호가 사라진다. Task 4의 계정 API도
 * `profileVersion`을 올리므로 무관한 사용자의 기준선이 새 값으로 덮일 수 있었다.
 */
const UPSERT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" ("id", "year", "userId", "emailKey", "included", "baseUserVersion", "version")
  SELECT 'compat-' || $1::text || '-' || u."id"::text, $1::int, u."id", u."emailKey",
         true, u."profileVersion", 0
  FROM "User" u
  JOIN "UserAcademicRecord" r ON r."userId" = u."id" AND r."year" = $1::int
  WHERE u."emailKey" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "RosterEntry" o
      WHERE o."year" = $1::int AND o."emailKey" = u."emailKey"
        AND (o."userId" IS NULL OR o."userId" <> u."id")
    )
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "baseUserVersion" = EXCLUDED."baseUserVersion",
    "version" = "RosterEntry"."version" + 1
  WHERE ("RosterEntry"."userId" = ANY($2::int[])
         OR "RosterEntry"."emailKey" IS DISTINCT FROM EXCLUDED."emailKey")
    AND ("RosterEntry"."emailKey", "RosterEntry"."baseUserVersion")
        IS DISTINCT FROM (EXCLUDED."emailKey", EXCLUDED."baseUserVersion")
`;

async function activeYear(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'`;
  if (rows.length === 1) return rows[0]!.year;
  if (rows.length > 1) {
    throw new DomainError(
      "YEAR_MISMATCH",
      "활성 학년도가 둘 이상입니다. 관리자 설정에서 활성 학년도를 하나만 남긴 뒤 다시 시도하세요.",
    );
  }

  // 마이그레이션이 미리 넣어 두는 것이 정상이고, 이 삽입은 방어용이다.
  await tx.$executeRaw`
    INSERT INTO "AcademicYear" ("year", "state", "version", "createdAt", "updatedAt")
    VALUES (${INITIAL_ACADEMIC_YEAR}, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("year") DO NOTHING
  `;

  const retry = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'`;
  if (retry.length !== 1) {
    throw new DomainError(
      "YEAR_MISMATCH",
      "활성 학년도가 없어 사용자 정보를 저장할 수 없습니다. 관리자 설정에서 학년도를 활성으로 바꾼 뒤 다시 시도하세요.",
    );
  }
  return retry[0]!.year;
}

/**
 * ACTIVE 학년도의 기록·명부를 `User` 현재값에 맞춘다. 집합 기반 고정 문장만 쓰므로
 * 어떤 입력도 unique·check 위반으로 기존 쓰기를 실패시키지 못한다. 좌석·이메일이
 * 겹치면 값을 지어내지 않고 양쪽을 `needsReview`로 남기고, 겹침이 풀리면 같은
 * 식으로 다시 계산해 양쪽에서 내린다.
 */
export async function mirrorUsersToActiveYear(tx: Tx, userIds: number[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;

  const year = await activeYear(tx);

  await tx.$executeRawUnsafe(CLEAR_EMAIL_KEYS_SQL);
  await tx.$executeRawUnsafe(FILL_EMAIL_KEYS_SQL);

  await tx.$executeRawUnsafe(PARK_MOVED_RECORDS_SQL, year, ids);
  const written = await tx.$queryRawUnsafe<{ userId: number }[]>(UPSERT_RECORDS_SQL, year, ids);

  // 명부 값이 실제로 바뀐 사람만 행 버전을 올린다. Release B의 오래된 파일 판정이
  // 기존 경로의 수정도 보게 하려면 baseUserVersion을 찍기 전에 끝나야 한다.
  if (written.length > 0) {
    await tx.$executeRawUnsafe(BUMP_PROFILE_VERSION_SQL, written.map((row) => row.userId));
  }

  const flagged = await tx.$executeRawUnsafe(REVIEW_SET_SQL, year);
  const cleared = await tx.$executeRawUnsafe(REVIEW_CLEAR_SQL, year);

  await tx.$executeRawUnsafe(UPSERT_ENTRIES_SQL, year, ids);

  if (written.length + flagged + cleared > 0) {
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
