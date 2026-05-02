const DB_NAME = "posanmeal-local";
const DB_VERSION = 4; // v4: mealKind-aware eligibility and check-ins

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
  mealKind: "BREAKFAST" | "DINNER";
  checkedAt: string; // ISO string
  type: "STUDENT" | "WORK" | "PERSONAL";
  synced: number; // 0 = not synced, 1 = synced (IndexedDB keys don't support booleans)
}

export interface LocalEligibleEntry {
  userId: number;
  date: string;
  mealKind: "BREAKFAST" | "DINNER";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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

      // v1→v2: recreate checkins store with number-based synced field
      if (oldVersion < 2 && db.objectStoreNames.contains("checkins")) {
        db.deleteObjectStore("checkins");
      }

      if (!db.objectStoreNames.contains("checkins")) {
        const checkinStore = db.createObjectStore("checkins", {
          keyPath: "id",
          autoIncrement: true,
        });
        checkinStore.createIndex("byUserDateMealKind", ["userId", "date", "mealKind"], { unique: true });
        checkinStore.createIndex("bySynced", "synced");
      } else if (oldVersion < 4) {
        const tx = request.transaction;
        if (tx) {
          const checkinStore = tx.objectStore("checkins");
          if (checkinStore.indexNames.contains("byUserDate")) {
            checkinStore.deleteIndex("byUserDate");
          }
          if (!checkinStore.indexNames.contains("byUserDateMealKind")) {
            checkinStore.createIndex("byUserDateMealKind", ["userId", "date", "mealKind"], { unique: true });
          }
          checkinStore.openCursor().onsuccess = (cursorEvent) => {
            const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            const value = cursor.value as LocalCheckIn;
            if (!value.mealKind) {
              cursor.update({ ...value, mealKind: "DINNER" });
            }
            cursor.continue();
          };
        }
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
  mealKind: "BREAKFAST" | "DINNER",
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
  mealKind: "BREAKFAST" | "DINNER",
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

export async function getUnsyncedCheckIns(): Promise<LocalCheckIn[]> {
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

export async function clearAllData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = ["settings", "users", "eligibleEntries", "checkins"] as const;
    const tx = db.transaction([...storeNames], "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
