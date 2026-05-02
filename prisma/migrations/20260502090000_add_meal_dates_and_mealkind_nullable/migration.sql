CREATE TYPE "MealKind" AS ENUM ('BREAKFAST', 'DINNER');

CREATE TABLE "MealApplicationDate" (
  "applicationId" INTEGER NOT NULL,
  "date" DATE NOT NULL,

  CONSTRAINT "MealApplicationDate_pkey" PRIMARY KEY ("applicationId", "date"),
  CONSTRAINT "MealApplicationDate_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "MealApplication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MealApplicationDate_date_idx" ON "MealApplicationDate"("date");

CREATE TABLE "MealRegistrationDate" (
  "registrationId" INTEGER NOT NULL,
  "date" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MealRegistrationDate_pkey" PRIMARY KEY ("registrationId", "date"),
  CONSTRAINT "MealRegistrationDate_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "MealRegistration"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MealRegistrationDate_date_idx" ON "MealRegistrationDate"("date");

ALTER TABLE "MealRegistration"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CheckIn"
  ADD COLUMN "mealKind" "MealKind";

CREATE INDEX "CheckIn_date_mealKind_idx" ON "CheckIn"("date", "mealKind");

INSERT INTO "SystemSetting"("key", "value", "updatedAt") VALUES
  ('breakfast_window_start', '04:00', NOW()),
  ('breakfast_window_end', '10:00', NOW()),
  ('dinner_window_start', '15:00', NOW()),
  ('dinner_window_end', '21:00', NOW())
ON CONFLICT ("key") DO NOTHING;
