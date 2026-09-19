/**
 * 명부 쓰기가 쓰는 고정 SQL. 값은 전부 바인딩이고 문자열 조립이 없다.
 * 조회 쪽은 `roster-service.ts`에, 호환 쓰기와 공유하는 needsReview 재계산은
 * `roster-sql.ts`에 있다.
 */

/** $1은 학년도, $2~$16은 행 배열이다. 행 수가 늘어도 문장 수는 그대로다. */
export const UNNEST_ROWS = `
  unnest(
    $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[],
    $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::text[],
    $14::text[], $15::bool[], $16::int[]
  ) AS v(
    entry_id, user_id, email, email_key, role, name,
    grade, class_num, number, gender, subject, homeroom,
    position, included, base_user_version
  )
`;

/** 교사 Excel에는 성별 칸이 없다. 값이 오지 않으면 저장된 값을 지키고 덮지 않는다. */
const genderKept = (keep: string) =>
  `CASE WHEN v.role = 'TEACHER' AND v.gender IS NULL THEN ${keep} ELSE v.gender END`;

/**
 * 좌석이 바뀌는 행을 부분 unique 색인 밖(자기 id의 음수)으로 먼저 뺀다. 같은 문장
 * 안에서 두 학생이 좌석을 맞바꿔도 행 단위 검사가 중간 상태에서 23505를 내지 않는다.
 * `-userId`는 사용자마다 다르므로 밀어낸 자리끼리도 겹치지 않는다.
 */
export const PARK_SEATS_SQL = `
  UPDATE "UserAcademicRecord" r SET "number" = -r."userId"
  FROM ${UNNEST_ROWS}
  WHERE r."year" = $1::int AND r."userId" = v.user_id AND r."role" = 'STUDENT'
    AND (r."grade", r."classNum", r."number") IS DISTINCT FROM (v.grade, v.class_num, v.number)
`;

export const UPSERT_RECORDS_SQL = `
  INSERT INTO "UserAcademicRecord" (
    "year", "userId", "role", "name", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "memberState", "needsReview", "version", "updatedAt"
  )
  SELECT $1::int, v.user_id, v.role::"Role", v.name, v.grade, v.class_num, v.number,
         v.gender::"Gender", v.subject, v.homeroom, v.position,
         CASE WHEN v.role = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END,
         false, 0, CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "role" = EXCLUDED."role",
    "name" = EXCLUDED."name",
    "grade" = EXCLUDED."grade",
    "classNum" = EXCLUDED."classNum",
    "number" = EXCLUDED."number",
    "gender" = CASE
      WHEN EXCLUDED."role" = 'TEACHER' AND EXCLUDED."gender" IS NULL
      THEN "UserAcademicRecord"."gender" ELSE EXCLUDED."gender" END,
    "subject" = EXCLUDED."subject",
    "homeroom" = EXCLUDED."homeroom",
    "position" = EXCLUDED."position",
    "memberState" = CASE
      WHEN "UserAcademicRecord"."role" = EXCLUDED."role"
      THEN "UserAcademicRecord"."memberState" ELSE EXCLUDED."memberState" END,
    "version" = "UserAcademicRecord"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE (
      "UserAcademicRecord"."role", "UserAcademicRecord"."name", "UserAcademicRecord"."grade",
      "UserAcademicRecord"."classNum", "UserAcademicRecord"."number", "UserAcademicRecord"."gender",
      "UserAcademicRecord"."subject", "UserAcademicRecord"."homeroom", "UserAcademicRecord"."position"
    ) IS DISTINCT FROM (
      EXCLUDED."role", EXCLUDED."name", EXCLUDED."grade",
      EXCLUDED."classNum", EXCLUDED."number",
      CASE WHEN EXCLUDED."role" = 'TEACHER' AND EXCLUDED."gender" IS NULL
           THEN "UserAcademicRecord"."gender" ELSE EXCLUDED."gender" END,
      EXCLUDED."subject", EXCLUDED."homeroom", EXCLUDED."position"
    )
  RETURNING "userId"
`;

/**
 * $17은 "계정의 이메일은 그대로 둔다"는 뜻이다. 화면 편집·전환은 true로 보내
 * 전용 이메일 변경 뒤의 로그인 주소를 오래된 명부 스냅샷이 되돌리지 않도록 한다.
 */
const emailKept = (keep: string) => `CASE WHEN $17::bool THEN ${keep} ELSE v.email END`;
const emailKeyKept = (keep: string) => `CASE WHEN $17::bool THEN ${keep} ELSE v.email_key END`;

