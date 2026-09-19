import type { PrismaClient } from "@/generated/prisma/client";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** spec §4.4의 보존 기간. 미리보기 사본은 하루, 나머지 사본은 30일이다. */
const PREVIEW_MAX_AGE_MS = 24 * HOUR_MS;
const COPY_MAX_AGE_MS = 30 * DAY_MS;

/**
 * 명부 원본이 남는 자리(미리보기 사본·내보낸 파일 대응표·키오스크 스냅샷·해결된
 * 검토 증거)를 기간대로 비운다. 시각을 인자로 받아 경계를 시험할 수 있게 한다.
 *
 * 트랜잭션 클라이언트를 받지 않는다(`PrismaClient`만) — 이 정리가 진행 중인
 * 확정 트랜잭션 안에서 돌면 그 요청과 함께 되돌아가거나 함께 실패하게 된다.
 */
export async function purgeExpiredRosterCopies(db: PrismaClient, now: Date): Promise<void> {
  const previewCutoff = new Date(now.getTime() - PREVIEW_MAX_AGE_MS);
  const copyCutoff = new Date(now.getTime() - COPY_MAX_AGE_MS);

  // 네 가지를 따로 감싼다. 하나가 실패해도 나머지 사본은 기간대로 비워져야 한다.
  await step("RosterImport", () => db.$executeRaw`
    UPDATE "RosterImport"
    SET "state" = 'EXPIRED', "payload" = NULL, "preview" = NULL
    WHERE "state" = 'PREVIEW' AND "createdAt" <= ${previewCutoff}
  `);

  await step("RosterFile", () => db.$executeRaw`
    DELETE FROM "RosterFile" WHERE "createdAt" <= ${copyCutoff}
  `);

  // 검토가 아직 PENDING이면 그 근거가 된 스냅샷이 사라지면 안 된다.
  await step("KioskSnapshot", () => db.$executeRaw`
    DELETE FROM "KioskSnapshot" s
    WHERE s."issuedAt" <= ${copyCutoff}
      AND NOT EXISTS (
        SELECT 1 FROM "LocalCheckInReview" r
        WHERE r."snapshotId" = s."id" AND r."state" = 'PENDING'
      )
  `);

  await step("LocalCheckInReview", () => db.$executeRaw`
    UPDATE "LocalCheckInReview" SET "payload" = NULL
    WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" <= ${copyCutoff} AND "payload" IS NOT NULL
  `);
}

/** 정리는 요청의 목적이 아니다. 어떤 실패도 호출한 요청으로 흘려보내지 않는다. */
async function step(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(
      `[academic-year] 보존 사본 정리를 끝내지 못했습니다 (${what})`,
      error instanceof Error ? error.name : "unknown",
    );
  }
}
