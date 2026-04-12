# Offline/Local Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PWA offline check-in capability so tablets without WiFi can scan QR codes and store check-ins locally, syncing when back online.

**Architecture:** Two-mode system (online/local) controlled by a server-side `SystemSetting` table. Online mode is unchanged. Local mode uses fixed QR codes (`posanmeal:{userId}:{generation}:{type}`), IndexedDB for local storage on tablets, and a Service Worker for offline `/check` page caching. Sync APIs handle bidirectional data transfer (users/settings down, check-ins up).

**Tech Stack:** Next.js 16 App Router, Prisma 7, IndexedDB (native API), Service Worker (hand-written), Auth.js v5

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/local-db.ts` | IndexedDB wrapper — open/upgrade DB, CRUD for all 4 stores, sync helpers |
| `src/app/api/system/settings/route.ts` | GET/PUT system settings (operationMode, qrGeneration) |
| `src/app/api/sync/download/route.ts` | GET — full user+mealPeriod+settings dump for tablets |
| `src/app/api/sync/upload/route.ts` | POST — receive local check-in records from tablets |
| `public/sw.js` | Service Worker — cache `/check` page and static assets for offline use |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `SystemSetting` model |
| `src/auth.ts` | Change session maxAge from 60 days → 365 days |
| `src/middleware.ts` | Add `/api/system`, `/api/sync` to public prefixes |
| `src/app/api/qr/token/route.ts` | Return fixed QR string when mode is "local" |
| `src/components/QRGenerator.tsx` | Support local mode (fixed QR, no timer) |
| `src/app/check/page.tsx` | Mode detection, local check-in flow, status bar, sync UI |
| `src/app/admin/page.tsx` | Add system settings section (mode toggle, QR refresh) |

---

## Task 1: Prisma Schema — Add SystemSetting Model

**Files:**
- Modify: `prisma/schema.prisma:72` (append after CheckIn model)

- [ ] **Step 1: Add SystemSetting model to schema**

Add at the end of `prisma/schema.prisma`:

```prisma
model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Create and apply migration**

Run:
```bash
npx prisma migrate dev --name add-system-setting
```

Expected: Migration created and applied successfully. New `SystemSetting` table in DB.

- [ ] **Step 3: Seed default settings**

Add to `prisma/seed.ts` after existing seed logic:

```ts
// Seed system settings (upsert to avoid duplicates)
await prisma.systemSetting.upsert({
  where: { key: "operationMode" },
  update: {},
  create: { key: "operationMode", value: "online" },
});
await prisma.systemSetting.upsert({
  where: { key: "qrGeneration" },
  update: {},
  create: { key: "qrGeneration", value: "1" },
});
```

Run seed: `npx prisma db seed`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ prisma/seed.ts
git commit -m "feat: add SystemSetting model for online/local mode management"
```

---

## Task 2: Session MaxAge — 365 Days

**Files:**
- Modify: `src/auth.ts:12-18`

- [ ] **Step 1: Update session and JWT maxAge**

In `src/auth.ts`, change:

```ts
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 60, // 60 days
    updateAge: 60 * 60 * 24, // rolling refresh once per day
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 60,
  },
```

To:

```ts
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 365, // 365 days
    updateAge: 60 * 60 * 24, // rolling refresh once per day
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 365, // 365 days
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/auth.ts
git commit -m "feat: extend session maxAge from 60 days to 365 days"
```

---

## Task 3: System Settings API

**Files:**
- Create: `src/app/api/system/settings/route.ts`
- Modify: `src/middleware.ts:10`

- [ ] **Step 1: Update middleware to allow public GET on /api/system/settings**

In `src/middleware.ts`, change line 10:

```ts
  const publicPrefixes = ["/api/auth", "/api/checkin", "/api/uploads", "/_next", "/uploads"];
```

To:

```ts
  const publicPrefixes = ["/api/auth", "/api/checkin", "/api/uploads", "/api/system/settings", "/api/sync", "/_next", "/uploads"];
