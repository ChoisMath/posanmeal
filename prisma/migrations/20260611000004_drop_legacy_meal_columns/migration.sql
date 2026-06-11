-- DropTable: 구 날짜 테이블 (자식 먼저 → MealApplicationDate, MealRegistrationDate)
DROP TABLE IF EXISTS "MealApplicationDate";
DROP TABLE IF EXISTS "MealRegistrationDate";

-- DropIndex: 구 applyStart/applyEnd 복합 인덱스
DROP INDEX IF EXISTS "MealApplication_applyStart_applyEnd_idx";

-- AlterTable: MealApplication 구 컬럼 제거
ALTER TABLE "MealApplication" DROP COLUMN IF EXISTS "type";
ALTER TABLE "MealApplication" DROP COLUMN IF EXISTS "applyStart";
ALTER TABLE "MealApplication" DROP COLUMN IF EXISTS "applyEnd";
ALTER TABLE "MealApplication" DROP COLUMN IF EXISTS "mealStart";
ALTER TABLE "MealApplication" DROP COLUMN IF EXISTS "mealEnd";
