import { NextResponse } from "next/server";
import { verifyQRToken } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { isStudentEligibleToday, resolveMealKind, type MealKind } from "@/lib/meal-kind";

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: "토큰이 없습니다." },
        { status: 400 },
      );
    }

    let payload;
    try {
      payload = verifyQRToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: "QR이 만료되었습니다. 새로고침 해주세요." },
        { status: 400 },
      );
    }

    const settings = await getCachedSettings();
    const mealKind = payload.mealKind ?? resolveMealKind(nowKST(), settings.mealWindows);
    if (!mealKind) {
      return NextResponse.json(
        { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
        { status: 400 },
      );
    }

    const today = todayKST();
    const todayDate = new Date(today);

    const [eligible, existing, user] = await Promise.all([
      payload.role === "STUDENT"
        ? isStudentEligibleToday(payload.userId, mealKind as MealKind, todayDate)
        : Promise.resolve(true),
      prisma.checkIn.findFirst({
        where: {
          userId: payload.userId,
          date: todayDate,
          mealKind: mealKind as MealKind,
        },
      }),
      prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true, role: true, grade: true, classNum: true, number: true, photoUrl: true },
      }),
    ]);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "사용자를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (payload.role === "STUDENT" && !eligible) {
      return NextResponse.json(
        { success: false, error: "식사 신청 기간이 아닙니다.", errorCode: "NO_MEAL_PERIOD" },
        { status: 400 },
      );
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        user,
        mealKind,
        checkedAt: existing.checkedAt,
        error: `이미 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 체크인 하였습니다.`,
      });
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: payload.userId,
        date: todayDate,
        mealKind: mealKind as MealKind,
        type: payload.type,
        source: "QR",
      },
    });

    return NextResponse.json({
      success: true,
      user,
      type: payload.type,
      mealKind,
      checkedAt: checkIn.checkedAt,
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        error: "이미 체크인 하였습니다.",
      });
    }
    return NextResponse.json(
      { success: false, error: "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
