const DB_NAME = "posanmeal-local";
const DB_VERSION = 2; // v2: synced field changed from boolean to number (0/1)

export interface LocalUser {
  id: number;
  name: string;
  role: "STUDENT" | "TEACHER";
  grade?: number;
  classNum?: number;
  number?: number;
}

export interface LocalMealPeriod {
  userId: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
}

export interface LocalCheckIn {
  id?: number; // auto-increment
  userId: number;
  date: string; // "YYYY-MM-DD"
  checkedAt: string; // ISO string
  type: "STUDENT" | "WORK" | "PERSONAL";
  synced: number; // 0 = not synced, 1 = synced (IndexedDB keys don't support booleans)
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

      if (!db.objectStoreNames.contains("mealPeriods")) {
        db.createObjectStore("mealPeriods", { keyPath: "userId" });
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
        checkinStore.createIndex("byUserDate", ["userId", "date"], { unique: true });
        checkinStore.createIndex("bySynced", "synced");
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

// --- Meal Periods ---

export async function getMealPeriod(userId: number): Promise<LocalMealPeriod | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mealPeriods", "readonly");
    const req = tx.objectStore("mealPeriods").get(userId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function replaceAllMealPeriods(periods: LocalMealPeriod[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mealPeriods", "readwrite");
    const store = tx.objectStore("mealPeriods");
    store.clear();
    for (const period of periods) {
      store.put(period);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Check-ins ---

export async function getCheckIn(userId: number, date: string): Promise<LocalCheckIn | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const index = tx.objectStore("checkins").index("byUserDate");
    const req = index.get([userId, date]);
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
    const storeNames = ["settings", "users", "mealPeriods", "checkins"] as const;
    const tx = db.transaction([...storeNames], "readwrite");
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
