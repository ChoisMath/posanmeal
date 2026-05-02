UPDATE "CheckIn"
SET "mealKind" = 'DINNER'
WHERE "mealKind" IS NULL;

ALTER TABLE "CheckIn"
  ALTER COLUMN "mealKind" SET NOT NULL;

ALTER TABLE "CheckIn"
  DROP CONSTRAINT IF EXISTS "CheckIn_userId_date_key";

DROP INDEX IF EXISTS "CheckIn_userId_date_key";

CREATE UNIQUE INDEX "CheckIn_userId_date_mealKind_key"
  ON "CheckIn"("userId", "date", "mealKind");