```

- [ ] **Step 2: Create system settings API route**

Create `src/app/api/system/settings/route.ts`:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const settings = await prisma.systemSetting.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return NextResponse.json({
    operationMode: result.operationMode || "online",
    qrGeneration: parseInt(result.qrGeneration || "1", 10),
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (body.operationMode !== undefined) {
    if (body.operationMode !== "online" && body.operationMode !== "local") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    await prisma.systemSetting.upsert({
      where: { key: "operationMode" },
      update: { value: body.operationMode },
      create: { key: "operationMode", value: body.operationMode },
    });
  }

  if (body.refreshQR) {
    const current = await prisma.systemSetting.findUnique({
      where: { key: "qrGeneration" },
    });
    const next = (parseInt(current?.value || "1", 10) + 1).toString();
    await prisma.systemSetting.upsert({
      where: { key: "qrGeneration" },
      update: { value: next },
      create: { key: "qrGeneration", value: next },
    });
  }

  // Return updated settings
  const settings = await prisma.systemSetting.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return NextResponse.json({
    operationMode: result.operationMode || "online",
    qrGeneration: parseInt(result.qrGeneration || "1", 10),
  });
}
```

- [ ] **Step 3: Verify API works**

Run dev server: `npm run dev`

Test GET: `curl http://localhost:3000/api/system/settings`
Expected: `{"operationMode":"online","qrGeneration":1}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/system/settings/route.ts src/middleware.ts
git commit -m "feat: add system settings API for operation mode and QR generation"
```

---

## Task 4: QR Token API — Local Mode Support

**Files:**
- Modify: `src/app/api/qr/token/route.ts`

- [ ] **Step 1: Add local mode branch to QR token API**

