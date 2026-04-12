import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
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

  // Check operation mode
  const modeSetting = await prisma.systemSetting.findUnique({
    where: { key: "operationMode" },
  });
  const isLocal = modeSetting?.value === "local";

  // For students, check meal period (both modes)
  if (role === "STUDENT") {
    const today = todayKST();
    const mealPeriod = await prisma.mealPeriod.findUnique({
      where: { userId },
    });

    if (!mealPeriod) {
      return NextResponse.json(
        { error: "석식 신청 기간이 없습니다." },
        { status: 400 }
      );
    }

    const todayDate = new Date(today);
    if (todayDate < mealPeriod.startDate || todayDate > mealPeriod.endDate) {
      return NextResponse.json(
        { error: "현재 석식 신청 기간이 아닙니다." },
        { status: 400 }
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  // Local mode: return fixed QR string
  if (isLocal) {
    const genSetting = await prisma.systemSetting.findUnique({
      where: { key: "qrGeneration" },
    });
    const generation = genSetting?.value || "1";
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
