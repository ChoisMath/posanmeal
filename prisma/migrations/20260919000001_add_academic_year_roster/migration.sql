-- 잠금 대기가 길어지면 로그인·체크인이 뒤에 줄 서므로, 이 마이그레이션의
-- ALTER는 5초 안에 잠금을 잡지 못하면 실패하고 재시도하게 둔다.
SET lock_timeout = '5s';

-- 학년도 명부 도메인 추가. 전부 additive: 기존 컬럼 삭제·rename·기본값 없는
-- NOT NULL 추가를 하지 않는다. 새 FK는 모두 ON DELETE RESTRICT.

-- AlterTable: User
ALTER TABLE "User" ADD COLUMN "emailKey" TEXT;
ALTER TABLE "User" ADD COLUMN "accessState" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_accessState_check"
    CHECK ("accessState" IN ('ACTIVE', 'INACTIVE'));
CREATE UNIQUE INDEX "User_emailKey_key" ON "User"("emailKey");

-- AlterTable: MealApplication
ALTER TABLE "MealApplication" ADD COLUMN "academicYear" INTEGER;

-- CreateTable
CREATE TABLE "AcademicYear" (
    "year" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewedVersion" INTEGER,
    "reviewedSourceVersion" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "AcademicYear_state_check" CHECK ("state" IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
);

-- 한 시점에 ACTIVE 학년도는 하나뿐이다.
CREATE UNIQUE INDEX "AcademicYear_one_active" ON "AcademicYear" ((1)) WHERE "state" = 'ACTIVE';

-- CreateTable
CREATE TABLE "RosterControl" (
    "id" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PREPARING',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RosterControl_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RosterControl_singleton" CHECK ("id" = 1),
    CONSTRAINT "RosterControl_mode_check" CHECK ("mode" IN ('PREPARING', 'READY'))
);

-- CreateTable
CREATE TABLE "UserAcademicRecord" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT NOT NULL,
    "grade" INTEGER,
    "classNum" INTEGER,
    "number" INTEGER,
    "gender" "Gender",
    "subject" TEXT,
    "homeroom" TEXT,
    "position" TEXT,
    "memberState" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAcademicRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserAcademicRecord_memberState_check"
        CHECK ("memberState" IN ('ENROLLED', 'EMPLOYED', 'GRADUATED', 'TRANSFERRED', 'RETIRED')),
    -- 역할과 소속 상태의 조합을 제한한다. 교사 TRANSFERRED는 전출이다.
    CONSTRAINT "UserAcademicRecord_role_memberState_check" CHECK (
        ("role" = 'STUDENT' AND "memberState" IN ('ENROLLED', 'GRADUATED', 'TRANSFERRED'))
        OR ("role" = 'TEACHER' AND "memberState" IN ('EMPLOYED', 'TRANSFERRED', 'RETIRED'))
    )
);

CREATE UNIQUE INDEX "UserAcademicRecord_year_userId_key" ON "UserAcademicRecord"("year", "userId");

-- 같은 학년도 안에서 확정된 재학생 좌석(학년·반·번호)은 유일하다.
CREATE UNIQUE INDEX "AcademicRecord_student_seat" ON "UserAcademicRecord" ("year", "grade", "classNum", "number")
WHERE "role" = 'STUDENT' AND "memberState" = 'ENROLLED' AND "needsReview" = false;

-- CreateTable
CREATE TABLE "RosterEntry" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "userId" INTEGER,
    "emailKey" TEXT NOT NULL,
    "draftEmail" TEXT,
    "draftProfile" JSONB,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "baseUserVersion" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RosterEntry_year_emailKey_key" ON "RosterEntry"("year", "emailKey");
CREATE UNIQUE INDEX "RosterEntry_year_userId_key" ON "RosterEntry"("year", "userId");

-- CreateTable
CREATE TABLE "RosterFile" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RosterFile_createdAt_idx" ON "RosterFile"("createdAt");