export const UPDATE_USERS_SQL = `
  UPDATE "User" u SET
    "email" = ${emailKept('u."email"')},
    "emailKey" = ${emailKeyKept('u."emailKey"')},
    "name" = v.name, "role" = v.role::"Role",
    "grade" = v.grade, "classNum" = v.class_num, "number" = v.number,
    "gender" = (${genderKept('u."gender"::text')})::"Gender",
    "subject" = v.subject, "homeroom" = v.homeroom, "position" = v.position,
    "profileVersion" = u."profileVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  WHERE u."id" = v.user_id
    AND $1::int IS NOT NULL
    AND (
      u."email", u."emailKey", u."name", u."role"::text, u."grade", u."classNum",
      u."number", u."gender"::text, u."subject", u."homeroom", u."position"
    ) IS DISTINCT FROM (
      ${emailKept('u."email"')}, ${emailKeyKept('u."emailKey"')},
      v.name, v.role, v.grade, v.class_num,
      v.number, ${genderKept('u."gender"::text')}, v.subject, v.homeroom, v.position
    )
  RETURNING u."id"
`;

/**
 * 확정 연도의 명부 항목. 기존 항목이 있으면 그 id를 그대로 써서 (year, emailKey)
 * 색인과 (year, userId) 색인이 서로 다른 행을 가리키는 상태를 만들지 않는다.
 * 주소 검사 직후 전용 이메일 변경이 끝날 수도 있어 키는 최신 계정에서 가져온다.
 *
 * $17은 "호출자가 included를 직접 정한다"는 뜻이다. 셀 편집 같은 보통의 쓰기는
 * false로 보내고, 그러면 관리자가 명부에서 뺀 사람(included=false)이 남의 이름
 * 수정에 휩쓸려 조용히 다시 들어오지 않는다. 전환 검토만 true로 보낸다.
 */
export const UPSERT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "included", "baseUserVersion", "version"
  )
  SELECT COALESCE(e."id", v.entry_id), $1::int, v.user_id,
         COALESCE(u."emailKey", lower(btrim(u."email"))), v.included, u."profileVersion", 0
  FROM ${UNNEST_ROWS}
  JOIN "User" u ON u."id" = v.user_id
  LEFT JOIN "RosterEntry" e ON e."year" = $1::int AND e."userId" = v.user_id
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "included" = CASE WHEN $17::bool THEN EXCLUDED."included" ELSE "RosterEntry"."included" END,
    "baseUserVersion" = EXCLUDED."baseUserVersion",
    "version" = "RosterEntry"."version" + 1
  WHERE (
    "RosterEntry"."emailKey", "RosterEntry"."included", "RosterEntry"."baseUserVersion"
  ) IS DISTINCT FROM (
    EXCLUDED."emailKey",
    CASE WHEN $17::bool THEN EXCLUDED."included" ELSE "RosterEntry"."included" END,
    EXCLUDED."baseUserVersion"
  )
`;

/**
 * 초안 항목을 저장할 때 `baseUserVersion`을 그 계정의 현재 `profileVersion`으로 다시
 * 찍는다. "이 행을 지금의 계정 값과 맞춰 봤다"는 표시이며, 전환 검토가 초안을 뜬 뒤
 * 계정이 바뀐 행(STALE_ACCOUNT)을 이 값으로 가려낸다.
 */
export const UPSERT_DRAFT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "draftEmail", "draftProfile",
    "included", "baseUserVersion", "version"
  )
  SELECT v.entry_id, $1::int, v.user_id, v.email_key, v.email,
         jsonb_build_object(
           'role', v.role, 'name', v.name, 'grade', v.grade, 'classNum', v.class_num,
           'number', v.number, 'gender', v.gender, 'subject', v.subject,
           'homeroom', v.homeroom, 'position', v.position
         ),
         v.included, COALESCE(u."profileVersion", v.base_user_version), 0
  FROM ${UNNEST_ROWS}
  LEFT JOIN "User" u ON u."id" = v.user_id
  ON CONFLICT ("id") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "draftEmail" = EXCLUDED."draftEmail",
    "draftProfile" = EXCLUDED."draftProfile",
    "baseUserVersion" = EXCLUDED."baseUserVersion",
    "included" = CASE WHEN $17::bool THEN EXCLUDED."included" ELSE "RosterEntry"."included" END,
    "version" = "RosterEntry"."version" + 1
  WHERE (
    "RosterEntry"."emailKey", "RosterEntry"."draftEmail",
    "RosterEntry"."draftProfile", "RosterEntry"."baseUserVersion", "RosterEntry"."included"
  ) IS DISTINCT FROM (
    EXCLUDED."emailKey", EXCLUDED."draftEmail", EXCLUDED."draftProfile",
    EXCLUDED."baseUserVersion",
    CASE WHEN $17::bool THEN EXCLUDED."included" ELSE "RosterEntry"."included" END
  )
  RETURNING "id"
`;

export const INSERT_USERS_SQL = `
  INSERT INTO "User" (
    "email", "emailKey", "name", "role", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "createdAt", "updatedAt"
  )
  SELECT v.email, v.email_key, v.name, v.role::"Role", v.grade, v.class_num, v.number,
         v.gender::"Gender", v.subject, v.homeroom, v.position,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  -- $1은 이 문장이 쓰지 않는 학년도다. 모든 문장이 같은 인자 목록을 받도록
  -- 여기서 형만 붙여 둔다 — 빠지면 Postgres가 $1의 형을 정하지 못한다(42P18).
  WHERE v.user_id IS NULL AND $1::int IS NOT NULL
  RETURNING "id", "emailKey"
`;

