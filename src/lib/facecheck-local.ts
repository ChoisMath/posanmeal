import { decideMatch, rankCandidates, scoreSummary, type FaceCandidate, type MatchScore } from "@/lib/face-match";
import { resolveMealKindLocal, type MealKind, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";
import type { FaceConfirmation } from "@/lib/schemas/face";
import { TIMEZONE } from "@/lib/timezone";

export interface FaceCheckUser {
  id: number;
  name: string;
  role: string;
  grade?: number | null;
  classNum?: number | null;
  number?: number | null;
  photoUrl?: string | null;
}

// /api/facecheck 응답과 같은 모양 — 페이지가 온라인/로컬 결과를 동일하게 처리한다.
export interface FaceCheckResult extends MatchScore {
  success: boolean;
  matched?: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  needType?: boolean;
  needConfirmation?: boolean;
  date?: string;
  error?: string;
  errorCode?: string;
  user?: FaceCheckUser;
  type?: string;
  checkedAt?: string;
  mealKind?: MealKind;
}

export interface LocalFaceRepo {
  getUser(id: number): Promise<LocalUser | undefined>;
  getCheckIn(userId: number, date: string, mealKind: MealKind): Promise<LocalCheckIn | undefined>;
  isEligible(userId: number, date: string, mealKind: MealKind): Promise<boolean>;
  addCheckIn(checkin: Omit<LocalCheckIn, "id">): Promise<void>;
}

export interface LocalFaceInput {
  embedding: ArrayLike<number>;
  candidates: FaceCandidate[];
  faceMatch: { threshold: number; margin: number };
  now: Date;
  mealWindows: MealWindows;
  type?: "WORK" | "PERSONAL";
  confirmation?: FaceConfirmation;
}

export function localDateKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function toFaceCandidates(profiles: { userId: number; embeddings: number[][] }[]): FaceCandidate[] {
  return profiles.map((p) => ({ userId: p.userId, embeddings: p.embeddings.map((e) => Float32Array.from(e)) }));
}

function toFaceUser(user: LocalUser): FaceCheckUser {
  return { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number };
}

export async function runLocalFaceCheckIn(input: LocalFaceInput, repo: LocalFaceRepo): Promise<FaceCheckResult> {
  const kstNow = new Date(input.now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const mealKind = resolveMealKindLocal(kstNow, input.mealWindows);
  if (!mealKind) {
    return { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" };
  }
  const ranked = rankCandidates(input.embedding, input.candidates);
  const match = decideMatch(ranked, input.faceMatch);
  const score = scoreSummary(ranked);
  if (!match) return { success: false, matched: false, ...score, error: "등록된 사용자가 아닙니다.", errorCode: "UNMATCHED" };

  const user = await repo.getUser(match.userId);
  if (!user) return { success: false, matched: false, ...score, error: "명단에 없는 사용자입니다. 동기화가 필요합니다." };

  const date = localDateKey(input.now);
  const faceUser = toFaceUser(user);
  if (user.role !== "STUDENT" && user.role !== "TEACHER") {
    return { success: false, error: "체크인할 수 없는 사용자입니다.", errorCode: "ROLE_NOT_ALLOWED" };
  }

  const { confirmation } = input;
  if (confirmation && (confirmation.userId !== user.id || confirmation.mealKind !== mealKind || confirmation.date !== date)) {
    return {
      success: false, matched: true, ...score,
      error: "확인 대상이 변경되었습니다. 얼굴을 다시 인식해 주세요.", errorCode: "CONFIRMATION_CHANGED",
    };
  }

  if (!confirmation || (user.role === "TEACHER" && !input.type)) {
    return {
      success: false, matched: true, needConfirmation: true, needType: user.role === "TEACHER",
      user: faceUser, mealKind, date, ...score,
    };
  }

  const existing = await repo.getCheckIn(user.id, date, mealKind);
  if (existing) {
    return {
      success: false,
      matched: true,
      ...score,
      duplicate: true,
      user: faceUser,
      mealKind,
      checkedAt: existing.checkedAt,
      error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
    };
  }

  let type: LocalCheckIn["type"];
  if (user.role === "TEACHER") {
    type = input.type!;
  } else {
    const eligible = await repo.isEligible(user.id, date, mealKind);
    if (!eligible) {
      return {
        success: false,
        matched: true,
        ...score,
        notApplicant: true,
        user: faceUser,
        mealKind,
        error: `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.`,
      };
    }
    type = "STUDENT";
  }

  const checkedAt = input.now.toISOString();
  await repo.addCheckIn({ userId: user.id, date, mealKind, checkedAt, type, synced: 0 });
  return { success: true, matched: true, user: faceUser, type, mealKind, checkedAt, ...score };
}
