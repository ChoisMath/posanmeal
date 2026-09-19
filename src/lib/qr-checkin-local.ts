import { resolveMealKindLocal, type MealKind, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { localDateKey } from "@/lib/facecheck-local";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";
import type { CheckInResult } from "@/lib/checkin-client";
import {
  LocalSnapshotError,
  guardLocalCheckIn,
  type LocalSnapshotState,
  type SnapshotFreshness,
} from "@/lib/academic-year/local-snapshot";

const LOCAL_QR_PREFIX = "posanmeal:";

// 인쇄 카드·로컬 QR(`posanmeal:{id}:{generation}:{type}[:{mealKind}]`)은 서버 없이 기기 IndexedDB로 판정한다.
export interface ParsedLocalQR {
  userId: number;
  generation: string;
  type: string;
  mealKind?: MealKind;
}

export function isLocalQR(data: string): boolean {
  return data.startsWith(LOCAL_QR_PREFIX);
}

export function parseLocalQR(data: string): ParsedLocalQR | null {
  const parts = data.split(":");
  if ((parts.length !== 4 && parts.length !== 5) || parts[0] !== "posanmeal") return null;
  const userId = parseInt(parts[1], 10);
  if (isNaN(userId)) return null;
  const mealKind = parts[4] === "BREAKFAST" || parts[4] === "DINNER" ? parts[4] : undefined;
  return { userId, generation: parts[2], type: parts[3], mealKind };
}

export interface LocalQrRepo {
  getSetting(key: string): Promise<string | undefined>;
  getUser(id: number): Promise<LocalUser | undefined>;
  isEligible(userId: number, date: string, mealKind: MealKind): Promise<boolean>;
  getCheckIn(userId: number, date: string, mealKind: MealKind): Promise<LocalCheckIn | undefined>;
  addCheckIn(checkin: Omit<LocalCheckIn, "id">): Promise<void>;
  /** 기기의 명부 근거 상태. 근거를 받은 적이 없으면 판정하지 않는다. */
  getSnapshotState(): Promise<LocalSnapshotState>;
  getDeviceId(): Promise<string>;
}

export interface LocalQrInput {
  data: string;
  now: Date;
  mealWindows: MealWindows;
}

const VALID_TYPES: Record<string, string[]> = {
  STUDENT: ["STUDENT"],
  TEACHER: ["WORK", "PERSONAL"],
};

// 판정 순서: 형식 → 세대 → 명단 → 유형 → 식사 시간 → 학생 자격 → 중복 → 근거 → 저장 (`/check`·`/facecheck` 공용)
export async function runLocalQrCheckIn(
  input: LocalQrInput,
  repo: LocalQrRepo,
  now: () => Date = () => new Date(),
): Promise<CheckInResult> {
  const parsed = parseLocalQR(input.data);
  if (!parsed) return { success: false, error: "잘못된 QR코드입니다." };

  const storedGeneration = await repo.getSetting("qrGeneration");
  if (storedGeneration && parsed.generation !== storedGeneration) {
    return { success: false, error: "QR코드가 만료되었습니다. 학생 앱에서 새 QR을 확인하세요." };
  }

  const user = await repo.getUser(parsed.userId);
  if (!user) return { success: false, error: "미등록 사용자입니다." };
  if (!VALID_TYPES[user.role]?.includes(parsed.type)) return { success: false, error: "잘못된 QR 유형입니다." };

  const mealKind = parsed.mealKind ?? resolveMealKindLocal(input.now, input.mealWindows);
  if (!mealKind) return { success: false, error: "현재 식사 시간이 아닙니다." };

  const date = localDateKey(input.now);
  const resultUser = { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number };

  if (user.role === "STUDENT") {
    const eligible = await repo.isEligible(user.id, date, mealKind);
    if (!eligible) {
      return { success: false, notApplicant: true, user: resultUser, mealKind, error: "신청자가 아닙니다." };
    }
  }

  const existing = await repo.getCheckIn(user.id, date, mealKind);
  if (existing) {
    const time = new Date(existing.checkedAt);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    return {
      success: false,
      duplicate: true,
      user: resultUser,
      mealKind,
      checkedAt: existing.checkedAt,
      error: `이미 ${MEAL_LABEL[mealKind]} 체크인 하였습니다 (${hh}:${mm})`,
    };
  }

  const state = await repo.getSnapshotState();
  let freshness: SnapshotFreshness | null;
  try {
    freshness = guardLocalCheckIn(state, { now: now(), userId: user.id, dateKey: date });
  } catch (error) {
    if (error instanceof LocalSnapshotError) {
      return { success: false, user: resultUser, mealKind, error: error.message };
    }
    throw error;
  }

  const checkedAt = input.now.toISOString();
  const type = parsed.type as LocalCheckIn["type"];
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
  return { success: true, user: resultUser, type, mealKind, checkedAt, ...(stale ? { stale: true } : {}) };
}
