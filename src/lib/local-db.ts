import {
  createSnapshotStateCache,
  type LocalSnapshotState,
  type SnapshotHeader,
} from "@/lib/academic-year/local-snapshot";

export const DB_NAME = "posanmeal-local";
const DB_VERSION = 6; // v6: 기록 무삭제 이전 + 근거(snapshot)·기기·검토 필드

export interface LocalUser {
  id: number;
  name: string;
  role: "STUDENT" | "TEACHER";
  grade?: number;
  classNum?: number;
  number?: number;
}

export interface LocalCheckIn {
  id?: number; // auto-increment
  userId: number;
  date: string; // "YYYY-MM-DD"
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER";
  checkedAt: string; // ISO string
  type: "STUDENT" | "WORK" | "PERSONAL";
  synced: number; // 0 = not synced, 1 = synced (IndexedDB keys don't support booleans)
  /** 저장 당시 기기가 들고 있던 근거 id. 근거 모드가 아니면 없다. */
  snapshotId?: string;
  deviceId?: string;
  /** 서버가 검토(final=false)로 돌려준 기록의 검토 번호. */
  reviewId?: string;
  reviewReason?: string;
  /** v6 이전 기록의 원본. 판정 근거가 없어 사람 눈으로 확인해야 한다. */
  rawLegacy?: unknown;
  /** 유효기간이 지난 명부로 저장된 기록. 저장은 되었고 재동기화가 필요하다. */
  stale?: boolean;
  /** 서버가 종결한 거절. 다시 보내지 않지만 사유와 함께 화면·내보내기에 남는다. */
  terminal?: "REJECTED";
}

/** v6 이전 기록은 mealKind가 없을 수 있다. 읽을 때만 쓰는 타입이며 새 insert에는 쓰지 않는다. */
export type StoredLocalCheckIn = Omit<LocalCheckIn, "mealKind"> & {
  mealKind?: LocalCheckIn["mealKind"];
};

export const LEGACY_REVIEW_REASON = "이전 버전 기록 확인 필요";

/**
 * v6 이전 기록 한 건을 v6 모양으로 옮긴다. 순수 함수 — 실제 upgrade handler와
 * 브라우저 밖 단위 시험이 같은 규칙을 쓴다. 기록을 지우거나 mealKind를 지어내지 않는다.
 */
export function upgradeLocalCheckIn(original: Record<string, unknown>): Record<string, unknown> {
  const synced = original.synced === true || original.synced === 1 ? 1 : 0;
  if (synced === 1) return { ...original, synced };
  // 이미 근거를 달고 저장된 기록은 서버가 그 근거로 판정할 수 있다.
  if (typeof original.snapshotId === "string" && original.snapshotId.length > 0) {
    return { ...original, synced };
  }
  return {
    ...original,
    synced,
    rawLegacy: original.rawLegacy ?? { ...original },
    reviewReason: original.reviewReason ?? LEGACY_REVIEW_REASON,
  };
}

export interface LocalEligibleEntry {
  userId: number;
  date: string;
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER";
}

