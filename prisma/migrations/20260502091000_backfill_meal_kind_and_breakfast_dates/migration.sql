UPDATE "CheckIn"
SET "mealKind" = 'DINNER'
WHERE "mealKind" IS NULL;

INSERT INTO "MealApplicationDate"("applicationId", "date")
SELECT a.id, d::date
FROM "MealApplication" a,
     generate_series(a."mealStart", a."mealEnd", interval '1 day') d
WHERE a.type = 'BREAKFAST'
  AND a."mealStart" IS NOT NULL
  AND a."mealEnd" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "MealRegistrationDate"("registrationId", "date")
SELECT r.id, mad.date
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
JOIN "MealApplicationDate" mad ON mad."applicationId" = a.id
WHERE a.type = 'BREAKFAST'
  AND r.status = 'APPROVED'
ON CONFLICT DO NOTHING;
