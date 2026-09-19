import type { Db } from "./db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** spec §4.4의 보존 기간. 미리보기 사본은 하루, 나머지 사본은 30일이다. */
const PREVIEW_MAX_AGE_MS = 24 * HOUR_MS;
const COPY_MAX_AGE_MS = 30 * DAY_MS;

/**
 * 명부 원본이 남는 자리(미리보기 사본·내보낸 파일 대응표·키오스크 스냅샷·해결된
 * 검토 증거)를 기간대로 비운다. 시각을 인자로 받아 경계를 시험할 수 있게 하고,
 * 어떤 실패도 호출한 요청으로 흘려보내지 않는다 — 정리는 요청의 목적이 아니다.
 */
export async function purgeExpiredRosterCopies(db: Db, now: Date): Promise<void> {
  const previewCutoff = new Date(now.getTime() - PREVIEW_MAX_AGE_MS);
  const copyCutoff = new Date(now.getTime() - COPY_MAX_AGE_MS);

  try {
    await db.$executeRaw`
      UPDATE "RosterImport"
      SET "state" = 'EXPIRED', "payload" = NULL, "preview" = NULL
      WHERE "state" = 'PREVIEW' AND "createdAt" <= ${previewCutoff}
    `;

    await db.$executeRaw`DELETE FROM "RosterFile" WHERE "createdAt" <= ${copyCutoff}`;

    // 검토가 아직 PENDING이면 그 근거가 된 스냅샷이 사라지면 안 된다.
    await db.$executeRaw`
      DELETE FROM "KioskSnapshot" s
      WHERE s."issuedAt" <= ${copyCutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "LocalCheckInReview" r
          WHERE r."snapshotId" = s."id" AND r."state" = 'PENDING'
        )
    `;

    await db.$executeRaw`
      UPDATE "LocalCheckInReview" SET "payload" = NULL
      WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" <= ${copyCutoff} AND "payload" IS NOT NULL
    `;
  } catch (error) {
    console.error(
      "[academic-year] 보존 사본 정리를 끝내지 못했습니다",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
