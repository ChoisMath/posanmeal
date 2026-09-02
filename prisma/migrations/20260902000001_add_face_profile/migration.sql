-- AlterEnum
ALTER TYPE "CheckInSource" ADD VALUE 'FACE';

-- CreateTable
CREATE TABLE "FaceProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "embeddings" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceProfile_userId_key" ON "FaceProfile"("userId");

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
