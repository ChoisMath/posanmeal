import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWriteAdmin } from "@/lib/permissions";
import { dateKeyToUtcDate } from "@/lib/date-range";

interface UploadCheckIn {
  clientId?: number;
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: "BREAKFAST" | "LUNCH" | "DINNER";
}

interface RejectedItem {
  clientId: number | null;
  userId: number;
  date: string;
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER" | null;
  reason: "USER_NOT_FOUND" | "SERVER_ERROR" | "INVALID_PAYLOAD";
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
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { checkins } = (await request.json()) as { checkins: UploadCheckIn[] };

  if (!Array.isArray(checkins) || checkins.length === 0) {
    return NextResponse.json({
      acceptedCount: 0,
      duplicatesCount: 0,
      rejectedCount: 0,
      syncedClientIds: [],
      rejected: [],
    });
  }

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
        rejected.push({
          clientId,
          userId: ci.userId,
          date: ci.date,
          mealKind,
          reason: "INVALID_PAYLOAD",
        });
        continue;
      }

      const user = await prisma.user.findUnique({
        where: { id: ci.userId },
        select: { id: true },
      });

      if (!user) {
        rejected.push({
          clientId,
          userId: ci.userId,
          date: ci.date,
          mealKind,
          reason: "USER_NOT_FOUND",
        });
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
        rejected.push({
          clientId,
          userId: ci.userId,
          date: ci.date,
          mealKind,
          reason: "SERVER_ERROR",
        });
      }
    }
  }

  return NextResponse.json({
    acceptedCount,
    duplicatesCount,
    rejectedCount: rejected.length,
    syncedClientIds,
    rejected,
  });
}
