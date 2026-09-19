import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { isDomainError } from "@/lib/academic-year/errors";
import { rosterMode } from "@/lib/academic-year/registration-context";
import { requireActor } from "@/lib/academic-year/request-actor";
import { syncErrorResponse } from "@/lib/academic-year/sync-guard";
import {
  prepareUploadBatch,
  processUploadedCheckIn,
  type UploadDecision,
  type UploadedCheckIn,
} from "@/lib/academic-year/upload-review";
import type { Actor } from "@/lib/academic-year/contracts";

interface UploadCheckIn {
  clientId?: number;
  deviceId?: string;
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: "BREAKFAST" | "LUNCH" | "DINNER";
  snapshotId?: string;
  /** Task 13 이전 장치가 함께 보내는 원본. 보관만 하고 판정에 쓰지 않는다. */
  rawLegacy?: unknown;
}

type RejectReason =
  | "USER_NOT_FOUND"
  | "SERVER_ERROR"
  | "INVALID_PAYLOAD"
  /** 기록 번호가 없어 장치에 "처리했다"고 알려 줄 방법이 없다. */
  | "NO_CLIENT_ID";

interface RejectedItem {
  clientId: number | null;
  userId: number;
  date: string;
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER" | null;
  reason: RejectReason;
}

function isMealKind(value: unknown): value is "BREAKFAST" | "LUNCH" | "DINNER" {
  return value === "BREAKFAST" || value === "LUNCH" || value === "DINNER";
}

function isCheckInType(value: unknown): value is "STUDENT" | "WORK" | "PERSONAL" {
  return value === "STUDENT" || value === "WORK" || value === "PERSONAL";
}

function isValidIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export async function POST(request: Request) {
  return syncErrorResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const { checkins } = (await request.json()) as { checkins: UploadCheckIn[] };
    const items = Array.isArray(checkins) ? checkins : [];

    // Release A에서는 초기 이전이 검증되기 전이라 당시 자격을 말해 줄 근거가 없다.
    // 그 동안 업로드는 빈 묶음 응답까지 기존과 똑같은 모양이어야 한다.
    const mode = await rosterMode(prisma);
    return mode === "READY"
      ? NextResponse.json(await processWithEvidence(actor, items))
      : NextResponse.json(await insertWithoutEvidence(items));
  });
}

async function processWithEvidence(actor: Actor, checkins: UploadCheckIn[]) {
  let acceptedCount = 0;
  let duplicatesCount = 0;
  let reviewCount = 0;
  const syncedClientIds: number[] = [];
  const rejected: RejectedItem[] = [];
  const decisions: UploadDecision[] = [];

  const items: UploadedCheckIn[] = [];
  for (const ci of checkins) {
    // 번호가 없으면 어떤 결과도 장치에 되돌려 줄 수 없다. 처리하는 대신 그 사실을 알린다.
    if (typeof ci.clientId !== "number") {
      rejected.push({
        clientId: null,
        userId: typeof ci.userId === "number" ? ci.userId : 0,
        date: typeof ci.date === "string" ? ci.date : "",
        mealKind: isMealKind(ci.mealKind) ? ci.mealKind : null,
        reason: "NO_CLIENT_ID",
      });
      continue;
    }
    items.push({
      clientId: ci.clientId,
      deviceId: typeof ci.deviceId === "string" && ci.deviceId.length > 0 ? ci.deviceId : undefined,
      userId: ci.userId,
      date: ci.date,
      mealKind: isMealKind(ci.mealKind) ? ci.mealKind : undefined,
      checkedAt: ci.checkedAt,
      type: ci.type,
      snapshotId: typeof ci.snapshotId === "string" ? ci.snapshotId : undefined,
      ...(ci.rawLegacy === undefined ? {} : { rawLegacy: ci.rawLegacy }),
    });
  }

  const batch = items.length === 0 ? undefined : await prepareUploadBatch(prisma, items);

  for (const item of items) {
    const identity = {
      clientId: item.clientId,
      userId: typeof item.userId === "number" ? item.userId : 0,
      date: typeof item.date === "string" ? item.date : "",
      mealKind: isMealKind(item.mealKind) ? item.mealKind : null,
    };

    let decision: UploadDecision;
    try {
      decision = await processUploadedCheckIn(prisma, actor, item, batch);
    } catch (error) {
      // 한 건의 실패가 나머지 기록을 함께 되돌리면 안 된다. 결론이 나지 않았으므로
      // 종결 여부를 말하는 decisions에는 넣지 않고 기존처럼 rejected로만 알린다.
      if (isDomainError(error)) throw error;
      console.error("[sync] 업로드 기록 한 건을 처리하지 못했습니다", error);
      rejected.push({ ...identity, reason: "SERVER_ERROR" });
      continue;
    }

    decisions.push(decision);
    if (decision.status === "ACCEPTED") acceptedCount++;
    if (decision.status === "DUPLICATE") duplicatesCount++;
    if (decision.status === "REVIEW") reviewCount++;
    if (decision.status === "REJECTED") {
      rejected.push({
        ...identity,
        reason: decision.reason === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "INVALID_PAYLOAD",
      });
    }
    if (decision.final) syncedClientIds.push(decision.clientId);
  }

  return {
    acceptedCount,
    duplicatesCount,
    rejectedCount: rejected.length,
    reviewCount,
    syncedClientIds,
    rejected,
    decisions,
  };
}

/** PREPARING 동안의 경로. 사용자가 있으면 그대로 넣는 기존 동작을 그대로 둔다. */
async function insertWithoutEvidence(checkins: UploadCheckIn[]) {
  let acceptedCount = 0;
  let duplicatesCount = 0;
  const syncedClientIds: number[] = [];
  const rejected: RejectedItem[] = [];

  for (const ci of checkins) {
    const clientId = typeof ci.clientId === "number" ? ci.clientId : null;
    const mealKind = isMealKind(ci.mealKind) ? ci.mealKind : null;

    try {
      if (
        typeof ci.userId !== "number" ||
        typeof ci.date !== "string" ||
        !mealKind ||
        !isCheckInType(ci.type) ||
        typeof ci.checkedAt !== "string" ||
        !isValidIsoDate(ci.checkedAt)
      ) {
        rejected.push({
          clientId,
          userId: typeof ci.userId === "number" ? ci.userId : 0,
          date: typeof ci.date === "string" ? ci.date : "",
          mealKind,
          reason: "INVALID_PAYLOAD",
        });
        continue;
      }

      let dateObj: Date;
      try {
        dateObj = dateKeyToUtcDate(ci.date);
      } catch {
        rejected.push({ clientId, userId: ci.userId, date: ci.date, mealKind, reason: "INVALID_PAYLOAD" });
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { id: ci.userId },
        select: { id: true },
      });

      if (!user) {
        rejected.push({ clientId, userId: ci.userId, date: ci.date, mealKind, reason: "USER_NOT_FOUND" });
        continue;
      }

      await prisma.checkIn.create({
        data: {
          userId: ci.userId,
          date: dateObj,
          mealKind,
          checkedAt: new Date(ci.checkedAt),
          type: ci.type,
          source: "LOCAL_SYNC",
        },
      });
      acceptedCount++;
      if (clientId !== null) syncedClientIds.push(clientId);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        duplicatesCount++;
        if (clientId !== null) syncedClientIds.push(clientId);
      } else {
        rejected.push({ clientId, userId: ci.userId, date: ci.date, mealKind, reason: "SERVER_ERROR" });
      }
    }
  }

  return {
    acceptedCount,
    duplicatesCount,
    rejectedCount: rejected.length,
    syncedClientIds,
    rejected,
  };
}
