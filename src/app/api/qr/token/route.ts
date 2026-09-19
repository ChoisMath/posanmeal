import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { getCachedSettings } from "@/lib/settings-cache";
import { isStudentEligibleToday, resolveMealKind } from "@/lib/meal-kind";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { nowKST, todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  let userId: number;
  let role: "STUDENT" | "TEACHER";
  try {
    userId = selfUserId(await requireActor("SIGNED_IN"));
    // 역할은 토큰이 아니라 현재 DB 행에서 읽는다.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new DomainError("MISSING_PROFILE", "사용자를 찾을 수 없습니다.");
    role = user.role;
  } catch (error) {
    return errorResponse(error);
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";
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
        { error: `오늘 ${MEAL_LABEL[mealKind]} 신청 내역이 없습니다.`, errorCode: "NO_MEAL_PERIOD" },
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
