-- AlterTable: MealApplication에 새 컬럼 5개 추가 (additive, nullable)
ALTER TABLE "MealApplication"
  ADD COLUMN "applyStartAt" TIMESTAMP(3),
  ADD COLUMN "applyEndAt"   TIMESTAMP(3),
  ADD COLUMN "startYear"    INTEGER,
  ADD COLUMN "startMonth"   INTEGER,
  ADD COLUMN "monthCount"   INTEGER;

-- CreateTable: MealApplicationMeal
CREATE TABLE "MealApplicationMeal" (
    "applicationId"       INTEGER NOT NULL,
    "mealKind"            "MealKind" NOT NULL,
    "price"               INTEGER NOT NULL DEFAULT 0,
    "exemptionSelectable" BOOLEAN NOT NULL DEFAULT false,
    "method"              TEXT NOT NULL DEFAULT 'NONE',

    CONSTRAINT "MealApplicationMeal_pkey" PRIMARY KEY ("applicationId", "mealKind")
);

-- CreateTable: MealApplicationMealDate
CREATE TABLE "MealApplicationMealDate" (
    "applicationId" INTEGER NOT NULL,
    "mealKind"      "MealKind" NOT NULL,
    "grade"         INTEGER NOT NULL,
    "date"          DATE NOT NULL,

    CONSTRAINT "MealApplicationMealDate_pkey" PRIMARY KEY ("applicationId", "mealKind", "grade", "date")
);

-- CreateIndex
CREATE INDEX "MealApplicationMealDate_date_mealKind_idx" ON "MealApplicationMealDate"("date", "mealKind");

-- CreateTable: MealRegistrationMeal
CREATE TABLE "MealRegistrationMeal" (
    "registrationId"  INTEGER NOT NULL,
    "mealKind"        "MealKind" NOT NULL,
    "applied"         BOOLEAN NOT NULL DEFAULT false,
    "exempt"          BOOLEAN NOT NULL DEFAULT false,
    "weekdaysByMonth" TEXT,

    CONSTRAINT "MealRegistrationMeal_pkey" PRIMARY KEY ("registrationId", "mealKind")
);

-- CreateTable: MealRegistrationMealDate
CREATE TABLE "MealRegistrationMealDate" (
    "registrationId" INTEGER NOT NULL,
    "mealKind"       "MealKind" NOT NULL,
    "date"           DATE NOT NULL,

    CONSTRAINT "MealRegistrationMealDate_pkey" PRIMARY KEY ("registrationId", "mealKind", "date")
);

-- CreateIndex
CREATE INDEX "MealRegistrationMealDate_date_mealKind_idx" ON "MealRegistrationMealDate"("date", "mealKind");

-- AddForeignKey
ALTER TABLE "MealApplicationMeal" ADD CONSTRAINT "MealApplicationMeal_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "MealApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealApplicationMealDate" ADD CONSTRAINT "MealApplicationMealDate_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "MealApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRegistrationMeal" ADD CONSTRAINT "MealRegistrationMeal_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "MealRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRegistrationMealDate" ADD CONSTRAINT "MealRegistrationMealDate_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "MealRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 백필: 기존 공고 → 새 구조 =====

-- 1) 공고 메타 (KST 00:00 / 23:59 환산)
UPDATE "MealApplication" SET
  "applyStartAt" = ("applyStart"::timestamp - interval '9 hours'),
  "applyEndAt"   = ("applyEnd"::timestamp + interval '14 hours 59 minutes'),
  "startYear"  = EXTRACT(YEAR  FROM COALESCE("mealStart", "applyStart"))::int,
  "startMonth" = EXTRACT(MONTH FROM COALESCE("mealStart", "applyStart"))::int,
  "monthCount" = GREATEST(1,
    ((EXTRACT(YEAR FROM COALESCE("mealEnd","applyEnd")) - EXTRACT(YEAR FROM COALESCE("mealStart","applyStart"))) * 12
     + EXTRACT(MONTH FROM COALESCE("mealEnd","applyEnd")) - EXTRACT(MONTH FROM COALESCE("mealStart","applyStart")) + 1)::int)
WHERE "applyStartAt" IS NULL;

-- 2) 식사 설정: type → mealKind 1행 (가격 0, 날짜선택)
INSERT INTO "MealApplicationMeal" ("applicationId","mealKind","price","exemptionSelectable","method")
SELECT id,
       CASE WHEN type = 'BREAKFAST' THEN 'BREAKFAST'::"MealKind" ELSE 'DINNER'::"MealKind" END,
       0, false, 'DATE'
FROM "MealApplication"
ON CONFLICT DO NOTHING;

-- 3) 개설일: BREAKFAST는 allowedDates, DINNER는 mealStart~mealEnd 전개. 학년 1·2·3 복제
INSERT INTO "MealApplicationMealDate" ("applicationId","mealKind","grade","date")
SELECT ad."applicationId", 'BREAKFAST'::"MealKind", g.grade, ad.date
FROM "MealApplicationDate" ad
JOIN "MealApplication" a ON a.id = ad."applicationId" AND a.type = 'BREAKFAST'
CROSS JOIN (VALUES (1),(2),(3)) AS g(grade)
ON CONFLICT DO NOTHING;

INSERT INTO "MealApplicationMealDate" ("applicationId","mealKind","grade","date")
SELECT a.id, 'DINNER'::"MealKind", g.grade, d::date
FROM "MealApplication" a
CROSS JOIN LATERAL generate_series(a."mealStart", a."mealEnd", interval '1 day') AS d
CROSS JOIN (VALUES (1),(2),(3)) AS g(grade)
WHERE a.type <> 'BREAKFAST' AND a."mealStart" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4) 신청별 식사 행
INSERT INTO "MealRegistrationMeal" ("registrationId","mealKind","applied","exempt")
SELECT r.id,
       CASE WHEN a.type = 'BREAKFAST' THEN 'BREAKFAST'::"MealKind" ELSE 'DINNER'::"MealKind" END,
       (r.status = 'APPROVED'), false
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
ON CONFLICT DO NOTHING;

-- 5) 신청별 확정 날짜
INSERT INTO "MealRegistrationMealDate" ("registrationId","mealKind","date")
SELECT rd."registrationId", 'BREAKFAST'::"MealKind", rd.date
FROM "MealRegistrationDate" rd
JOIN "MealRegistration" r ON r.id = rd."registrationId"
JOIN "MealApplication" a ON a.id = r."applicationId" AND a.type = 'BREAKFAST'
ON CONFLICT DO NOTHING;

INSERT INTO "MealRegistrationMealDate" ("registrationId","mealKind","date")
SELECT r.id, 'DINNER'::"MealKind", d::date
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
CROSS JOIN LATERAL generate_series(a."mealStart", a."mealEnd", interval '1 day') AS d
WHERE a.type <> 'BREAKFAST' AND a."mealStart" IS NOT NULL
ON CONFLICT DO NOTHING;
