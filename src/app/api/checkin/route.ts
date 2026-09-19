import { NextResponse } from "next/server";
import { verifyQRToken } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { resolveMealKind, type MealKind } from "@/lib/meal-kind";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { getCachedRosterMode } from "@/lib/academic-year/roster-mode-cache";
import {
  ACCOUNT_INACTIVE_MESSAGE,
  displayUserOf,
  isStudentEligibleIn,
  readCheckInUser,
  readDisplayRecord,
} from "@/lib/checkin-account";

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

    // 서로 기다릴 이유가 없는 세 조회는 함께 보낸다. 식당 줄이 왕복마다 선다.
    const mode = await getCachedRosterMode(prisma);
    const [account, existing, record] = await Promise.all([
      readCheckInUser(prisma, payload.userId),
      prisma.checkIn.findFirst({
        where: { userId: payload.userId, date: todayDate, mealKind: mealKind as MealKind },
      }),
      readDisplayRecord(prisma, mode, payload.userId, today),
    ]);

    if (!account) {
      return NextResponse.json(
        { success: false, error: "사용자를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (account.accessState !== "ACTIVE") {
      return NextResponse.json(
        { success: false, error: ACCOUNT_INACTIVE_MESSAGE, errorCode: "ACCOUNT_INACTIVE" },
        { status: 403 },
      );
    }

    // QR에 적힌 역할이 아니라 지금의 명부 행으로 판단한다. 교사였다가 학생이 된
    // 계정의 옛 QR이 근무 식사로 통과하면 안 된다.
    const expectedType = account.role === "STUDENT" ? "STUDENT" : payload.type;
    if (account.role === "STUDENT" ? payload.type !== "STUDENT" : payload.type === "STUDENT") {
      return NextResponse.json(
        { success: false, error: "QR을 새로 발급받아 주세요.", errorCode: "ROLE_CHANGED" },
        { status: 400 },
      );
    }

    const user = displayUserOf(account, mode, record);

    if (existing) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        user,
        mealKind,
        checkedAt: existing.checkedAt,
        error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
      });
    }

    // 삽입 직전에 같은 트랜잭션에서 이용 상태와 자격을 다시 읽는다. 명부 잠금은
    // 잡지 않으므로 이용 중단과 수 ms 차이로 겹친 한 건은 허용하고, 중복은
    // (userId, date, mealKind) unique가 막는다.
    const outcome = await prisma.$transaction(async (tx) => {
      const current = await readCheckInUser(tx, account.id);
      if (!current || current.accessState !== "ACTIVE") return "INACTIVE" as const;

      if (current.role === "STUDENT") {
        const eligible = await isStudentEligibleIn(tx, account.id, mealKind as MealKind, todayDate);
        if (!eligible) return "NOT_APPLICANT" as const;
      }

      return tx.checkIn.create({
        data: {
          userId: account.id,
          date: todayDate,
          mealKind: mealKind as MealKind,
          type: expectedType,
          source: "QR",
        },
      });
    });

    if (outcome === "INACTIVE") {
      return NextResponse.json(
        { success: false, error: ACCOUNT_INACTIVE_MESSAGE, errorCode: "ACCOUNT_INACTIVE" },
        { status: 403 },
      );
    }
    if (outcome === "NOT_APPLICANT") {
      return NextResponse.json(
        { success: false, error: "식사 신청 기간이 아닙니다.", errorCode: "NO_MEAL_PERIOD" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      user,
      type: expectedType,
      mealKind,
      checkedAt: outcome.checkedAt,
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
