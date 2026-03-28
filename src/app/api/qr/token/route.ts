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

  // For students, check meal period
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

  const token = signQRToken({
    userId,
    role,
    type: validType,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
  });
}
