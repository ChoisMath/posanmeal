/**
 * 초기 이전(backfill)과 호환 쓰기(compat-write)가 같은 규칙으로 충돌을 판정하도록
 * 두 곳이 공유하는 SQL 조각. 미리 계산한 id 목록이 아니라 문장 안에서 그룹을
 * 다시 세므로, 사이에 들어온 행이 있어도 판정이 어긋나지 않는다.
 */

/** 초기 이전용. 아직 기록이 없으므로 그룹을 `User`에서 센다. */
export const CONFLICT_GROUPS_CTE = `
  "keyed" AS (
    SELECT u.*, lower(btrim(u.email)) AS "emailKeyValue" FROM "User" u
  ),
  "emailDup" AS (
    SELECT "emailKeyValue" FROM "keyed" GROUP BY "emailKeyValue" HAVING count(*) > 1
  ),
  "seatDup" AS (
    SELECT "grade", "classNum", "number" FROM "keyed"
    WHERE "role" = 'STUDENT' AND "grade" IS NOT NULL AND "classNum" IS NOT NULL AND "number" IS NOT NULL
    GROUP BY "grade", "classNum", "number" HAVING count(*) > 1
  )
`;

/**
 * 호환 쓰기용. $1은 학년도다. 좌석 유일성은 기록에 걸린 부분 색인의 성질이라
 * `UserAcademicRecord`에서, 이메일 유일성은 `User.emailKey`의 성질이라
 * `User`에서 센다. `keyed`·`emailDup`·`seatDup`의 이름과 컬럼은 위와 같아
 * 아래 판정식을 그대로 쓸 수 있다.
 */
export const MIRROR_CONFLICT_GROUPS_CTE = `
  "keyed" AS (
    SELECT r.*, lower(btrim(u.email)) AS "emailKeyValue"
    FROM "UserAcademicRecord" r
    JOIN "User" u ON u."id" = r."userId"
    WHERE r."year" = $1::int
  ),
  "emailDup" AS (
    SELECT lower(btrim(u.email)) AS "emailKeyValue" FROM "User" u
    GROUP BY lower(btrim(u.email)) HAVING count(*) > 1
  ),
  "seatDup" AS (
    SELECT "grade", "classNum", "number" FROM "keyed"
    WHERE "role" = 'STUDENT' AND "memberState" = 'ENROLLED'
      AND "grade" IS NOT NULL AND "classNum" IS NOT NULL AND "number" IS NOT NULL
    GROUP BY "grade", "classNum", "number" HAVING count(*) > 1
  )
`;

/**
 * `keyed`의 행을 `k`로 참조하는 문장에서만 쓴다.
 *
 * Release A 동안 `needsReview`는 순수한 파생값이다 — 지금 데이터로 다시 계산할 수
 * 있는 세 가지(필수값 누락·좌석 중복·정규화 이메일 중복)뿐이고, 이 식 말고는
 * 아무도 이 칸을 쓰지 않는다. 그래서 호환 쓰기가 매번 전체를 다시 계산해도
 * 사람이 남긴 판단을 지울 위험이 없다. Task 5가 관리자 검토 도구를 들이면서
 * "사람이 세운 플래그"가 생기면 이 전제를 먼저 다시 봐야 한다.
 */
export const NEEDS_REVIEW_EXPR = `
  (
    (k."role" = 'STUDENT' AND (k."grade" IS NULL OR k."classNum" IS NULL OR k."number" IS NULL OR k."gender" IS NULL))
    OR (k."role" = 'STUDENT' AND EXISTS (
      SELECT 1 FROM "seatDup" s
      WHERE s."grade" = k."grade" AND s."classNum" = k."classNum" AND s."number" = k."number"
    ))
    OR EXISTS (SELECT 1 FROM "emailDup" e WHERE e."emailKeyValue" = k."emailKeyValue")
  )
`;