Replace the entire content of `src/app/api/qr/token/route.ts`:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";

  const userId = session.user.dbUserId;
  const role = session.user.role as "STUDENT" | "TEACHER";

  // Check operation mode
  const modeSetting = await prisma.systemSetting.findUnique({
    where: { key: "operationMode" },
  });
  const isLocal = modeSetting?.value === "local";

  // For students, check meal period (both modes)
  if (role === "STUDENT") {
    const today = todayKST();
    const mealPeriod = await prisma.mealPeriod.findUnique({
      where: { userId },
    });

    if (!mealPeriod) {
      return NextResponse.json(
        { error: "석식 신청 기간이 없습니다." },
        { status: 400 }
      );
    }

    const todayDate = new Date(today);
    if (todayDate < mealPeriod.startDate || todayDate > mealPeriod.endDate) {
      return NextResponse.json(
        { error: "현재 석식 신청 기간이 아닙니다." },
        { status: 400 }
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  // Local mode: return fixed QR string
  if (isLocal) {
    const genSetting = await prisma.systemSetting.findUnique({
      where: { key: "qrGeneration" },
    });
    const generation = genSetting?.value || "1";
    const qrString = `posanmeal:${userId}:${generation}:${validType}`;

    return NextResponse.json({
      token: qrString,
      expiresIn: 0, // 0 signals "no expiry" to the client
      mode: "local",
    });
  }

  // Online mode: existing JWT behavior
  const token = signQRToken({
    userId,
    role,
    type: validType,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
    mode: "online",
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/qr/token/route.ts
git commit -m "feat: QR token API returns fixed QR string in local mode"
```

---

## Task 5: QRGenerator Component — Local Mode Support

**Files:**
- Modify: `src/components/QRGenerator.tsx`

- [ ] **Step 1: Update QRGenerator to handle local mode**

Replace the entire content of `src/components/QRGenerator.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";

interface QRGeneratorProps {
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export function QRGenerator({ type }: QRGeneratorProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [mode, setMode] = useState<"online" | "local">("online");

  const generateQRImage = useCallback(async (data: string) => {
    const dataUrl = await QRCode.toDataURL(data, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    setQrDataUrl(dataUrl);
  }, []);

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/qr/token?type=${type}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "QR 코드를 생성할 수 없습니다.");
        setQrDataUrl("");
        return;
      }

      setError("");
      setMode(data.mode || "online");
      await generateQRImage(data.token);
      setTimeLeft(data.expiresIn);
    } catch {
      setError("QR 코드 생성 중 오류가 발생했습니다.");
    }
  }, [type, generateQRImage]);

  useEffect(() => {
    fetchToken();
  }, [fetchToken]);

  // Timer: only for online mode (local mode has expiresIn=0)
  useEffect(() => {
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          fetchToken();
          return 0;
        }
        if (prev === 30) {
          fetchToken();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, fetchToken]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="QR Code"
          className="w-[280px] h-[280px] rounded-xl border"
        />
      ) : (
        <div className="w-[280px] h-[280px] rounded-xl border flex items-center justify-center">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      )}
      {mode === "online" ? (
        <p className="text-sm font-mono text-muted-foreground">
          {minutes}:{seconds.toString().padStart(2, "0")} 남음
        </p>
      ) : (
        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
          로컬 모드 — 고유 QR코드
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify both modes work**

Run dev server. Test:
1. With `operationMode = "online"` in DB → timer countdown visible
2. Change to `"local"` in DB → "로컬 모드 — 고유 QR코드" text shown, no timer

- [ ] **Step 3: Commit**

```bash
git add src/components/QRGenerator.tsx
git commit -m "feat: QRGenerator supports local mode with fixed QR display"
```

---

## Task 6: IndexedDB Wrapper

**Files:**
- Create: `src/lib/local-db.ts`

- [ ] **Step 1: Create IndexedDB wrapper**

Create `src/lib/local-db.ts`:

```ts
const DB_NAME = "posanmeal-local";
const DB_VERSION = 1;

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
  synced: boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

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
    const req = index.getAll(false);
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
          record.synced = true;
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
    const req = index.count(false);
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
    const req = index.openCursor(true); // synced === true
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/local-db.ts
git commit -m "feat: add IndexedDB wrapper for offline local data storage"
```

---

## Task 7: Sync APIs (Download + Upload)

**Files:**
- Create: `src/app/api/sync/download/route.ts`
- Create: `src/app/api/sync/upload/route.ts`

Note: Middleware already updated in Task 3 to allow `/api/sync` prefix.

- [ ] **Step 1: Create sync download API**

Create `src/app/api/sync/download/route.ts`:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [settings, users, mealPeriods] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.user.findMany({
      select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
    }),
    prisma.mealPeriod.findMany({
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  return NextResponse.json({
    operationMode: settingsMap.operationMode || "online",
    qrGeneration: parseInt(settingsMap.qrGeneration || "1", 10),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      grade: u.grade,
      classNum: u.classNum,
      number: u.number,
    })),
    mealPeriods: mealPeriods.map((mp) => ({
      userId: mp.userId,
      startDate: mp.startDate.toISOString().slice(0, 10),
      endDate: mp.endDate.toISOString().slice(0, 10),
    })),
    serverTime: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Create sync upload API**

Create `src/app/api/sync/upload/route.ts`:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface UploadCheckIn {
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { checkins } = (await request.json()) as { checkins: UploadCheckIn[] };

  if (!Array.isArray(checkins) || checkins.length === 0) {
    return NextResponse.json({ accepted: 0, duplicates: 0, rejected: [] });
  }

  let accepted = 0;
  let duplicates = 0;
  const rejected: { userId: number; date: string; reason: string }[] = [];

  for (const ci of checkins) {
    try {
      const dateObj = new Date(ci.date + "T00:00:00Z");

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: ci.userId },
        select: { id: true, role: true },
      });

      if (!user) {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "USER_NOT_FOUND" });
        continue;
      }

      // Check meal period for students
      if (user.role === "STUDENT") {
        const mp = await prisma.mealPeriod.findUnique({ where: { userId: ci.userId } });
        if (!mp || dateObj < mp.startDate || dateObj > mp.endDate) {
          rejected.push({ userId: ci.userId, date: ci.date, reason: "NO_MEAL_PERIOD" });
          continue;
        }
      }

      // Try to create (unique constraint handles duplicates)
      await prisma.checkIn.create({
        data: {
          userId: ci.userId,
          date: dateObj,
          checkedAt: new Date(ci.checkedAt),
          type: ci.type,
        },
      });
      accepted++;
    } catch (err: unknown) {
      // Prisma unique constraint violation
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        duplicates++;
      } else {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "SERVER_ERROR" });
      }
    }
  }

  return NextResponse.json({ accepted, duplicates, rejected });
}
```

- [ ] **Step 3: Verify both APIs**

Test download (requires admin session in browser):
Navigate to `http://localhost:3000/api/sync/download` while logged in as admin.
Expected: JSON with users array, mealPeriods array, settings.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sync/download/route.ts src/app/api/sync/upload/route.ts
git commit -m "feat: add sync download/upload APIs for offline tablet synchronization"
```

---

## Task 8: Service Worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Create Service Worker**

Create `public/sw.js`:

```js
const CACHE_VERSION = "posanmeal-v1";
const PRECACHE_URLS = ["/check"];

