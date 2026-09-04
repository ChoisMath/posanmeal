import {
  clearFaceProfiles,
  getSetting,
  getUnsyncedCheckIns,
  markCheckInsSynced,
  replaceAllEligibleEntries,
  replaceAllFaceProfiles,
  replaceAllUsers,
  setSetting,
  type LocalEligibleEntry,
  type LocalFaceProfile,
  type LocalUser,
} from "@/lib/local-db";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind-local";
import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD } from "@/lib/face-constants";

export type OperationMode = "online" | "local";

export interface KioskSettings {
  operationMode: OperationMode;
  mealWindows: MealWindows;
  faceMatch: { threshold: number; margin: number };
}

const DEFAULT_FACE_MATCH = { threshold: DEFAULT_FACE_MATCH_THRESHOLD, margin: DEFAULT_FACE_MATCH_MARGIN };

function toMode(value: unknown): OperationMode {
  return value === "local" ? "local" : "online";
}

async function saveSettings(s: KioskSettings): Promise<void> {
  await setSetting("operationMode", s.operationMode);
  await setSetting("mealWindows", JSON.stringify(s.mealWindows));
  await setSetting("faceMatch", JSON.stringify(s.faceMatch));
}

export async function fetchKioskSettings(): Promise<KioskSettings | null> {
  if (!navigator.onLine) return null;
  try {
    const res = await fetch("/api/system/settings");
    if (!res.ok) return null;
    const data = await res.json();
    const settings: KioskSettings = {
      operationMode: toMode(data.operationMode),
      mealWindows: data.mealWindows ?? DEFAULT_MEAL_WINDOWS,
      faceMatch: data.faceMatch ?? DEFAULT_FACE_MATCH,
    };
    await saveSettings(settings);
    if (data.qrGeneration) await setSetting("qrGeneration", String(data.qrGeneration));
    // 보관 정책: 서버가 온라인 모드로 확인되면 기기에 남은 임베딩을 지운다.
    if (settings.operationMode === "online") await clearFaceProfiles();
    return settings;
  } catch {
    return null;
  }
}

export async function loadSavedKioskSettings(): Promise<KioskSettings> {
  const [mode, windows, faceMatch] = await Promise.all([
    getSetting("operationMode"),
    getSetting("mealWindows"),
    getSetting("faceMatch"),
  ]);
  return {
    operationMode: toMode(mode),
    mealWindows: windows ? (JSON.parse(windows) as MealWindows) : DEFAULT_MEAL_WINDOWS,
    faceMatch: faceMatch ? (JSON.parse(faceMatch) as KioskSettings["faceMatch"]) : DEFAULT_FACE_MATCH,
  };
}

export interface KioskSyncOutcome {
  ok: boolean;
  message: string;
  operationMode?: OperationMode;
  rejectedCount: number;
}

const LOGIN_REQUIRED = "관리자 로그인이 필요합니다. /admin/login에서 먼저 로그인하세요.";

export async function performKioskSync(): Promise<KioskSyncOutcome> {
  if (!navigator.onLine) return { ok: false, message: "오프라인 상태입니다.", rejectedCount: 0 };

  let uploaded = 0;
  let rejectedCount = 0;
  const unsynced = await getUnsyncedCheckIns();
  if (unsynced.length > 0) {
    const payload = unsynced
      .filter((ci) => typeof ci.id === "number")
      .map((ci) => ({
        clientId: ci.id!,
        userId: ci.userId,
        date: ci.date,
        mealKind: ci.mealKind,
        checkedAt: ci.checkedAt,
        type: ci.type,
      }));
    const upRes = await fetch("/api/sync/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkins: payload }),
    });
    if (upRes.status === 401 || upRes.status === 403) {
      return { ok: false, message: `업로드 실패: ${LOGIN_REQUIRED}`, rejectedCount: 0 };
    }
    if (!upRes.ok) return { ok: false, message: `업로드 실패 (${upRes.status})`, rejectedCount: 0 };
    const upData = await upRes.json();
    const syncedIds: number[] = Array.isArray(upData.syncedClientIds)
      ? upData.syncedClientIds.filter((id: unknown): id is number => typeof id === "number")
      : [];
    if (syncedIds.length > 0) await markCheckInsSynced(syncedIds);
    uploaded = syncedIds.length;
    rejectedCount = typeof upData.rejectedCount === "number" ? upData.rejectedCount : 0;
  }

  const downRes = await fetch("/api/sync/download?faces=1");
  if (downRes.status === 401 || downRes.status === 403) {
    return { ok: false, message: `다운로드 실패: ${LOGIN_REQUIRED}`, rejectedCount };
  }
  if (!downRes.ok) return { ok: false, message: `다운로드 실패 (${downRes.status})`, rejectedCount };
  const data = await downRes.json();

  const settings: KioskSettings = {
    operationMode: toMode(data.operationMode),
    mealWindows: data.mealWindows ?? DEFAULT_MEAL_WINDOWS,
    faceMatch: data.faceMatch ?? DEFAULT_FACE_MATCH,
  };
  const users = (data.users ?? []) as LocalUser[];
  await replaceAllUsers(users);
  await replaceAllEligibleEntries((data.eligibleEntries ?? []) as LocalEligibleEntry[]);
  const faceProfiles = (data.faceProfiles ?? []) as LocalFaceProfile[];
  // 보관 정책: 서버가 로컬 모드일 때만 임베딩을 기기에 둔다.
  if (settings.operationMode === "local") await replaceAllFaceProfiles(faceProfiles);
  else await clearFaceProfiles();
  await saveSettings(settings);
  if (data.qrGeneration) await setSetting("qrGeneration", String(data.qrGeneration));
  await setSetting("lastSyncAt", new Date().toISOString());

  const faceCount = settings.operationMode === "local" ? faceProfiles.length : 0;
  return {
    ok: true,
    operationMode: settings.operationMode,
    rejectedCount,
    message: `동기화 완료 — 업로드 ${uploaded}건, 명단 ${users.length}명, 얼굴 ${faceCount}명`,
  };
}
