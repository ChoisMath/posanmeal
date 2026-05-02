-- BREAKFAST applications with no allowed dates after backfill.
SELECT a.id, a.title
FROM "MealApplication" a
LEFT JOIN "MealApplicationDate" mad ON mad."applicationId" = a.id
WHERE a.type = 'BREAKFAST'
GROUP BY a.id, a.title
HAVING COUNT(mad."date") = 0;

-- APPROVED BREAKFAST registrations with no selected dates after backfill.
SELECT r.id
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
LEFT JOIN "MealRegistrationDate" mrd ON mrd."registrationId" = r.id
WHERE a.type = 'BREAKFAST'
  AND r.status = 'APPROVED'
GROUP BY r.id
HAVING COUNT(mrd."date") = 0;

-- selectedDates outside their application's allowedDates.
SELECT mrd."registrationId", mrd."date"
FROM "MealRegistrationDate" mrd
JOIN "MealRegistration" r ON r.id = mrd."registrationId"
LEFT JOIN "MealApplicationDate" mad
  ON mad."applicationId" = r."applicationId"
 AND mad."date" = mrd."date"
WHERE mad."date" IS NULL;

-- Must be zero before the destructive NOT NULL/unique migration.
SELECT COUNT(*) FROM "CheckIn" WHERE "mealKind" IS NULL;
