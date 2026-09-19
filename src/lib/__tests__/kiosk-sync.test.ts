import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RAW_LEGACY_MAX_BYTES,
  performKioskSync,
  buildUploadItems,
  readKioskDownload,
  readUploadResponse,
} from "@/lib/kiosk-sync";
import {
  FORCE_RESET_PHRASE,
  LEGACY_REVIEW_REASON,
  decideResetGuard,
  upgradeLocalCheckIn,
  type StoredLocalCheckIn,
} from "@/lib/local-db";

const record = (over: Partial<StoredLocalCheckIn> = {}): StoredLocalCheckIn => ({
  id: 1,
  userId: 7,
  date: "2026-09-05",
  mealKind: "DINNER",
  checkedAt: "2026-09-05T09:00:00.000Z",
  type: "STUDENT",
  synced: 0,
  ...over,
});

describe("buildUploadItems", () => {
  it("기기 번호·근거·식사 구분을 함께 싣는다", () => {
    const items = buildUploadItems([record({ snapshotId: "snap-1" })], "device-1");
    expect(items).toEqual([
      {
        clientId: 1,
        deviceId: "device-1",
        userId: 7,
        date: "2026-09-05",
        checkedAt: "2026-09-05T09:00:00.000Z",
        type: "STUDENT",
        mealKind: "DINNER",
        snapshotId: "snap-1",
      },
    ]);
  });

  it("식사 구분이 없는 옛 기록도 그대로 보낸다 (지어내지 않는다)", () => {
    const [item] = buildUploadItems([record({ mealKind: undefined, rawLegacy: { synced: false } })], "device-1");
    expect(item.mealKind).toBeUndefined();
    expect(item.rawLegacy).toEqual({ synced: false });
  });

  it("원본이 8KB를 넘으면 묶음을 실패시키지 않고 표시만 보낸다", () => {
    const huge = { note: "가".repeat(RAW_LEGACY_MAX_BYTES) };
    const [item] = buildUploadItems([record({ rawLegacy: huge })], "device-1");
    expect(item.rawLegacy).toEqual({ truncated: true, reason: "원본이 너무 큽니다." });
  });

  it("id 없는 기록은 보내지 않는다 (서버가 결과를 돌려줄 번호가 없다)", () => {
    expect(buildUploadItems([record({ id: undefined })], "device-1")).toEqual([]);
  });
});

describe("readUploadResponse", () => {
  it("final:true만 정리하고 REVIEW는 사유와 함께 남긴다", () => {
    const outcome = readUploadResponse({
      acceptedCount: 1,
      duplicatesCount: 1,
      rejectedCount: 1,
      reviewCount: 1,
      syncedClientIds: [1, 2],
      rejected: [{ clientId: 4, userId: 7, date: "2026-09-05", mealKind: null, reason: "SERVER_ERROR" }],
      decisions: [
        { clientId: 1, status: "ACCEPTED", final: true },
        { clientId: 2, status: "DUPLICATE", final: true },
        { clientId: 3, status: "REVIEW", final: false, reviewId: "rev-3", reason: "당시 명부 근거가 없습니다." },
        { clientId: 5, status: "REJECTED", final: true, reason: "USER_NOT_FOUND" },
      ],
    });
    expect(outcome.ack.finalIds.sort()).toEqual([1, 2, 5]);
    expect(outcome.ack.review).toEqual([{ clientId: 3, reviewId: "rev-3", reason: "당시 명부 근거가 없습니다." }]);
    expect(outcome.ack.rejected).toEqual([{ clientId: 4, reason: "SERVER_ERROR" }]);
    expect(outcome.counts).toEqual({ accepted: 1, duplicate: 1, review: 1, rejected: 1 });
  });

  it("decisions 없는 옛 응답(PREPARING)은 syncedClientIds와 집계만 쓴다", () => {
    const outcome = readUploadResponse({
      acceptedCount: 2,
      duplicatesCount: 1,
      rejectedCount: 0,
      syncedClientIds: [1, 2, 3],
    });
    expect(outcome.ack.finalIds).toEqual([1, 2, 3]);
    expect(outcome.ack.review).toEqual([]);
    expect(outcome.counts).toEqual({ accepted: 2, duplicate: 1, review: 0, rejected: 0 });
  });

  it("clientId 없는 거절은 로컬에서 표시할 수 없으므로 건너뛴다", () => {
    const outcome = readUploadResponse({ rejected: [{ clientId: null, reason: "NO_CLIENT_ID" }] });
    expect(outcome.ack.rejected).toEqual([]);
  });
});

