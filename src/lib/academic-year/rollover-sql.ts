/**
 * 학년도 전환이 쓰는 고정 SQL. 값은 전부 바인딩이고 문자열 조립이 없다.
 * 명부 자체를 쓰는 문장은 `roster-write-sql.ts`를 그대로 재사용한다 — 여기에는
 * 전환에만 있는 일(초안 항목 연결·종료자 정리·경고 집계)만 둔다.
 */

/** 원본 학년도의 소속 상태. 대조는 재학·재직이면서 이용 중인 사람만 본다. */
export const SOURCE_MEMBERS_SQL = `
  SELECT r."userId", r."role"::text AS "role", r."memberState", r."grade", u."accessState"
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  WHERE r."year" = $1::int
`;

/** 초안 행이 가리키는 계정. 이메일로도 id로도 찾아 역할·이용 상태를 확인한다. */
export const ROLLOVER_ACCOUNTS_SQL = `
  SELECT u."id", COALESCE(u."emailKey", lower(btrim(u."email"))) AS "emailKey",
         u."role"::text AS "role", u."accessState"
  FROM "User" u
  WHERE COALESCE(u."emailKey", lower(btrim(u."email"))) = ANY($1::text[])
     OR u."id" = ANY($2::int[])
`;

/**
 * 두 경고를 한 번에 센다. $1 오늘(KST), $2 종료 결정 사용자, $3~$4 원본 학년도 범위.
 * 3월 1일 이전 전환에서는 오늘이 원본 범위 시작보다 빠를 수 있어 둘 중 늦은 날부터 센다.
 */
export const ROLLOVER_MEAL_DATE_WARNINGS_SQL = `
  SELECT
    count(*) FILTER (WHERE reg."userId" = ANY($2::int[]) AND d."date" >= $1::date)::int
      AS "futureMealDatesOfLeavers",
    count(*) FILTER (
      WHERE d."date" >= GREATEST($1::date, $3::date) AND d."date" <= $4::date
    )::int AS "remainingMealDatesInSourceYear"
  FROM "MealRegistrationMealDate" d
  JOIN "MealRegistration" reg ON reg."id" = d."registrationId"
  WHERE reg."status" = 'APPROVED'
`;

/**
 * 확정된 초안 항목을 계정에 잇는다. 원래 entryId를 그대로 두므로 화면이 보던 행
 * id가 전환 뒤에도 같고, 초안 값은 계정·기록으로 옮겨 갔으니 비운다.
 */
export const LINK_ROLLOVER_ENTRIES_SQL = `
  UPDATE "RosterEntry" e SET
    "userId" = v.user_id,
    "draftEmail" = NULL,
    "draftProfile" = NULL,
    "baseUserVersion" = u."profileVersion",
    "version" = e."version" + 1
  FROM unnest($2::text[], $3::int[]) AS v(entry_id, user_id)
  JOIN "User" u ON u."id" = v.user_id
  WHERE e."year" = $1::int AND e."id" = v.entry_id
`;

/** 종료 결정된 사람의 초안 후보 행만 지운다. 원본 학년도 명부는 건드리지 않는다. */
export const DELETE_LEAVER_ENTRIES_SQL = `
  DELETE FROM "RosterEntry"
  WHERE "year" = $1::int AND "included" = false AND "userId" = ANY($2::int[])
`;

/**
 * 종료자의 원본 학년도 기록. 학급값은 그 해의 사실이므로 보존하고 소속 상태만
 * 옮긴다. 이 갱신이 좌석 부분 색인에서 그 행을 빼 다음 사람이 그 자리에 앉을 수 있다.
 */
export const LEAVER_MEMBER_STATE_SQL = `
  UPDATE "UserAcademicRecord" r SET
    "memberState" = v.member_state,
    "version" = r."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM unnest($2::int[], $3::text[]) AS v(user_id, member_state)
  WHERE r."year" = $1::int AND r."userId" = v.user_id AND r."memberState" <> v.member_state
`;

/** 검토 메타데이터만 남긴다. content version은 올리지 않는다(Step 4). */
export const SET_REVIEWED_SQL = `
  UPDATE "AcademicYear"
  SET "reviewedVersion" = $2::int, "reviewedSourceVersion" = $3::int,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "year" = $1::int
`;

/** 한 사람의 좌석이 그 학년도에서 아직 비어 있는지. 비어 있지 않으면 되돌릴 수 없다. */
export const SEAT_HELD_BY_OTHER_SQL = `
  SELECT r."userId" FROM "UserAcademicRecord" r
  WHERE r."year" = $1::int AND r."role" = 'STUDENT' AND r."memberState" = 'ENROLLED'
    AND r."grade" = $2::int AND r."classNum" = $3::int AND r."number" = $4::int
    AND r."userId" <> $5::int
  LIMIT 1
`;
