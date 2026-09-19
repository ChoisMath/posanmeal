import { decideMatch, rankCandidates, scoreSummary, type FaceCandidate, type MatchScore } from "@/lib/face-match";
import { resolveMealKindLocal, type MealKind, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";
import type { FaceConfirmation } from "@/lib/schemas/face";
import { TIMEZONE } from "@/lib/timezone";
import {
  LocalSnapshotError,
  guardLocalCheckIn,
  type LocalSnapshotState,
  type SnapshotFreshness,
} from "@/lib/academic-year/local-snapshot";

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
  /** 유효기간이 지난 명부로 저장됨 — 저장은 되었고 재동기화가 필요하다. */
  stale?: boolean;
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
  getSnapshotState(): Promise<LocalSnapshotState>;
  getDeviceId(): Promise<string>;
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

export async function runLocalFaceCheckIn(
  input: LocalFaceInput,
  repo: LocalFaceRepo,
  now: () => Date = () => new Date(),
): Promise<FaceCheckResult> {
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

  // 확인 창을 띄우기 전에 한 번, 저장 직전에 다시 판정한다. 확인창이 떠 있는 동안
  // 자정이 지나거나 학년도가 바뀔 수 있다.
  const state = await repo.getSnapshotState();
  const judge = (): SnapshotFreshness | null | FaceCheckResult => {
    try {
      return guardLocalCheckIn(state, { now: now(), userId: user.id, dateKey: date });
    } catch (error) {
      if (error instanceof LocalSnapshotError) {
        return { success: false, matched: true, ...score, user: faceUser, mealKind, error: error.message };
      }
      throw error;
    }
  };
  const isBlocked = (verdict: ReturnType<typeof judge>): verdict is FaceCheckResult =>
    verdict !== null && typeof verdict === "object";

  if (!confirmation || (user.role === "TEACHER" && !input.type)) {
    const verdict = judge();
    if (isBlocked(verdict)) return verdict;
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

  // 중복은 근거보다 먼저 답한다 — 이미 먹은 사람에게 동기화 얘기를 할 이유가 없다.
  const verdict = judge();
  if (isBlocked(verdict)) return verdict;
  const freshness = verdict;

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
  const stale = freshness === "STALE";
  await repo.addCheckIn({
    userId: user.id,
    date,
    mealKind,
    checkedAt,
    type,
    synced: 0,
    deviceId: await repo.getDeviceId(),
    ...(state.snapshot ? { snapshotId: state.snapshot.header.id } : {}),
    ...(stale ? { stale: true } : {}),
  });
  return { success: true, matched: true, user: faceUser, type, mealKind, checkedAt, ...score, ...(stale ? { stale: true } : {}) };
}