// Install: cache the /check page shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // API requests: always network (never cache)
  if (url.pathname.startsWith("/api/")) return;

  // Static assets (/_next/static/): Cache First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // /check page: Cache First (critical for offline)
  if (url.pathname === "/check") {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Icons and manifest: Cache First
  if (
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/meal.png"
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Everything else: Network only (no offline support needed)
});
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "feat: add Service Worker for offline /check page caching"
```

---

## Task 9: Check Page — Local Mode Integration

This is the largest task. The `/check` page needs: mode detection, local check-in flow, status bar, and sync UI.

**Files:**
- Modify: `src/app/check/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite check page with local mode support**

Replace the entire content of `src/app/check/page.tsx`:

```tsx
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { QRScanner } from "@/components/QRScanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import {
  getSetting,
  setSetting,
  getUser,
  getMealPeriod,
  getCheckIn,
  addCheckIn,
  getUnsyncedCheckIns,
  getUnsyncedCount,
  markCheckInsSynced,
  replaceAllUsers,
  replaceAllMealPeriods,
  clearSyncedCheckIns,
  clearAllData,
} from "@/lib/local-db";
import type { LocalUser } from "@/lib/local-db";
import { RefreshCw, Wifi, WifiOff, Trash2 } from "lucide-react";

interface CheckInResult {
  success: boolean;
  duplicate?: boolean;
  error?: string;
  user?: {
    id: number;
    name: string;
    role: string;
    grade?: number;
    classNum?: number;
    number?: number;
    photoUrl?: string;
  };
  type?: string;
  checkedAt?: string;
}

// AudioContext singleton
let _audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

function playChime() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.4;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 523;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 659;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.18);
    osc2.stop(ctx.currentTime + 0.38);
  } catch {}
}

function playLongBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.6;
    const osc = ctx.createOscillator();
    osc.frequency.value = 400;
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  } catch {}
}

function playDoubleBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.5;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 500;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 500;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.35);
    osc2.stop(ctx.currentTime + 0.55);
  } catch {}
}

function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Parse "posanmeal:{userId}:{generation}:{type}"
function parseLocalQR(data: string): { userId: number; generation: string; type: string } | null {
  const parts = data.split(":");
  if (parts.length !== 4 || parts[0] !== "posanmeal") return null;
  const userId = parseInt(parts[1], 10);
  if (isNaN(userId)) return null;
  return { userId, generation: parts[2], type: parts[3] };
}

function formatUserLabel(user: LocalUser): string {
  if (user.role === "STUDENT") {
    return `${user.grade}-${user.classNum} ${user.number}번 ${user.name}`;
  }
  return `${user.name} 선생님`;
}

export default function CheckPage() {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const processingRef = useRef(false);
  const [operationMode, setOperationMode] = useState<"online" | "local">("online");
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Register Service Worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  // Initialize mode and online status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync after 3s stabilization
      setTimeout(() => performSync(), 3000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Load mode from IndexedDB
    getSetting("operationMode").then((mode) => {
      if (mode === "local") setOperationMode("local");
    });
    getSetting("lastSyncAt").then((ts) => setLastSyncAt(ts || null));
    getUnsyncedCount().then(setUnsyncedCount);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Online mode: existing server-based check-in ---
  const handleOnlineScan = useCallback(async (data: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data }),
      });
      const json = await res.json();
      setResult(json);

      if (json.success) playChime();
      else if (json.duplicate) playLongBeep();
      else playDoubleBeep();
    } catch {
      setResult({ success: false, error: "서버 연결 오류" });
      playDoubleBeep();
    }

    setTimeout(() => {
      setResult(null);
      processingRef.current = false;
    }, 2000);
  }, []);

  // --- Local mode: IndexedDB-based check-in ---
  const handleLocalScan = useCallback(async (data: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      // 1. Parse QR
      const parsed = parseLocalQR(data);
      if (!parsed) {
        setResult({ success: false, error: "잘못된 QR코드입니다." });
        playDoubleBeep();
        return;
      }

      // 2. Generation check
      const storedGen = await getSetting("qrGeneration");
      if (storedGen && parsed.generation !== storedGen) {
        setResult({ success: false, error: "QR코드가 만료되었습니다. 학생 앱에서 새 QR을 확인하세요." });
        playDoubleBeep();
        return;
      }

      // 3. User lookup
      const user = await getUser(parsed.userId);
      if (!user) {
        setResult({ success: false, error: "미등록 사용자입니다." });
        playDoubleBeep();
        return;
      }

      // 4. Role/type validation
      const validTypes: Record<string, string[]> = {
        STUDENT: ["STUDENT"],
        TEACHER: ["WORK", "PERSONAL"],
      };
      if (!validTypes[user.role]?.includes(parsed.type)) {
        setResult({ success: false, error: "잘못된 QR 유형입니다." });
        playDoubleBeep();
        return;
      }

      // 5. Meal period check (students only)
      if (user.role === "STUDENT") {
        const mp = await getMealPeriod(parsed.userId);
        const today = todayLocal();
        if (!mp) {
          setResult({ success: false, error: "석식 신청 기간이 없습니다." });
          playDoubleBeep();
          return;
        }
        if (today < mp.startDate || today > mp.endDate) {
          setResult({ success: false, error: "오늘은 석식 대상이 아닙니다." });
          playDoubleBeep();
          return;
        }
      }

      // 6. Duplicate check
      const today = todayLocal();
      const existing = await getCheckIn(parsed.userId, today);
      if (existing) {
        const time = new Date(existing.checkedAt);
        const hh = String(time.getHours()).padStart(2, "0");
        const mm = String(time.getMinutes()).padStart(2, "0");
        setResult({
          success: false,
          duplicate: true,
          user: { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number },
          checkedAt: existing.checkedAt,
          error: `이미 체크인되었습니다 (${hh}:${mm})`,
        });
        playLongBeep();
        return;
      }

      // 7. Save check-in
      const checkedAt = new Date().toISOString();
      await addCheckIn({
        userId: parsed.userId,
        date: today,
        checkedAt,
        type: parsed.type as "STUDENT" | "WORK" | "PERSONAL",
        synced: false,
      });

      setResult({
        success: true,
        user: { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number },
        type: parsed.type,
        checkedAt,
      });
      playChime();

      // Update unsynced count
      getUnsyncedCount().then(setUnsyncedCount);
    } catch {
      setResult({ success: false, error: "저장 오류가 발생했습니다. 다시 스캔해 주세요." });
      playDoubleBeep();
    } finally {
      setTimeout(() => {
        setResult(null);
        processingRef.current = false;
      }, 2000);
    }
  }, []);

  const handleScan = useCallback(
    (data: string) => {
      if (operationMode === "local") {
        handleLocalScan(data);
      } else {
        handleOnlineScan(data);
      }
    },
    [operationMode, handleLocalScan, handleOnlineScan]
  );

  // --- Sync logic ---
  async function performSync() {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      // 1. Upload unsynced check-ins
      const unsynced = await getUnsyncedCheckIns();
      if (unsynced.length > 0) {
        const payload = unsynced.map((ci) => ({
          userId: ci.userId,
          date: ci.date,
          checkedAt: ci.checkedAt,
          type: ci.type,
        }));

        const upRes = await fetch("/api/sync/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkins: payload }),
        });

        if (upRes.ok) {
          const upData = await upRes.json();
          // Mark all uploaded as synced (accepted + duplicates are both "done")
          const ids = unsynced.map((ci) => ci.id!);
          await markCheckInsSynced(ids);
          setSyncMessage(`업로드: ${upData.accepted}건 전송, ${upData.duplicates}건 중복`);
        } else {
          setSyncMessage("업로드 실패. 다음에 다시 시도합니다.");
          setSyncing(false);
          return;
        }
      }

      // 2. Download latest data
      const downRes = await fetch("/api/sync/download");
      if (downRes.ok) {
        const data = await downRes.json();

        await setSetting("operationMode", data.operationMode);
        await setSetting("qrGeneration", data.qrGeneration.toString());
        await replaceAllUsers(data.users);
        await replaceAllMealPeriods(data.mealPeriods);

        const now = new Date().toISOString();
        await setSetting("lastSyncAt", now);

        setOperationMode(data.operationMode);
        setLastSyncAt(now);

        // Check server time drift
        const serverTime = new Date(data.serverTime).getTime();
        const localTime = Date.now();
        if (Math.abs(serverTime - localTime) > 30 * 60 * 1000) {
          setSyncMessage((prev) =>
            (prev ? prev + " | " : "") + "경고: 태블릿 시계를 확인하세요 (서버와 30분 이상 차이)"
          );
        }

        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "다운로드 완료"
        );
      } else if (downRes.status === 403) {
        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "관리자 재로그인이 필요합니다"
        );
      } else {
        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "다운로드 실패"
        );
      }
    } catch {
      setSyncMessage("동기화 중 오류가 발생했습니다.");
    }

    await getUnsyncedCount().then(setUnsyncedCount);
    setSyncing(false);
  }

  async function handleClearSynced() {
    if (!confirm("동기화 완료된 체크인 기록을 삭제하시겠습니까?")) return;
    const count = await clearSyncedCheckIns();
    setSyncMessage(`${count}건의 동기화된 기록을 정리했습니다.`);
  }

  async function handleClearAll() {
    if (!confirm("모든 로컬 데이터를 삭제하시겠습니까? 미전송 체크인도 삭제됩니다.")) return;
    if (!confirm("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    await clearAllData();
    setOperationMode("online");
    setUnsyncedCount(0);
    setLastSyncAt(null);
    setSyncMessage("모든 로컬 데이터가 삭제되었습니다.");
  }

  const formatCheckedAt = (checkedAt: string) => {
    const d = new Date(checkedAt);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}시`;
  };

  const typeLabel = (type?: string) => {
    if (type === "WORK") return "근무";
    if (type === "PERSONAL") return "개인";
    return "";
  };

  const bgClass = result
    ? result.duplicate
      ? "bg-red-500"
      : result.success
        ? "bg-emerald-500"
        : "bg-amber-500"
    : "bg-background";

  return (
    <div className={`min-h-screen transition-colors duration-300 ${bgClass}`}>
      <BrandMark variant="overlay" href="/" label="홈으로" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Status Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-1.5 bg-black/60 text-white text-xs">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-400"><Wifi className="h-3 w-3" /> 온라인</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400"><WifiOff className="h-3 w-3" /> 오프라인</span>
          )}
          <span className={operationMode === "local" ? "text-amber-400" : "text-white/70"}>
            {operationMode === "local" ? "로컬 모드" : "온라인 모드"}
          </span>
        </div>
        {operationMode === "local" && (
          <span className="text-white/70">
            미전송: {unsyncedCount}건
          </span>
        )}
      </div>

      {/* Main layout */}
      <div className="min-h-screen flex flex-col md:flex-row pt-8">
        {/* Camera Area */}
        <div className="bg-gray-900/95 p-4 md:p-6 md:flex-1 md:flex md:items-center md:justify-center">
          <div className="max-w-md mx-auto md:max-w-lg w-full">
            <QRScanner onScan={handleScan} />
          </div>
        </div>

        {/* Result Area */}
        <div className="p-6 md:flex-1 md:flex md:items-center md:justify-center">
          <div className="max-w-md mx-auto w-full">
            {result && (
              <div className="flex items-center gap-4 glass rounded-2xl p-5 card-elevated animate-in fade-in duration-200">
                {result.user?.photoUrl ? (
                  <img
                    src={result.user.photoUrl}
                    alt={result.user.name}
                    className="w-18 h-18 md:w-20 md:h-20 rounded-2xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-18 h-18 md:w-20 md:h-20 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                    {result.user?.name?.charAt(0) || "?"}
                  </div>
                )}
                <div className="min-w-0">
                  {result.user?.role === "STUDENT" ? (
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white">
                      {result.user.grade}-{result.user.classNum}{" "}
                      {result.user.number}번 {result.user.name}
                    </p>
                  ) : result.user ? (
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white">
                      {result.user.name} 선생님
                    </p>
                  ) : null}

                  {result.success && (
                    <p className="text-emerald-700 dark:text-emerald-300 text-fit-sm mt-1.5 font-medium">
                      {result.user?.role === "TEACHER" && result.checkedAt
                        ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 석식 체크인 되었습니다.`
                        : "석식 체크인 되었습니다."}
                    </p>
                  )}

                  {result.duplicate && (
                    <p className="text-red-700 dark:text-red-300 text-fit-sm mt-1.5 font-semibold">
                      {result.error || "이미 체크인 되었습니다."}
                    </p>
                  )}

                  {!result.success && !result.duplicate && (
                    <p className="text-amber-800 dark:text-amber-200 text-fit-sm mt-1.5 font-medium">
                      {result.error || "인정되지 않는 QR입니다."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!result && (
              <div className="text-center text-muted-foreground">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
                <p className="text-lg font-semibold">QR 코드를 스캔해 주세요</p>
                <p className="text-sm mt-1 opacity-70">카메라에 QR 코드를 보여주세요</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sync Footer (local mode only) */}
      {operationMode === "local" && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/80 text-white text-xs px-4 py-2 flex items-center justify-between z-20">
          <div className="flex items-center gap-4">
            <span className="text-white/60">
              마지막 동기화: {lastSyncAt ? new Date(lastSyncAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음"}
            </span>
            {syncMessage && <span className="text-amber-400">{syncMessage}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearSynced}
              className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
              title="동기화된 체크인 정리"
            >
              <Trash2 className="h-3 w-3" /> 정리
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 transition-colors"
              title="전체 초기화"
            >
              <Trash2 className="h-3 w-3" /> 초기화
            </button>
            <button
              onClick={() => performSync()}
              disabled={syncing || !isOnline}
              className="flex items-center gap-1 px-3 py-1 rounded bg-blue-500/80 hover:bg-blue-500 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "동기화"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify online mode unchanged**

Run dev server. With `operationMode = "online"` in DB, visit `/check`. Scan a JWT QR. Behavior should be identical to before (server API call, result display, sounds).

- [ ] **Step 3: Verify local mode**

Change `operationMode` to `"local"` in DB. Run sync (manual button or API call). Scan a `posanmeal:*` QR. Verify:
- Status bar shows "로컬 모드" + "오프라인/온라인"
- Check-in saved to IndexedDB
- Duplicate detected on second scan
- Sync footer visible with controls

- [ ] **Step 4: Commit**

```bash
git add src/app/check/page.tsx
git commit -m "feat: check page supports local mode with IndexedDB check-in and sync"
```

---

## Task 10: Admin Page — System Settings Section

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Add system settings tab to admin page**

In `src/app/admin/page.tsx`, add the following state variables after `const [importing, setImporting] = useState(false);` (line 61):

```tsx
  // System settings
  const [sysMode, setSysMode] = useState<"online" | "local">("online");
  const [sysGeneration, setSysGeneration] = useState(1);
  const [sysLoading, setSysLoading] = useState(false);

  async function fetchSystemSettings() {
    const res = await fetch("/api/system/settings");
    const data = await res.json();
    setSysMode(data.operationMode);
    setSysGeneration(data.qrGeneration);
  }

  async function handleModeToggle() {
    const newMode = sysMode === "online" ? "local" : "online";
    const msg = newMode === "local"
      ? "로컬 모드로 전환하시겠습니까?\n학생/교사에게 고유 QR이 표시됩니다."
      : "온라인 모드로 전환하시겠습니까?\n기존 JWT 토큰 QR 방식으로 돌아갑니다.";
    if (!confirm(msg)) return;

    setSysLoading(true);
    await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationMode: newMode }),
    });
    await fetchSystemSettings();
    setSysLoading(false);
  }

  async function handleRefreshQR() {
    if (!confirm("전체 QR을 새로고침하시겠습니까?\n기존 QR코드는 모두 무효화됩니다.\n태블릿 동기화 후 적용됩니다.")) return;
    setSysLoading(true);
    await fetch("/api/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshQR: true }),
    });
    await fetchSystemSettings();
    setSysLoading(false);
  }
