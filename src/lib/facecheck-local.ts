import { findBestMatch, type FaceCandidate } from "@/lib/face-match";
import { resolveMealKindLocal, type MealKind, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";

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
export interface FaceCheckResult {
  success: boolean;
  matched?: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  needType?: boolean;
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
}

export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toFaceCandidates(profiles: { userId: number; embeddings: number[][] }[]): FaceCandidate[] {
  return profiles.map((p) => ({ userId: p.userId, embeddings: p.embeddings.map((e) => Float32Array.from(e)) }));
}

function toFaceUser(user: LocalUser): FaceCheckUser {
  return { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number };
}

// 판정 순서는 /api/facecheck와 동일: 식사 시간 → 매칭 → 사용자 → 중복 → 교사 type → 학생 자격 → 저장
export async function runLocalFaceCheckIn(input: LocalFaceInput, repo: LocalFaceRepo): Promise<FaceCheckResult> {
  const mealKind = resolveMealKindLocal(input.now, input.mealWindows);
  if (!mealKind) {
    return { success: false, error: "현재 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" };
  }
  const match = findBestMatch(input.embedding, input.candidates, input.faceMatch);
  if (!match) return { success: false, matched: false, error: "인식되지 않았습니다. 다시 서 주세요." };

  const user = await repo.getUser(match.userId);
  if (!user) return { success: false, matched: false, error: "명단에 없는 사용자입니다. 동기화가 필요합니다." };

  const date = localDateKey(input.now);
  const faceUser = toFaceUser(user);
  const existing = await repo.getCheckIn(user.id, date, mealKind);
  if (existing) {
    return {
      success: false,
      matched: true,
      duplicate: true,
      user: faceUser,
      mealKind,
      checkedAt: existing.checkedAt,
      error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다.`,
    };
  }

  let type: LocalCheckIn["type"];
  if (user.role === "TEACHER") {
    if (!input.type) return { success: false, matched: true, needType: true, user: faceUser, mealKind };
    type = input.type;
  } else {
    const eligible = await repo.isEligible(user.id, date, mealKind);
    if (!eligible) {
      return {
        success: false,
        matched: true,
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
  return { success: true, matched: true, user: faceUser, type, mealKind, checkedAt };
}
