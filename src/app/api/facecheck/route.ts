import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { isStudentEligibleToday, resolveMealKind, type MealKind } from "@/lib/meal-kind";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { getFaceCandidates } from "@/lib/face-embedding-cache";
import { findBestMatch } from "@/lib/face-match";
import { faceCheckSchema } from "@/lib/schemas/face";

const USER_SELECT = {
  id: true, name: true, role: true,
  grade: true, classNum: true, number: true, photoUrl: true,
} as const;

export async function POST(request: Request) {
  try {
    const parsed = faceCheckSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
    }
    const { embedding, type } = parsed.data;

    const settings = await getCachedSettings();
    const mealKind = resolveMealKind(nowKST(), settings.mealWindows);
    if (!mealKind) {
      return NextResponse.json(
        { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
        { status: 400 },
      );
    }

    const candidates = await getFaceCandidates();
    const match = findBestMatch(embedding, candidates, settings.faceMatch);
    if (!match) {
      return NextResponse.json({
        success: false,
        matched: false,
        error: "인식되지 않았습니다. 다시 서 주세요.",
      });
    }

    const todayDate = new Date(todayKST());
    const [user, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: match.userId }, select: USER_SELECT }),
      prisma.checkIn.findFirst({
        where: { userId: match.userId, date: todayDate, mealKind: mealKind as MealKind },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        matched: true,
        duplicate: true,
        user,
        mealKind,
        checkedAt: existing.checkedAt,
        error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
      });
    }

    let checkInType: "STUDENT" | "WORK" | "PERSONAL";
    if (user.role === "TEACHER") {
      if (!type) {
        return NextResponse.json({ success: false, matched: true, needType: true, user, mealKind });
      }
      checkInType = type;
    } else {
      const eligible = await isStudentEligibleToday(user.id, mealKind as MealKind, todayDate);
      if (!eligible) {
        return NextResponse.json({
          success: false,
          matched: true,
          notApplicant: true,
          user,
          mealKind,
          error: "식사 신청 기간이 아닙니다.",
        });
      }
      checkInType = "STUDENT";
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: user.id,
        date: todayDate,
        mealKind: mealKind as MealKind,
        type: checkInType,
        source: "FACE",
      },
    });

    return NextResponse.json({
      success: true,
      matched: true,
      user,
      type: checkInType,
      mealKind,
      checkedAt: checkIn.checkedAt,
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ success: false, matched: true, duplicate: true, error: "이미 체크인 하였습니다." });
    }
    return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
