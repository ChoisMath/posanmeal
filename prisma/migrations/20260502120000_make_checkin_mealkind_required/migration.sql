UPDATE "CheckIn"
SET "mealKind" = 'DINNER'
WHERE "mealKind" IS NULL;

ALTER TABLE "CheckIn"
  ALTER COLUMN "mealKind" SET NOT NULL;

ALTER TABLE "CheckIn"
  DROP CONSTRAINT "CheckIn_userId_date_key";

ALTER TABLE "CheckIn"
  ADD CONSTRAINT "CheckIn_userId_date_mealKind_key" UNIQUE ("userId", "date", "mealKind");
