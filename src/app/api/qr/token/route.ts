import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { getCachedSettings } from "@/lib/settings-cache";
import { isStudentEligibleToday, resolveMealKind } from "@/lib/meal-kind";
import { nowKST, todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";

  const userId = session.user.dbUserId;
  const role = session.user.role as "STUDENT" | "TEACHER";
  const settings = await getCachedSettings();
  const mealKind = resolveMealKind(nowKST(), settings.mealWindows);

  if (!mealKind) {
    return NextResponse.json(
      { error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
      { status: 400 },
    );
  }

  if (role === "STUDENT") {
    const eligible = await isStudentEligibleToday(userId, mealKind, new Date(todayKST()));
    if (!eligible) {
      return NextResponse.json(
        { error: `오늘 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 신청 내역이 없습니다.`, errorCode: "NO_MEAL_PERIOD" },
        { status: 400 },
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  if (settings.operationMode === "local") {
    const generation = settings.qrGeneration;
    const qrString = `posanmeal:${userId}:${generation}:${validType}:${mealKind}`;

    return NextResponse.json({
      token: qrString,
      expiresIn: 0,
      mode: "local",
      mealKind,
    });
  }

  const token = signQRToken({
    userId,
    role,
    type: validType,
    mealKind,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
    mode: "online",
    mealKind,
  });
}