describe("readKioskDownload", () => {
  it("snapshot이 없는 응답(PREPARING)은 근거 없음으로 읽는다", () => {
    const download = readKioskDownload({ operationMode: "local", users: [{ id: 1 }], qrGeneration: 3 });
    expect(download.snapshot).toBeNull();
    expect(download.operationMode).toBe("local");
    expect(download.qrGeneration).toBe(3);
  });

  it("snapshot이 있으면 그대로 싣는다", () => {
    const snapshot = { id: "snap-1", activeYear: 2026, freshUntil: "2026-09-06T00:00:00Z" };
    expect(readKioskDownload({ snapshot }).snapshot).toMatchObject({ id: "snap-1" });
  });
});

describe("upgradeLocalCheckIn", () => {
  it("전송된 기록은 synced만 정규화한다", () => {
    expect(upgradeLocalCheckIn({ id: 1, userId: 7, synced: true })).toEqual({ id: 1, userId: 7, synced: 1 });
  });

  it("근거 없는 미전송 기록은 원본과 검토 사유를 남긴다", () => {
    const original = { id: 2, userId: 7, date: "2026-09-05", checkedAt: "x", type: "STUDENT", synced: false };
    const upgraded = upgradeLocalCheckIn(original);
    expect(upgraded).toMatchObject({ id: 2, synced: 0, reviewReason: LEGACY_REVIEW_REASON });
    expect(upgraded.rawLegacy).toEqual({ ...original });
    expect(upgraded.mealKind).toBeUndefined();
  });

  it("근거가 있는 미전송 기록에는 검토 사유를 붙이지 않는다", () => {
    const upgraded = upgradeLocalCheckIn({ id: 3, synced: 0, snapshotId: "snap-1" });
    expect(upgraded).toEqual({ id: 3, synced: 0, snapshotId: "snap-1" });
  });

  it("키·시각·mealKind를 보존한다", () => {
    const original = { id: 9, userId: 7, date: "2026-09-05", mealKind: "BREAKFAST", checkedAt: "2026-09-05T00:00:00Z", synced: 0 };
    expect(upgradeLocalCheckIn(original)).toMatchObject({ id: 9, checkedAt: "2026-09-05T00:00:00Z", mealKind: "BREAKFAST" });
  });
});

describe("decideResetGuard", () => {
  it("남은 기록이 없으면 그대로 초기화", () => {
    expect(decideResetGuard({ unsynced: 0, review: 0 })).toBe("ALLOWED");
  });

  it("미전송·확인 대기가 있으면 강제 경로를 거친다", () => {
    expect(decideResetGuard({ unsynced: 2, review: 0 })).toBe("NEEDS_FORCED");
    expect(decideResetGuard({ unsynced: 0, review: 1 })).toBe("NEEDS_FORCED");
  });

  it("확인 문구는 '초기화'다", () => {
    expect(FORCE_RESET_PHRASE).toBe("초기화");
  });
});

// --- performKioskSync (IDB·fetch를 대역으로) ---

const dbState = {
  unsynced: [] as StoredLocalCheckIn[],
  acks: [] as unknown[],
  deviceIdCalls: 0,
  stores: {} as Record<string, Array<{ op: string; value?: unknown; key?: unknown }>>,
};

vi.mock("@/lib/local-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-db")>();
  return {
    ...actual,
    getUnsyncedCheckIns: async () => dbState.unsynced,
    getDeviceId: async () => {
      dbState.deviceIdCalls += 1;
      return "device-fixed";
    },
    applyCheckInAcknowledgement: async (ack: unknown) => {
      dbState.acks.push(ack);
    },
    getSetting: async () => undefined,
    setSetting: async () => {},
    setServerActiveYear: async () => {},
    clearFaceProfiles: async () => {},
    openDB: async () => fakeDb as unknown as IDBDatabase,
  };
});

const fakeDb = {
  transaction(names: string[]) {
    const tx: Record<string, unknown> = {
      objectStore(name: string) {
        const log = (dbState.stores[name] ??= []);
        return {
          clear: () => log.push({ op: "clear" }),
          put: (value: unknown, key?: unknown) => log.push({ op: "put", value, key }),
          delete: (key: unknown) => log.push({ op: "delete", key }),
        };
      },
      names,
    };
    setTimeout(() => (tx.oncomplete as (() => void) | undefined)?.(), 0);
    return tx;
  },
};

