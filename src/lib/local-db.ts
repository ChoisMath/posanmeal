import type { LocalSnapshotState, SnapshotEvidence } from "@/lib/academic-year/local-snapshot";

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
export async function getDeviceId(): Promise<string> {
  const existing = await getSetting(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
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

export async function clearSyncedCheckIns(): Promise<number> {
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
        store.delete(cursor.primaryKey);
        count++;
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

const SNAPSHOT_KEY = "snapshot";
const SNAPSHOT_MODE_KEY = "snapshotMode";
const SERVER_ACTIVE_YEAR_KEY = "serverActiveYear";

export async function getLocalSnapshotState(): Promise<LocalSnapshotState> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const store = tx.objectStore("settings");
    const modeReq = store.get(SNAPSHOT_MODE_KEY);
    const snapshotReq = store.get(SNAPSHOT_KEY);
    const yearReq = store.get(SERVER_ACTIVE_YEAR_KEY);
    tx.oncomplete = () => {
      let snapshot: SnapshotEvidence | null = null;
      if (typeof snapshotReq.result === "string") {
        try {
          snapshot = JSON.parse(snapshotReq.result) as SnapshotEvidence;
        } catch {
          snapshot = null;
        }
      }
      const year = Number(yearReq.result);
      resolve({
        snapshotMode: modeReq.result === "1",
        snapshot,
        serverActiveYear: Number.isFinite(year) && yearReq.result ? year : null,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function setServerActiveYear(year: number | null): Promise<void> {
  await setSetting(SERVER_ACTIVE_YEAR_KEY, year === null ? "" : String(year));
}

// --- 업로드 결과 반영 ---

export interface CheckInAcknowledgement {
  /** 서버가 final:true로 답한 기록 — 로컬에서 synced로 정리한다. */
  finalIds: number[];
  /** 검토(final:false)로 남은 기록 — 사유와 함께 미전송으로 둔다. */
  review: Array<{ clientId: number; reviewId?: string; reason?: string }>;
  /** 서버가 받지 못한 기록 — 사유와 함께 미전송으로 둔다. */
  rejected: Array<{ clientId: number; reason: string }>;
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
    for (const id of ack.finalIds) patch(id, (record) => ({ ...record, synced: 1 }));
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
  unsynced: number;
  review: number;
}

export async function getPendingCheckInCounts(): Promise<PendingCheckInCounts> {
  const records = await getUnsyncedCheckIns();
  return {
    unsynced: records.length,
    review: records.filter((record) => record.reviewId !== undefined).length,
  };
}

export type ResetDecision = "ALLOWED" | "NEEDS_FORCED";

/** 미전송·검토 대기가 하나라도 있으면 바로 지우지 않는다. */
export function decideResetGuard(counts: PendingCheckInCounts): ResetDecision {
  return counts.unsynced > 0 || counts.review > 0 ? "NEEDS_FORCED" : "ALLOWED";
}

export const FORCE_RESET_PHRASE = "초기화";

/** 내보내기를 끝내고 확인 문구를 입력했을 때만, 기기 번호까지 포함해 모두 지운다. */
export async function forceClearLocalData(confirm: { exported: boolean; typed: string }): Promise<void> {
  if (!confirm.exported) throw new Error("먼저 Excel로 내보내야 합니다.");
  if (confirm.typed.trim() !== FORCE_RESET_PHRASE) throw new Error(`확인 문구 "${FORCE_RESET_PHRASE}"를 입력하세요.`);
  await clearAllData();
}

export async function clearAllData(): Promise<void> {
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
