import {
  applyCheckInAcknowledgement,
  clearFaceProfiles,
  getDeviceId,
  getSetting,
  getUnsyncedCheckIns,
  openDB,
  setServerActiveYear,
  setSetting,
  type CheckInAcknowledgement,
  type LocalEligibleEntry,
  type LocalFaceProfile,
  type LocalUser,
  type StoredLocalCheckIn,
} from "@/lib/local-db";
import type { SnapshotEvidence } from "@/lib/academic-year/local-snapshot";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind-local";
import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD } from "@/lib/face-constants";

export type OperationMode = "online" | "local";

export interface KioskSettings {
  operationMode: OperationMode;
  mealWindows: MealWindows;
  faceMatch: { threshold: number; margin: number };
}

const DEFAULT_FACE_MATCH = { threshold: DEFAULT_FACE_MATCH_THRESHOLD, margin: DEFAULT_FACE_MATCH_MARGIN };
// 와이파이가 잡혀 있지만 서버에 닿지 않는 키오스크가 "모드 확인 중"에 갇히지 않도록 상한을 둔다.
const SETTINGS_FETCH_TIMEOUT_MS = 5000;
/** 서버가 받아 주는 원본 크기 상한. 넘으면 묶음 전체를 잃지 않도록 표시만 남긴다. */
export const RAW_LEGACY_MAX_BYTES = 8 * 1024;
/** 태블릿 시계가 이만큼 어긋나면 식사 시간·날짜 판정이 통째로 틀어진다. */
const CLOCK_DRIFT_WARN_MS = 30 * 60 * 1000;

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
    const res = await fetch("/api/system/settings", { signal: AbortSignal.timeout(SETTINGS_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = await res.json();
    const settings: KioskSettings = {
      operationMode: toMode(data.operationMode),
      mealWindows: data.mealWindows ?? DEFAULT_MEAL_WINDOWS,
      faceMatch: data.faceMatch ?? DEFAULT_FACE_MATCH,
    };
    await saveSettings(settings);
    if (data.qrGeneration) await setSetting("qrGeneration", String(data.qrGeneration));
    await setServerActiveYear(typeof data.activeAcademicYear === "number" ? data.activeAcademicYear : null);
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

// --- 업로드 ---

export interface UploadItem {
  clientId: number;
  deviceId: string;
  userId: number;
  date: string;
  checkedAt: string;
  type: string;
  mealKind?: string;
  snapshotId?: string;
  rawLegacy?: unknown;
}

/** 기록마다 기기 번호를 싣고, 근거 없는 옛 기록은 원본을 함께 보낸다(판정에는 쓰이지 않는다). */
export function buildUploadItems(records: StoredLocalCheckIn[], deviceId: string): UploadItem[] {
  return records
    .filter((record): record is StoredLocalCheckIn & { id: number } => typeof record.id === "number")
    .map((record) => {
      const item: UploadItem = {
        clientId: record.id,
        deviceId,
        userId: record.userId,
        date: record.date,
        checkedAt: record.checkedAt,
        type: record.type,
      };
      if (record.mealKind) item.mealKind = record.mealKind;
      if (record.snapshotId) item.snapshotId = record.snapshotId;
      if (record.rawLegacy !== undefined) item.rawLegacy = capRawLegacy(record.rawLegacy);
      return item;
    });
}

function capRawLegacy(value: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    return { truncated: true, reason: "원본을 직렬화할 수 없습니다." };
  }
  if (new TextEncoder().encode(serialized).length <= RAW_LEGACY_MAX_BYTES) return value;
  return { truncated: true, reason: "원본이 너무 큽니다." };
}

export interface UploadDecision {
  clientId: number;
  status: "ACCEPTED" | "DUPLICATE" | "REVIEW" | "REJECTED";
  final: boolean;
  reviewId?: string;
  reason?: string;
}

export interface UploadCounts {
  accepted: number;
  duplicate: number;
  review: number;
  rejected: number;
}

export interface UploadOutcome {
  ack: CheckInAcknowledgement;
  counts: UploadCounts;
}

/**
 * 서버 응답을 로컬 정리 지시로 바꾼다. `final:true`만 지우고, 검토·거절은 사유와 함께
 * 미전송으로 남긴다. PREPARING 응답에는 decisions가 없으므로 `syncedClientIds`만 본다.
 */
export function readUploadResponse(data: unknown): UploadOutcome {
  const body = (data ?? {}) as Record<string, unknown>;
  const syncedIds = Array.isArray(body.syncedClientIds)
    ? body.syncedClientIds.filter((id: unknown): id is number => typeof id === "number")
    : [];
  const decisions = Array.isArray(body.decisions) ? (body.decisions as UploadDecision[]) : [];
  const rejectedRows = Array.isArray(body.rejected)
    ? (body.rejected as Array<{ clientId: number | null; reason?: string }>)
    : [];

  const finalIds = new Set<number>(syncedIds);
  const review: CheckInAcknowledgement["review"] = [];
  const counts: UploadCounts = { accepted: 0, duplicate: 0, review: 0, rejected: 0 };

  for (const decision of decisions) {
    if (typeof decision?.clientId !== "number") continue;
    if (decision.final) finalIds.add(decision.clientId);
    if (decision.status === "ACCEPTED") counts.accepted += 1;
    else if (decision.status === "DUPLICATE") counts.duplicate += 1;
    else if (decision.status === "REJECTED") counts.rejected += 1;
    else if (decision.status === "REVIEW") {
      counts.review += 1;
      review.push({ clientId: decision.clientId, reviewId: decision.reviewId, reason: decision.reason });
    }
  }

  const rejected: CheckInAcknowledgement["rejected"] = [];
  for (const row of rejectedRows) {
    if (typeof row?.clientId !== "number" || finalIds.has(row.clientId)) continue;
    rejected.push({ clientId: row.clientId, reason: row.reason ?? "서버가 받지 못했습니다." });
  }

  if (decisions.length === 0) {
    // 옛 응답(PREPARING): 항목별 결정이 없다. 기존처럼 집계 숫자만 쓴다.
    counts.accepted = typeof body.acceptedCount === "number" ? body.acceptedCount : syncedIds.length;
    counts.duplicate = typeof body.duplicatesCount === "number" ? body.duplicatesCount : 0;
    counts.rejected = typeof body.rejectedCount === "number" ? body.rejectedCount : rejected.length;
  }

  return { ack: { finalIds: [...finalIds], review, rejected }, counts };
}

// --- 다운로드 ---

export interface KioskDownload {
  operationMode: OperationMode;
  qrGeneration?: number;
  users: LocalUser[];
  eligibleEntries: LocalEligibleEntry[];
  mealWindows: MealWindows;
  faceMatch: { threshold: number; margin: number };
  faceProfiles: LocalFaceProfile[];
  snapshot: SnapshotEvidence | null;
  serverTime?: string;
}

export function readKioskDownload(data: unknown): KioskDownload {
  const body = (data ?? {}) as Record<string, unknown>;
  const snapshot = body.snapshot as SnapshotEvidence | undefined;
  return {
    operationMode: toMode(body.operationMode),
    qrGeneration: typeof body.qrGeneration === "number" ? body.qrGeneration : undefined,
    users: (body.users ?? []) as LocalUser[],
    eligibleEntries: (body.eligibleEntries ?? []) as LocalEligibleEntry[],
    mealWindows: (body.mealWindows ?? DEFAULT_MEAL_WINDOWS) as MealWindows,
    faceMatch: (body.faceMatch ?? DEFAULT_FACE_MATCH) as KioskSettings["faceMatch"],
    faceProfiles: (body.faceProfiles ?? []) as LocalFaceProfile[],
    snapshot: snapshot ?? null,
    serverTime: typeof body.serverTime === "string" ? body.serverTime : undefined,
  };
}

/**
 * 명부·근거·설정을 한 트랜잭션에서 통째로 바꾼다. 중간에 실패하면 abort되어
 * 직전 명부가 그대로 남는다. 체크인 기록은 이 트랜잭션에 넣지 않는다.
 */
export function applyKioskSnapshot(db: IDBDatabase, download: KioskDownload): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["users", "eligibleEntries", "faceProfiles", "settings"], "readwrite");
    const users = tx.objectStore("users");
    users.clear();
    for (const user of download.users) users.put(user);

    const eligible = tx.objectStore("eligibleEntries");
    eligible.clear();
    for (const entry of download.eligibleEntries) eligible.put(entry);

    const faces = tx.objectStore("faceProfiles");
    faces.clear();
    // 보관 정책: 서버가 로컬 모드일 때만 임베딩을 기기에 둔다.
    if (download.operationMode === "local") {
      for (const profile of download.faceProfiles) faces.put(profile);
    }

    const settings = tx.objectStore("settings");
    settings.put(download.operationMode, "operationMode");
    settings.put(JSON.stringify(download.mealWindows), "mealWindows");
    settings.put(JSON.stringify(download.faceMatch), "faceMatch");
    if (download.qrGeneration !== undefined) settings.put(String(download.qrGeneration), "qrGeneration");
    settings.put(new Date().toISOString(), "lastSyncAt");
    settings.put(download.snapshot ? "1" : "0", "snapshotMode");
    if (download.snapshot) {
      settings.put(JSON.stringify(download.snapshot), "snapshot");
      settings.put(String(download.snapshot.activeYear), "serverActiveYear");
    } else {
      settings.delete("snapshot");
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("명부 교체가 중단되었습니다."));
  });
}