```

- [ ] **Step 2: Add fetchSystemSettings to useEffect**

Change the existing `useEffect` (line 76):

```tsx
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); fetchDashboard(); }, [userFilter]);
```

To:

```tsx
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); fetchDashboard(); fetchSystemSettings(); }, [userFilter]);
```

- [ ] **Step 3: Add Settings icon import and update TabsList**

Add `Settings` to the lucide-react import at line 15:

```tsx
import { LogOut, Plus, Download, Trash2, Pencil, FileSpreadsheet, ArrowLeftRight, RefreshCw, Camera, Settings } from "lucide-react";
```

Change the TabsList from `grid-cols-3` to `grid-cols-4` and add the settings tab trigger. Replace lines 227-231:

```tsx
          <TabsList className="grid w-full grid-cols-4 rounded-xl h-11 max-w-lg shrink-0">
            <TabsTrigger value="users" className="rounded-lg">사용자 관리</TabsTrigger>
            <TabsTrigger value="meals" className="rounded-lg">석식 확인</TabsTrigger>
            <TabsTrigger value="dashboard" className="rounded-lg">당일 현황</TabsTrigger>
            <TabsTrigger value="settings" className="rounded-lg">설정</TabsTrigger>
          </TabsList>
```

- [ ] **Step 4: Add settings TabsContent**

Add the settings tab content before the closing `</Tabs>` tag (before line 357):

```tsx
          <TabsContent value="settings" className="flex-1 min-h-0 mt-4 overflow-hidden">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 space-y-6">
                <div>
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Settings className="h-4 w-4" /> 시스템 설정
                  </h3>

                  {/* Operation Mode */}
                  <div className="flex items-center justify-between p-4 border rounded-xl">
                    <div>
                      <p className="font-medium">운영 모드</p>
                      <p className="text-sm text-muted-foreground">
                        {sysMode === "online"
                          ? "온라인 — JWT 토큰 QR (3분 갱신)"
                          : "로컬 — 고유 QR코드 (오프라인 체크인)"}
                      </p>
                    </div>
                    <Button
                      variant={sysMode === "local" ? "default" : "outline"}
                      size="sm"
                      onClick={handleModeToggle}
                      disabled={sysLoading}
                    >
                      {sysMode === "online" ? "로컬 모드로 전환" : "온라인 모드로 전환"}
                    </Button>
                  </div>

                  {/* QR Generation */}
                  <div className="flex items-center justify-between p-4 border rounded-xl mt-3">
                    <div>
                      <p className="font-medium">QR 세대</p>
                      <p className="text-sm text-muted-foreground">
                        현재: {sysGeneration}세대 — 새로고침 시 기존 QR 모두 무효화
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshQR}
                      disabled={sysLoading}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" /> QR 새로고침
                    </Button>
                  </div>

                  {sysMode === "local" && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-3">
                      태블릿에서 동기화를 실행해야 설정이 반영됩니다.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 5: Verify admin settings UI**

Run dev server. Log in as admin. Click "설정" tab. Verify:
- Mode toggle button works (confirm dialog appears)
- QR refresh button works (confirm dialog, generation number increases)
- Warning text shown in local mode

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat: add system settings tab to admin page for mode and QR management"
```

---

## Task 11: Final Verification & Build Check

- [ ] **Step 1: Run production build**

```bash
npm run build
```

Expected: Build succeeds with no errors. Some warnings about SW are acceptable.

- [ ] **Step 2: Test full flow**

1. Admin: Set mode to "local" via admin settings tab
2. Student: Visit student page → see fixed QR with "로컬 모드" label
3. Teacher: Visit teacher page → see fixed QR on both personal/work tabs
4. Tablet: Open `/check` → status bar shows "로컬 모드"
5. Tablet: Click "동기화" → downloads users/mealPeriods
6. Scan student QR → green approval + chime sound
7. Scan same QR again → yellow duplicate + long beep
8. Scan unknown QR → red error + double beep
9. Admin: Set mode back to "online"
10. Student/Teacher: QR reverts to JWT timer mode
11. Tablet: After sync, mode switches to online + check-ins uploaded

- [ ] **Step 3: Test offline behavior**

1. On tablet, open `/check` while online → SW caches page
2. Disconnect WiFi/network
3. Refresh `/check` → page loads from SW cache
4. Scan QR → local check-in works
5. Reconnect → auto-sync triggers after 3s

- [ ] **Step 4: Commit any fixes**

If any issues found during testing, fix and commit:
```bash
git add -A
git commit -m "fix: address issues found during offline mode testing"
```
