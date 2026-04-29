-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('QR', 'ADMIN_MANUAL', 'LOCAL_SYNC');

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN "source" "CheckInSource";