export interface KioskSyncOutcome {
  ok: boolean;
  message: string;
  operationMode?: OperationMode;
  /** 서버가 결론짓지 못해 남은 기록 수(옛 응답의 rejectedCount 포함). */
  rejectedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  reviewCount: number;
  /** 업로드만 끝나고 내려받기가 실패했는지 — 화면이 둘을 구분해 알린다. */
  uploaded: boolean;
  freshUntil?: string;
}

const LOGIN_REQUIRED = "관리자 로그인이 필요합니다. /admin/login에서 먼저 로그인하세요.";

function emptyCounts(): UploadCounts {
  return { accepted: 0, duplicate: 0, review: 0, rejected: 0 };
}

function uploadSummary(counts: UploadCounts, finalized: number): string {
  let text = `업로드 ${finalized}건 반영(승인 ${counts.accepted}·중복 ${counts.duplicate})`;
  if (counts.review > 0) text += `, 확인 대기 ${counts.review}건`;
  if (counts.rejected > 0) text += `, 미반영 ${counts.rejected}건`;
  return text;
}

export async function performKioskSync(): Promise<KioskSyncOutcome> {
  const base = { acceptedCount: 0, duplicateCount: 0, reviewCount: 0, rejectedCount: 0, uploaded: false };
  if (!navigator.onLine) return { ok: false, message: "오프라인 상태입니다.", ...base };

  let counts = emptyCounts();
  let finalized = 0;
  let uploaded = false;

  const unsynced = await getUnsyncedCheckIns();
  if (unsynced.length > 0) {
    const deviceId = await getDeviceId();
    const payload = buildUploadItems(unsynced, deviceId);
    const upRes = await fetch("/api/sync/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkins: payload }),
    });
    if (upRes.status === 401 || upRes.status === 403) {
      return { ok: false, message: `업로드 실패: ${LOGIN_REQUIRED}`, ...base };
    }
    if (!upRes.ok) return { ok: false, message: `업로드 실패 (${upRes.status})`, ...base };
    const outcome = readUploadResponse(await upRes.json());
    await applyCheckInAcknowledgement(outcome.ack);
    counts = outcome.counts;
    finalized = outcome.ack.finalIds.length;
    uploaded = true;
  }

  const uploadResult = {
    acceptedCount: counts.accepted,
    duplicateCount: counts.duplicate,
    reviewCount: counts.review,
    rejectedCount: counts.rejected,
    uploaded,
  };
  // 내려받기가 실패해도 업로드 결과는 숨기지 않는다.
  const uploadNote = uploaded ? `${uploadSummary(counts, finalized)} | ` : "";

  const downRes = await fetch("/api/sync/download?faces=1");
  if (downRes.status === 401 || downRes.status === 403) {
    return { ok: false, message: `${uploadNote}다운로드 실패: ${LOGIN_REQUIRED}`, ...uploadResult };
  }
  if (!downRes.ok) {
    return { ok: false, message: `${uploadNote}다운로드 실패 (${downRes.status})`, ...uploadResult };
  }

  const download = readKioskDownload(await downRes.json());
  const db = await openDB();
  await applyKioskSnapshot(db, download);

  const faceCount = download.operationMode === "local" ? download.faceProfiles.length : 0;
  const drift =
    download.serverTime && Math.abs(Date.parse(download.serverTime) - Date.now()) > CLOCK_DRIFT_WARN_MS
      ? " | 경고: 태블릿 시계를 확인하세요 (서버와 30분 이상 차이)"
      : "";
  return {
    ok: true,
    operationMode: download.operationMode,
    ...uploadResult,
    freshUntil: download.snapshot?.freshUntil,
    message: `${uploadNote}동기화 완료 — 명단 ${download.users.length}명, 얼굴 ${faceCount}명${drift}`,
  };
}