function mockFetch(handlers: Record<string, { status: number; body?: unknown }>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = url.startsWith("/api/sync/upload") ? "upload" : "download";
    const handler = handlers[key] ?? { status: 500 };
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      json: async () => handler.body ?? {},
    } as unknown as Response;
  });
}

describe("performKioskSync", () => {
  beforeEach(() => {
    dbState.unsynced = [];
    dbState.acks = [];
    dbState.deviceIdCalls = 0;
    dbState.stores = {};
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("업로드가 성공하면 내려받기가 실패해도 업로드 결과를 알린다", async () => {
    dbState.unsynced = [record({ id: 1 }), record({ id: 2 })];
    mockFetch({
      upload: {
        status: 200,
        body: {
          syncedClientIds: [1],
          decisions: [
            { clientId: 1, status: "ACCEPTED", final: true },
            { clientId: 2, status: "REVIEW", final: false, reviewId: "rev-2", reason: "당시 명부 근거가 없습니다." },
          ],
        },
      },
      download: { status: 500 },
    });

    const outcome = await performKioskSync();
    expect(outcome.ok).toBe(false);
    expect(outcome.uploaded).toBe(true);
    expect(outcome.acceptedCount).toBe(1);
    expect(outcome.reviewCount).toBe(1);
    expect(outcome.message).toContain("업로드 1건 반영");
    expect(outcome.message).toContain("확인 대기 1건");
    expect(outcome.message).toContain("다운로드 실패");
    expect(dbState.acks).toHaveLength(1);
  });

  it("내려받은 근거를 settings에 남기고 freshUntil을 돌려준다", async () => {
    mockFetch({
      download: {
        status: 200,
        body: {
          operationMode: "local",
          users: [{ id: 1 }],
          eligibleEntries: [],
          faceProfiles: [],
          snapshot: { id: "snap-1", activeYear: 2026, freshUntil: "2026-09-06T00:00:00Z" },
        },
      },
    });

    const outcome = await performKioskSync();
    expect(outcome.ok).toBe(true);
    expect(outcome.freshUntil).toBe("2026-09-06T00:00:00Z");
    expect(dbState.stores.settings).toContainEqual({ op: "put", value: "1", key: "snapshotMode" });
    expect(dbState.stores.checkins).toBeUndefined();
  });

  it("근거 없는 응답(PREPARING)은 근거 모드를 끄고 저장된 근거를 지운다", async () => {
    mockFetch({ download: { status: 200, body: { operationMode: "local", users: [], eligibleEntries: [] } } });
    const outcome = await performKioskSync();
    expect(outcome.ok).toBe(true);
    expect(outcome.freshUntil).toBeUndefined();
    expect(dbState.stores.settings).toContainEqual({ op: "put", value: "0", key: "snapshotMode" });
    expect(dbState.stores.settings).toContainEqual({ op: "delete", key: "snapshot" });
  });

  it("기기 번호는 재동기화로 바뀌지 않는다", async () => {
    dbState.unsynced = [record({ id: 1 })];
    mockFetch({
      upload: { status: 200, body: { syncedClientIds: [1] } },
      download: { status: 200, body: { operationMode: "online", users: [], eligibleEntries: [] } },
    });
    await performKioskSync();
    await performKioskSync();
    expect(dbState.deviceIdCalls).toBe(2);
    expect(new Set(dbState.acks.map(() => "device-fixed")).size).toBe(1);
  });
});

describe("v6 upgrade handler (원본 코드 검사)", () => {
  it("checkins store를 지우거나 비우는 호출이 없다", async () => {
    const source = await readFile(new URL("../local-db.ts", import.meta.url), "utf8");
    const upgrade = source.slice(source.indexOf("request.onupgradeneeded"), source.indexOf("request.onsuccess"));
    expect(upgrade).not.toMatch(/deleteObjectStore\(\s*["']checkins["']\s*\)/);
    expect(upgrade).not.toMatch(/objectStore\(\s*["']checkins["']\s*\)\.clear\(/);
    expect(upgrade).toContain("upgradeLocalCheckIn");
  });
});

describe("performKioskSync — 시계 차이", () => {
  beforeEach(() => {
    dbState.unsynced = [];
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("서버 시각과 30분 넘게 차이 나면 경고를 덧붙인다", async () => {
    mockFetch({
      download: {
        status: 200,
        body: {
          operationMode: "online",
          users: [],
          eligibleEntries: [],
          serverTime: new Date(Date.now() + 61 * 60 * 1000).toISOString(),
        },
      },
    });
    const outcome = await performKioskSync();
    expect(outcome.message).toContain("태블릿 시계를 확인하세요");
  });
});