/**
 * 초안에서 "이 사람은 파일에 없었다"만 기록한다. 이름·이메일·초안 값은 건드리지
 * 않으므로, 미리보기 이후 누군가 그 사람을 고쳤더라도 그 수정이 지워지지 않는다.
 */
export const EXCLUDE_DRAFT_ENTRIES_SQL = `
  UPDATE "RosterEntry"
  SET "included" = false, "version" = "version" + 1
  WHERE "year" = $1::int AND "id" = ANY($2::text[]) AND "included" = true
  RETURNING "id"
`;

export const BUMP_YEAR_SQL = `
  UPDATE "AcademicYear" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "year" = $1::int
`;

export const EMAIL_TAKEN_SQL = `
  SELECT u."id" FROM "User" u
  JOIN unnest($1::text[], $2::text[], $3::int[]) AS v(email_key, email, user_id)
    ON (u."emailKey" = v.email_key OR u."email" = v.email)
  WHERE v.user_id IS NULL OR u."id" <> v.user_id
  LIMIT 1
`;

export const SEAT_TAKEN_SQL = `
  SELECT r."grade", r."classNum", r."number", u."accessState"
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  JOIN unnest($2::int[], $3::int[], $4::int[]) AS v(grade, class_num, number)
    ON r."grade" = v.grade AND r."classNum" = v.class_num AND r."number" = v.number
  WHERE r."year" = $1::int AND r."role" = 'STUDENT' AND r."memberState" = 'ENROLLED'
    AND NOT (r."userId" = ANY($5::int[]))
  LIMIT 1
`;

export const DRAFT_EMAIL_TAKEN_SQL = `
  SELECT e."id" FROM "RosterEntry" e
  JOIN unnest($2::text[], $3::text[]) AS v(email_key, entry_id) ON e."emailKey" = v.email_key
  WHERE e."year" = $1::int AND e."id" <> v.entry_id
  LIMIT 1
`;

/** 확정 연도 쓰기 중 기록이 아직 없는 사용자. 지난 학년도에는 새 기록을 만들지 않는다. */
export const MISSING_RECORDS_SQL = `
  SELECT v.user_id AS "userId"
  FROM unnest($2::int[]) AS v(user_id)
  WHERE v.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "UserAcademicRecord" r
      WHERE r."year" = $1::int AND r."userId" = v.user_id
    )
  LIMIT 1
`;

/**
 * 원본 학년도의 명부를 그대로 초안으로 복사한다. 자동 진급도, `User` 생성도,
 * 로그인 활성화도 하지 않는다. `needsReview`가 선 행도 그대로 가져온다 — 관리자가
 * 초안에서 보고 고쳐야 하는 행이 바로 그 행이다.
 */
/** 선택 삭제 전 소속 확인. 넘긴 id 중 이 학년도 것이 아닌 항목이 있으면 빠진다. */
export const OWNED_ROSTER_ENTRY_IDS_SQL = `
  SELECT "id" FROM "RosterEntry" WHERE "year" = $1::int AND "id" = ANY($2::text[])
`;

/** ARCHIVED 학년도의 명부 항목만 지운다. Record·User·신청·체크인은 손대지 않는다. */
export const DELETE_ARCHIVED_ROSTER_ALL_SQL = `
  DELETE FROM "RosterEntry" WHERE "year" = $1::int
  RETURNING "id", "userId"
`;

export const DELETE_ARCHIVED_ROSTER_SELECTED_SQL = `
  DELETE FROM "RosterEntry" WHERE "year" = $1::int AND "id" = ANY($2::text[])
  RETURNING "id", "userId"
`;

/** 전체 삭제(`"ALL"`)에서만 같은 트랜잭션으로 그 학년도의 사본을 함께 정리한다. */
export const DELETE_YEAR_ROSTER_FILES_SQL = `
  DELETE FROM "RosterFile" WHERE "year" = $1::int
`;

export const CLEAR_YEAR_ROSTER_IMPORTS_SQL = `
  UPDATE "RosterImport" SET "payload" = NULL, "preview" = NULL WHERE "year" = $1::int
`;

export const COPY_DRAFT_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "draftEmail", "draftProfile",
    "included", "baseUserVersion", "version"
  )
  SELECT gen_random_uuid()::text, $1::int, u."id", u."emailKey", u."email",
         jsonb_build_object(
           'role', r."role"::text, 'name', r."name",
           'grade', r."grade", 'classNum', r."classNum", 'number', r."number",
           'gender', r."gender"::text, 'subject', r."subject",
           'homeroom', r."homeroom", 'position', r."position"
         ),
         true, u."profileVersion", 0
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  JOIN "RosterEntry" src
    ON src."year" = r."year" AND src."userId" = r."userId" AND src."included" = true
  WHERE r."year" = $2::int AND u."emailKey" IS NOT NULL
`;
