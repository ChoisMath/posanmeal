-- AlterTable
ALTER TABLE "MealApplication" ALTER COLUMN "type" SET DEFAULT 'MULTI';
ALTER TABLE "MealApplication" ALTER COLUMN "applyStart" DROP NOT NULL;
ALTER TABLE "MealApplication" ALTER COLUMN "applyEnd" DROP NOT NULL;
