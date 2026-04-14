-- CreateEnum
CREATE TYPE "AdminLevel" AS ENUM ('NONE', 'SUBADMIN', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "adminLevel" "AdminLevel" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "User_role_adminLevel_idx" ON "User"("role", "adminLevel");
