-- CreateTable
CREATE TABLE "MealApplication" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "applyStart" DATE NOT NULL,
    "applyEnd" DATE NOT NULL,
    "mealStart" DATE,
    "mealEnd" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealRegistration" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "addedBy" TEXT,

    CONSTRAINT "MealRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealApplication_status_idx" ON "MealApplication"("status");

-- CreateIndex
CREATE INDEX "MealApplication_applyStart_applyEnd_idx" ON "MealApplication"("applyStart", "applyEnd");

-- CreateIndex
CREATE UNIQUE INDEX "MealRegistration_applicationId_userId_key" ON "MealRegistration"("applicationId", "userId");

-- CreateIndex
CREATE INDEX "MealRegistration_userId_idx" ON "MealRegistration"("userId");

-- CreateIndex
CREATE INDEX "MealRegistration_applicationId_status_idx" ON "MealRegistration"("applicationId", "status");

-- AddForeignKey
ALTER TABLE "MealRegistration" ADD CONSTRAINT "MealRegistration_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "MealApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRegistration" ADD CONSTRAINT "MealRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
