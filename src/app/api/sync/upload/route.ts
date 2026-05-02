import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWriteAdmin } from "@/lib/permissions";

interface UploadCheckIn {
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: "BREAKFAST" | "DINNER";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { checkins } = (await request.json()) as { checkins: UploadCheckIn[] };

  if (!Array.isArray(checkins) || checkins.length === 0) {
    return NextResponse.json({ accepted: 0, duplicates: 0, rejected: [] });
  }

  let accepted = 0;
  let duplicates = 0;
  const rejected: { userId: number; date: string; reason: string }[] = [];

  for (const ci of checkins) {
    try {
      const dateObj = new Date(ci.date + "T00:00:00Z");
      const mealKind = ci.mealKind ?? "DINNER";

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: ci.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "USER_NOT_FOUND" });
        continue;
      }

      // Check meal registration for students
      if (user.role === "STUDENT") {
        const activeReg = await prisma.mealRegistration.findFirst({
          where: {
              userId: ci.userId,
              status: "APPROVED",
              ...(mealKind === "DINNER"
                ? {
                    application: {
                      type: "DINNER",
                      mealStart: { not: null, lte: dateObj },
                      mealEnd: { not: null, gte: dateObj },
                    },
                  }
                : {
                    application: { type: "BREAKFAST" },
                    selectedDates: { some: { date: dateObj } },
                  }),
          },
        });
        if (!activeReg) {
          rejected.push({ userId: ci.userId, date: ci.date, reason: "NO_MEAL_PERIOD" });
          continue;
        }
      }

      // Try to create (unique constraint handles duplicates)
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
      accepted++;
    } catch (err: unknown) {
      // Prisma unique constraint violation
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        duplicates++;
      } else {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "SERVER_ERROR" });
      }
    }
  }

  return NextResponse.json({ accepted, duplicates, rejected });
}
