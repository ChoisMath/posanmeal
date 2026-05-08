import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWriteAdmin } from "@/lib/permissions";

interface UploadCheckIn {
  clientId?: number;
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: "BREAKFAST" | "DINNER";
}

interface RejectedItem {
  clientId: number | null;
  userId: number;
  date: string;
  mealKind: "BREAKFAST" | "DINNER";
  reason: "USER_NOT_FOUND" | "SERVER_ERROR" | "INVALID_PAYLOAD";
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
    const mealKind = ci.mealKind ?? "DINNER";

    try {
      const dateObj = new Date(ci.date + "T00:00:00Z");

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
