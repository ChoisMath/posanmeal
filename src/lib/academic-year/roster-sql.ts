/**
 * 초기 이전(backfill)과 호환 쓰기(compat-write)가 같은 규칙으로 충돌을 판정하도록
 * 두 곳이 공유하는 SQL 조각. 미리 계산한 id 목록이 아니라 문장 안에서 그룹을
 * 다시 세므로, 사이에 들어온 행이 있어도 판정이 어긋나지 않는다.
 */
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

/** `keyed`의 행을 `k`로 참조하는 문장에서만 쓴다. */
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
