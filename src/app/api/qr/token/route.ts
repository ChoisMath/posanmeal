import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { getCachedSettings } from "@/lib/settings-cache";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";

  const userId = session.user.dbUserId;
  const role = session.user.role as "STUDENT" | "TEACHER";

  // Check operation mode and qr generation from cache
  const settings = await getCachedSettings();
  const isLocal = settings.operationMode === "local";

  // For students, check meal registration (both modes)
  if (role === "STUDENT") {
    const today = new Date(todayKST());
    const activeReg = await prisma.mealRegistration.findFirst({
      where: {
        userId,
        status: "APPROVED",
        application: {
          mealStart: { not: null, lte: today },
          mealEnd: { not: null, gte: today },
        },
      },
    });

    if (!activeReg) {
      return NextResponse.json(
        { error: "현재 석식 신청 기간이 없습니다." },
        { status: 400 }
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  // Local mode: return fixed QR string
  if (isLocal) {
    const generation = settings.qrGeneration;
    const qrString = `posanmeal:${userId}:${generation}:${validType}`;

    return NextResponse.json({
      token: qrString,
      expiresIn: 0, // 0 signals "no expiry" to the client
      mode: "local",
    });
  }

  // Online mode: existing JWT behavior
  const token = signQRToken({
    userId,
    role,
    type: validType,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
    mode: "online",
  });
}
