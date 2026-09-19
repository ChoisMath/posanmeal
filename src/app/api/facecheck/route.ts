import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { resolveMealKind, type MealKind } from "@/lib/meal-kind";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { getFaceCandidates } from "@/lib/face-embedding-cache";
import { decideMatch, rankCandidates, scoreSummary } from "@/lib/face-match";
import { faceCheckSchema } from "@/lib/schemas/face";
import { getCachedRosterMode } from "@/lib/academic-year/roster-mode-cache";
import {
  ACCOUNT_INACTIVE_MESSAGE,
  displayUserOf,
  isStudentEligibleIn,
  readCheckInUser,
  readDisplayRecord,
} from "@/lib/checkin-account";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const rateHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (rateHits.size > 1000) {
    for (const [k, v] of rateHits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateHits.delete(k);
  }
  const recent = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateHits.set(ip, recent);
  return recent.length > RATE_MAX;
}

function checkKioskKey(request: Request): "ok" | "unset" | "invalid" {
  const expected = process.env.FACECHECK_KIOSK_KEY;
  if (!expected) return "unset";
  const given = Buffer.from(request.headers.get("x-kiosk-key") ?? "");
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want) ? "ok" : "invalid";
}

export async function POST(request: Request) {
  const keyStatus = checkKioskKey(request);
  if (keyStatus === "unset") {
    return NextResponse.json(
      { success: false, error: "키오스크 키가 설정되지 않았습니다.", errorCode: "KIOSK_KEY_UNSET" },
      { status: 503 },
    );
  }
  if (keyStatus === "invalid") {
    return NextResponse.json(
      { success: false, error: "키오스크 인증에 실패했습니다.", errorCode: "KIOSK_UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", errorCode: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  try {
    const parsed = faceCheckSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
    }
    const { embedding, type, confirmation } = parsed.data;

    const settings = await getCachedSettings();
    const mealKind = resolveMealKind(nowKST(), settings.mealWindows);
    if (!mealKind) {
      return NextResponse.json(
        { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
        { status: 400 },
      );
    }

    const candidates = await getFaceCandidates();
    const ranked = rankCandidates(embedding, candidates);
    const match = decideMatch(ranked, settings.faceMatch);
    const score = scoreSummary(ranked);
    if (!match) {
      return NextResponse.json({
        success: false,
        matched: false,
        ...score,
        error: "등록된 사용자가 아닙니다.",
        errorCode: "UNMATCHED",
      });
    }

    const date = todayKST();
    const todayDate = new Date(date);
    // 매칭 단계는 얼굴이 보이는 매 프레임 지나간다. 저장 없이, 서로 기다리지
    // 않는 두 조회만으로 끝낸다.
    const mode = await getCachedRosterMode(prisma);
    const [account, record] = await Promise.all([
      readCheckInUser(prisma, match.userId),
      readDisplayRecord(prisma, mode, match.userId, date),
    ]);

    if (!account) {
      return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (account.role !== "STUDENT" && account.role !== "TEACHER") {
      return NextResponse.json({ success: false, error: "체크인할 수 없는 사용자입니다.", errorCode: "ROLE_NOT_ALLOWED" }, { status: 403 });
    }

    if (account.accessState !== "ACTIVE") {
      return NextResponse.json(
        { success: false, matched: true, ...score, error: ACCOUNT_INACTIVE_MESSAGE, errorCode: "ACCOUNT_INACTIVE" },
        { status: 403 },
      );
    }

    const user = displayUserOf(account, mode, record);

    if (confirmation && (confirmation.userId !== user.id || confirmation.mealKind !== mealKind || confirmation.date !== date)) {
      return NextResponse.json({
        success: false, matched: true, ...score,
        error: "확인 대상이 변경되었습니다. 얼굴을 다시 인식해 주세요.", errorCode: "CONFIRMATION_CHANGED",
      });
    }

    if (!confirmation || (account.role === "TEACHER" && !type)) {
      return NextResponse.json({
        success: false, matched: true, needConfirmation: true, needType: account.role === "TEACHER",
        user, mealKind, date, ...score,
      });
    }

    const existing = await prisma.checkIn.findFirst({
      where: { userId: user.id, date: todayDate, mealKind: mealKind as MealKind },
    });

    if (existing) {
      return NextResponse.json({
        success: false,
        matched: true,
        ...score,
        duplicate: true,
        user,
        mealKind,
        checkedAt: existing.checkedAt,
        error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
      });
    }

    const checkInType: "STUDENT" | "WORK" | "PERSONAL" =
      account.role === "TEACHER" ? type! : "STUDENT";

    // 저장 직전에 같은 트랜잭션에서 이용 상태와 자격을 다시 읽는다. 명부 잠금은
    // 잡지 않는다 — 식당 줄이 명부 작업 뒤에 서면 안 된다.
    let outcome: "INACTIVE" | "NOT_APPLICANT" | { checkedAt: Date };
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const current = await readCheckInUser(tx, user.id);
        if (!current || current.accessState !== "ACTIVE") return "INACTIVE" as const;

        if (current.role === "STUDENT") {
          const eligible = await isStudentEligibleIn(tx, user.id, mealKind as MealKind, todayDate);
          if (!eligible) return "NOT_APPLICANT" as const;
        }

        return tx.checkIn.create({
          data: {
            userId: user.id,
            date: todayDate,
            mealKind: mealKind as MealKind,
            type: checkInType,
            source: "FACE",
          },
        });
      });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        const raced = await prisma.checkIn.findFirst({
          where: { userId: user.id, date: todayDate, mealKind: mealKind as MealKind },
        });
        return NextResponse.json({
          success: false,
          matched: true,
          ...score,
          duplicate: true,
          user,
          mealKind,
          checkedAt: raced?.checkedAt,
          error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
        });
      }
      throw err;
    }

    if (outcome === "INACTIVE") {
      return NextResponse.json(
        { success: false, matched: true, ...score, error: ACCOUNT_INACTIVE_MESSAGE, errorCode: "ACCOUNT_INACTIVE" },
        { status: 403 },
      );
    }

    if (outcome === "NOT_APPLICANT") {
      return NextResponse.json({
        success: false,
        matched: true,
        ...score,
        notApplicant: true,
        user,
        mealKind,
        error: `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.`,
      });
    }

    return NextResponse.json({
      success: true,
      matched: true,
      ...score,
      user,
      type: checkInType,
      mealKind,
      checkedAt: outcome.checkedAt,
    });
  } catch (err: unknown) {
    console.error("facecheck error:", err);
    return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