-- CreateTable
CREATE TABLE "RosterImport" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "controlVersion" INTEGER NOT NULL,
    "yearVersion" INTEGER NOT NULL,
    "payload" JSONB,
    "preview" JSONB,
    "summary" JSONB,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterImport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RosterImport_scope_check" CHECK ("scope" IN ('PARTIAL', 'FULL')),
    CONSTRAINT "RosterImport_state_check" CHECK ("state" IN ('PREVIEW', 'COMMITTED', 'CANCELLED', 'EXPIRED'))
);

-- CreateTable
CREATE TABLE "RosterDecision" (
    "year" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,

    CONSTRAINT "RosterDecision_pkey" PRIMARY KEY ("year", "userId"),
    CONSTRAINT "RosterDecision_decision_check"
        CHECK ("decision" IN ('GRADUATED', 'TRANSFERRED', 'RETIRED', 'RESTORE'))
);

-- CreateTable
CREATE TABLE "RosterMutation" (
    "requestId" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "kind" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterMutation_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "UserAccessEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "requestId" TEXT,

    CONSTRAINT "UserAccessEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserAccessEvent_state_check" CHECK ("state" IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX "UserAccessEvent_userId_effectiveAt_idx" ON "UserAccessEvent"("userId", "effectiveAt");

-- CreateTable
CREATE TABLE "EligibilityEvent" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "applicationId" INTEGER,
    "userId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,

    CONSTRAINT "EligibilityEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EligibilityEvent_scope_check"
        CHECK ("scope" IN ('APPLICATION', 'REGISTRATION', 'ACCOUNT', 'ROLLOVER'))
);

CREATE INDEX "EligibilityEvent_userId_occurredAt_idx" ON "EligibilityEvent"("userId", "occurredAt");
CREATE INDEX "EligibilityEvent_applicationId_occurredAt_idx" ON "EligibilityEvent"("applicationId", "occurredAt");

-- CreateTable
CREATE TABLE "AcademicBackfill" (
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "sourceManifest" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "AcademicBackfill_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "AcademicBackfill_state_check" CHECK ("state" IN ('PENDING', 'COPIED', 'VERIFIED'))
);

-- CreateTable
CREATE TABLE "KioskSnapshot" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "activeYear" INTEGER NOT NULL,
    "lastEligibilityEventId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "freshUntil" TIMESTAMP(3) NOT NULL,
    "coversUntil" TEXT NOT NULL,

    CONSTRAINT "KioskSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KioskSnapshot_issuedAt_idx" ON "KioskSnapshot"("issuedAt");

-- CreateTable
CREATE TABLE "LocalCheckInReview" (
    "id" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB,
    "snapshotId" TEXT,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "decision" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LocalCheckInReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LocalCheckInReview_state_check"
        CHECK ("state" IN ('PENDING', 'ACCEPTED', 'DUPLICATE', 'REJECTED'))
);

CREATE UNIQUE INDEX "LocalCheckInReview_clientKey_key" ON "LocalCheckInReview"("clientKey");

-- AddForeignKey
ALTER TABLE "MealApplication" ADD CONSTRAINT "MealApplication_academicYear_fkey" FOREIGN KEY ("academicYear") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAcademicRecord" ADD CONSTRAINT "UserAcademicRecord_year_fkey" FOREIGN KEY ("year") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAcademicRecord" ADD CONSTRAINT "UserAcademicRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_year_fkey" FOREIGN KEY ("year") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterFile" ADD CONSTRAINT "RosterFile_year_fkey" FOREIGN KEY ("year") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterImport" ADD CONSTRAINT "RosterImport_year_fkey" FOREIGN KEY ("year") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterDecision" ADD CONSTRAINT "RosterDecision_year_fkey" FOREIGN KEY ("year") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterDecision" ADD CONSTRAINT "RosterDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAccessEvent" ADD CONSTRAINT "UserAccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KioskSnapshot" ADD CONSTRAINT "KioskSnapshot_activeYear_fkey" FOREIGN KEY ("activeYear") REFERENCES "AcademicYear"("year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: 단일 control 행과 현재 운영 학년도. 뒤따르는 backfill·호환 쓰기가 이 두 행을 전제한다.
INSERT INTO "RosterControl" ("id", "mode", "version") VALUES (1, 'PREPARING', 0);
INSERT INTO "AcademicYear" ("year", "state", "version", "createdAt", "updatedAt")
VALUES (2026, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