/** 이름을 주입할 수 있는 유일한 opener. 브라우저 이전 검증이 제품 handler를 그대로 쓴다. */
export function openDB(databaseName: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }

      if (!db.objectStoreNames.contains("users")) {
        const userStore = db.createObjectStore("users", { keyPath: "id" });
        userStore.createIndex("byRoleGrade", ["role", "grade", "classNum", "number"]);
      }

      // v2→v3: replace mealPeriods with eligibleUsers
      if (oldVersion < 3 && db.objectStoreNames.contains("mealPeriods")) {
        db.deleteObjectStore("mealPeriods");
      }

      if (!db.objectStoreNames.contains("eligibleUsers")) {
        db.createObjectStore("eligibleUsers", { keyPath: "userId" });
      }

      if (oldVersion < 4 && db.objectStoreNames.contains("eligibleUsers")) {
        db.deleteObjectStore("eligibleUsers");
      }

      if (!db.objectStoreNames.contains("eligibleEntries")) {
        db.createObjectStore("eligibleEntries", { keyPath: ["userId", "date", "mealKind"] });
      }

      // 체크인 기록은 어떤 경로로도 삭제하지 않는다. 옛 버전에서 올라오는 값은
      // 모양만 맞추고 판정 근거가 없으면 검토 대상으로 남긴다.
      if (!db.objectStoreNames.contains("checkins")) {
        const checkinStore = db.createObjectStore("checkins", {
          keyPath: "id",
          autoIncrement: true,
        });
        checkinStore.createIndex("byUserDateMealKind", ["userId", "date", "mealKind"], { unique: true });
        checkinStore.createIndex("bySynced", "synced");
      } else {
        const tx = request.transaction;
        if (tx) {
          const checkinStore = tx.objectStore("checkins");
          if (checkinStore.indexNames.contains("byUserDate")) {
            checkinStore.deleteIndex("byUserDate");
          }
          if (!checkinStore.indexNames.contains("byUserDateMealKind")) {
            checkinStore.createIndex("byUserDateMealKind", ["userId", "date", "mealKind"], { unique: true });
          }
          if (!checkinStore.indexNames.contains("bySynced")) {
            checkinStore.createIndex("bySynced", "synced");
          }
          const cursorRequest = checkinStore.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            cursor.update(upgradeLocalCheckIn(cursor.value as Record<string, unknown>));
            cursor.continue();
          };
        }
      }

      if (!db.objectStoreNames.contains("faceProfiles")) {
        db.createObjectStore("faceProfiles", { keyPath: "userId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Settings ---

export async function getSetting(key: string): Promise<string | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const req = tx.objectStore("settings").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const DEVICE_ID_KEY = "deviceId";

/**
 * 기기 번호는 한 번만 만든다. 재시도·재동기화로 바뀌면 서버가 같은 기록을 다른
 * 기기의 새 기록으로 보게 되어 검토가 늘어난다. 전체 초기화로만 사라진다.
 */
/** 구형 브라우저(비보안 컨텍스트 포함)에서도 체크인이 실패하면 안 된다. */
export function newDeviceId(): string {
  const cryptoApi = typeof crypto === "undefined" ? undefined : crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function getDeviceId(): Promise<string> {
  const existing = await getSetting(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = newDeviceId();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const req = store.get(DEVICE_ID_KEY);
    let value = created;
    req.onsuccess = () => {
      const stored = req.result as string | undefined;
      if (stored) value = stored;
      else store.put(created, DEVICE_ID_KEY);
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

// --- Users ---

export async function getUser(id: number): Promise<LocalUser | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readonly");
    const req = tx.objectStore("users").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function replaceAllUsers(users: LocalUser[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    const store = tx.objectStore("users");
    store.clear();
    for (const user of users) {
      store.put(user);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Eligible Users ---

export async function isEligible(
  userId: number,
  date: string,
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER",
): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleEntries", "readonly");
    const req = tx.objectStore("eligibleEntries").get([userId, date, mealKind]);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function replaceAllEligibleUsers(userIds: number[]): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  return replaceAllEligibleEntries(userIds.map((userId) => ({ userId, date: today, mealKind: "DINNER" })));
}

export async function replaceAllEligibleEntries(entries: LocalEligibleEntry[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleEntries", "readwrite");
    const store = tx.objectStore("eligibleEntries");
    store.clear();
    for (const entry of entries) {
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Check-ins ---

export async function getCheckIn(
  userId: number,
  date: string,
  mealKind: "BREAKFAST" | "LUNCH" | "DINNER",
): Promise<LocalCheckIn | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const index = tx.objectStore("checkins").index("byUserDateMealKind");
    const req = index.get([userId, date, mealKind]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addCheckIn(checkin: Omit<LocalCheckIn, "id">): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readwrite");
    tx.objectStore("checkins").add(checkin);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getUnsyncedCheckIns(): Promise<StoredLocalCheckIn[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const index = tx.objectStore("checkins").index("bySynced");
    const req = index.getAll(0); // 0 = not synced
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function markCheckInsSynced(ids: number[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readwrite");
    const store = tx.objectStore("checkins");
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (record) {
          record.synced = 1;
          store.put(record);
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getUnsyncedCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const index = tx.objectStore("checkins").index("bySynced");
    const req = index.count(0); // 0 = not synced
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 종결 거절은 사람이 확인할 시간을 준다. 이보다 오래된 것만 정리한다. */
export const TERMINAL_RETENTION_DAYS = 30;

/** 정리 대상인가. 종결 거절은 보존 기간이 지난 뒤에만 지운다. */
export function shouldClearSyncedCheckIn(record: StoredLocalCheckIn, now: Date): boolean {
  if (record.terminal !== "REJECTED") return true;
  const checkedAt = Date.parse(record.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  return now.getTime() - checkedAt > TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export async function clearSyncedCheckIns(now: Date = new Date()): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readwrite");
    const store = tx.objectStore("checkins");
    const index = store.index("bySynced");
    const req = index.openCursor(1); // 1 = synced
    let count = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (shouldClearSyncedCheckIn(cursor.value as StoredLocalCheckIn, now)) {
          store.delete(cursor.primaryKey);
          count++;
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

// --- Face Profiles (로컬 모드 안면인식 후보) ---

export interface LocalFaceProfile {
  userId: number;
  embeddings: number[][];
}

export async function replaceAllFaceProfiles(profiles: LocalFaceProfile[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readwrite");
    const store = tx.objectStore("faceProfiles");
    store.clear();
    for (const profile of profiles) store.put(profile);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllFaceProfiles(): Promise<LocalFaceProfile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readonly");
    const req = tx.objectStore("faceProfiles").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearFaceProfiles(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("faceProfiles", "readwrite");
    tx.objectStore("faceProfiles").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- 명부 근거 (snapshot) ---

const SNAPSHOT_HEADER_KEY = "snapshotHeader";
const SNAPSHOT_MEMBERS_KEY = "snapshotMembers";
const SNAPSHOT_MODE_KEY = "snapshotMode";
const SERVER_ACTIVE_YEAR_KEY = "serverActiveYear";

export const SNAPSHOT_SETTING_KEYS = {
  header: SNAPSHOT_HEADER_KEY,
  members: SNAPSHOT_MEMBERS_KEY,
  mode: SNAPSHOT_MODE_KEY,
  serverActiveYear: SERVER_ACTIVE_YEAR_KEY,
} as const;

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readLocalSnapshotState(): Promise<LocalSnapshotState> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const store = tx.objectStore("settings");
    const modeReq = store.get(SNAPSHOT_MODE_KEY);
    const headerReq = store.get(SNAPSHOT_HEADER_KEY);
    const membersReq = store.get(SNAPSHOT_MEMBERS_KEY);
    const yearReq = store.get(SERVER_ACTIVE_YEAR_KEY);
    tx.oncomplete = () => {
      const header = parseJson<SnapshotHeader>(headerReq.result);
      const members = parseJson<number[]>(membersReq.result) ?? [];
      const year = Number(yearReq.result);
      resolve({
        snapshotMode: modeReq.result === "1",
        snapshot: header ? { header, members: new Set(members) } : null,
        serverActiveYear: yearReq.result && Number.isFinite(year) ? year : null,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

const snapshotStateCache = createSnapshotStateCache(readLocalSnapshotState);

/** 스캔 경로가 부른다. 같은 근거가 유지되는 동안에는 저장소를 다시 읽지 않는다. */
export function getLocalSnapshotState(): Promise<LocalSnapshotState> {
  return snapshotStateCache.get();
}

export function invalidateLocalSnapshotCache(): void {
  snapshotStateCache.invalidate();
}

export async function getSnapshotHeader(): Promise<SnapshotHeader | null> {
  return (await getLocalSnapshotState()).snapshot?.header ?? null;
}

export async function setServerActiveYear(year: number | null): Promise<void> {
  await setSetting(SERVER_ACTIVE_YEAR_KEY, year === null ? "" : String(year));
  invalidateLocalSnapshotCache();
}

// --- 업로드 결과 반영 ---

export interface CheckInAcknowledgement {
  /** 서버가 final:true로 답한 기록 — 로컬에서 synced로 정리한다. */
  finalIds: number[];
  /** 검토(final:false)로 남은 기록 — 사유와 함께 미전송으로 둔다. */
  review: Array<{ clientId: number; reviewId?: string; reason?: string }>;
  /** 서버가 받지 못한 기록 — 사유와 함께 미전송으로 둔다. */
  rejected: Array<{ clientId: number; reason: string }>;
  /** 서버가 종결 거절한 기록 — 다시 보내지 않지만 사유를 달고 화면에 남는다. */
  rejectedFinal: Array<{ clientId: number; reason: string }>;
}

export async function applyCheckInAcknowledgement(ack: CheckInAcknowledgement): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readwrite");
    const store = tx.objectStore("checkins");
    const patch = (id: number, apply: (record: LocalCheckIn) => LocalCheckIn) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as LocalCheckIn | undefined;
        if (record) store.put(apply(record));
      };
    };
    const terminalReasons = new Map(ack.rejectedFinal.map((item) => [item.clientId, item.reason]));
    for (const id of ack.finalIds) {
      const reason = terminalReasons.get(id);
      patch(id, (record) =>
        reason === undefined
          ? { ...record, synced: 1 }
          : { ...record, synced: 1, terminal: "REJECTED", reviewReason: reason },
      );
    }
    for (const item of ack.review) {
      patch(item.clientId, (record) => ({
        ...record,
        synced: 0,
        reviewId: item.reviewId ?? record.reviewId,
        reviewReason: item.reason ?? record.reviewReason,
      }));
    }
    for (const item of ack.rejected) {
      patch(item.clientId, (record) => ({ ...record, synced: 0, reviewReason: item.reason }));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- 초기화 보호 ---

export interface PendingCheckInCounts {
  /** 아직 서버에 닿지 않은, 검토 대기가 아닌 기록 수. */
  unsynced: number;
  /** 서버가 검토로 세워 둔 기록 수. `unsynced`와 겹치지 않는다. */
  review: number;
}

export async function getPendingCheckInCounts(): Promise<PendingCheckInCounts> {
  const records = await getUnsyncedCheckIns();
  const review = records.filter((record) => record.reviewId !== undefined).length;
  return { unsynced: records.length - review, review };
}

/** 종결 거절(다시 보내지 않지만 사람이 확인해야 하는 기록). */
export async function getTerminalRejectedCheckIns(): Promise<StoredLocalCheckIn[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const req = tx.objectStore("checkins").index("bySynced").getAll(1);
    req.onsuccess = () =>
      resolve((req.result as StoredLocalCheckIn[]).filter((record) => record.terminal === "REJECTED"));
    req.onerror = () => reject(req.error);
  });
}

/** 화면·내보내기가 함께 보는 목록: 미전송 + 종결 거절. */
export async function getReviewableCheckIns(): Promise<StoredLocalCheckIn[]> {
  const [unsynced, rejected] = await Promise.all([getUnsyncedCheckIns(), getTerminalRejectedCheckIns()]);
  return [...unsynced, ...rejected];
}

export type ResetDecision = "ALLOWED" | "NEEDS_FORCED";

/** 미전송·검토 대기가 하나라도 있으면 바로 지우지 않는다. 종결된 기록은 가드 대상이 아니다. */
export function decideResetGuard(counts: PendingCheckInCounts): ResetDecision {
  return counts.unsynced > 0 || counts.review > 0 ? "NEEDS_FORCED" : "ALLOWED";
}

/**
 * 로그아웃은 절대 막지 않되, 서버에 없는 기록이 있으면 키오스크 DB는 지우지 않는다.
 * 관리자는 동기화하려고 바로 그 태블릿에서 로그인하므로, 로그아웃 한 번에 기록이 사라지면 안 된다.
 */
export function decideClientStateReset(counts: PendingCheckInCounts): "FULL" | "KEEP_KIOSK_DB" {
  return decideResetGuard(counts) === "NEEDS_FORCED" ? "KEEP_KIOSK_DB" : "FULL";
}

/** 로그아웃 시 남겨야 할 때 쓰는 부분 정리: 명부·자격·얼굴만 비우고 기록과 기기 번호는 둔다. */
export async function clearRosterKeepCheckIns(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["users", "eligibleEntries", "faceProfiles"], "readwrite");
    tx.objectStore("users").clear();
    tx.objectStore("eligibleEntries").clear();
    tx.objectStore("faceProfiles").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const FORCE_RESET_PHRASE = "초기화";

/** 내보내기를 끝내고 확인 문구를 입력했을 때만, 기기 번호까지 포함해 모두 지운다. */
export async function forceClearLocalData(confirm: { exported: boolean; typed: string }): Promise<void> {
  if (!confirm.exported) throw new Error("먼저 Excel로 내보내야 합니다.");
  if (confirm.typed.trim() !== FORCE_RESET_PHRASE) throw new Error(`확인 문구 "${FORCE_RESET_PHRASE}"를 입력하세요.`);
  await clearAllData();
}

export async function clearAllData(): Promise<void> {
  invalidateLocalSnapshotCache();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = ["settings", "users", "eligibleEntries", "checkins", "faceProfiles"] as const;
    const tx = db.transaction([...storeNames], "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
