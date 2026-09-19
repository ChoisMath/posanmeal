import { describe, expect, it } from "vitest";
import {
  LocalSnapshotError,
  checkLocalSnapshot,
  createSnapshotStateCache,
  guardLocalCheckIn,
  isSnapshotMode,
  isSnapshotStale,
  toLocalSnapshot,
  type LocalSnapshotState,
  type SnapshotEvidence,
} from "@/lib/academic-year/local-snapshot";

const snapshot: SnapshotEvidence = {
  id: "snapshot",
  version: 1,
  lastEligibilityEventId: 1,
  activeYear: 2026,
  issuedAt: "2027-02-28T00:00:00Z",
  freshUntil: "2027-02-28T15:00:00Z",
  coversUntil: "2027-03-13",
  users: [{ userId: 7, role: "STUDENT", accessState: "ACTIVE", accessEventId: 1 }],
  eligible: [{ userId: 7, applicationId: 1, registrationId: 1, date: "2027-02-28", mealKind: "DINNER" }],
  profiles: [],
};

const local = toLocalSnapshot(snapshot);

const at = (iso: string, extra: Record<string, unknown> = {}) => ({
  now: new Date(iso),
  userId: 7,
  dateKey: "2027-02-28",
  serverActiveYear: 2026 as number | null,
  ...extra,
});

describe("checkLocalSnapshot", () => {
  it("freshUntil 이전은 FRESH", () => {
    expect(checkLocalSnapshot(local, at("2027-02-28T14:59:59Z"))).toBe("FRESH");
  });

  it("freshUntil 이후는 STALE — 저장은 허용된다", () => {
    expect(checkLocalSnapshot(local, at("2027-02-28T15:00:00Z", { dateKey: "2027-03-01" }))).toBe("STALE");
  });

  it("운영 학년도를 모르면(오프라인) 연도 검사 없이 STALE", () => {
    expect(
      checkLocalSnapshot(local, at("2027-02-28T15:00:00Z", { dateKey: "2027-03-01", serverActiveYear: null })),
    ).toBe("STALE");
  });

  it("운영 학년도가 바뀌었으면 throw", () => {
    expect(() => checkLocalSnapshot(local, at("2027-03-02T00:00:00Z", { serverActiveYear: 2027 }))).toThrow(
      LocalSnapshotError,
    );
    try {
      checkLocalSnapshot(local, at("2027-03-02T00:00:00Z", { serverActiveYear: 2027 }));
    } catch (error) {
      expect((error as LocalSnapshotError).code).toBe("YEAR_MISMATCH");
      expect((error as LocalSnapshotError).message).toBe("학년도 전환 후 동기화가 필요합니다");
    }
  });

  it("근거가 덮는 기간을 벗어난 날짜는 throw", () => {
    expect(() => checkLocalSnapshot(local, at("2027-03-20T00:00:00Z", { dateKey: "2027-03-20" }))).toThrow(
      LocalSnapshotError,
    );
  });

  it("coversUntil 당일은 저장 가능", () => {
    expect(checkLocalSnapshot(local, at("2027-03-13T01:00:00Z", { dateKey: "2027-03-13" }))).toBe("STALE");
  });

  it("근거가 없으면 throw", () => {
    expect(() => checkLocalSnapshot(null, at("2027-02-28T10:00:00Z"))).toThrow(LocalSnapshotError);
  });

  it("명단에 없는 사용자는 throw", () => {
    expect(() => checkLocalSnapshot(local, at("2027-02-28T10:00:00Z", { userId: 99 }))).toThrow(LocalSnapshotError);
  });
});

describe("isSnapshotMode / guardLocalCheckIn", () => {
  const legacy: LocalSnapshotState = { snapshotMode: false, snapshot: null, serverActiveYear: null };
  const ready: LocalSnapshotState = { snapshotMode: true, snapshot: local, serverActiveYear: 2026 };

  it("근거를 받은 적이 없는 기기는 근거 모드가 아니다", () => {
    expect(isSnapshotMode(legacy)).toBe(false);
    expect(isSnapshotMode(ready)).toBe(true);
  });

  it("근거 모드가 아니면 판정하지 않고 null (PREPARING 서버 = 기존 동작)", () => {
    expect(guardLocalCheckIn(legacy, { now: new Date("2030-01-01T00:00:00Z"), userId: 99, dateKey: "2030-01-01" })).toBeNull();
  });

  it("근거 모드면 판정한다", () => {
    expect(guardLocalCheckIn(ready, { now: new Date("2027-02-28T10:00:00Z"), userId: 7, dateKey: "2027-02-28" })).toBe("FRESH");
    expect(() =>
      guardLocalCheckIn({ ...ready, snapshot: null }, { now: new Date("2027-02-28T10:00:00Z"), userId: 7, dateKey: "2027-02-28" }),
    ).toThrow(LocalSnapshotError);
  });
});

describe("createSnapshotStateCache", () => {
  it("같은 근거가 유지되는 동안 저장소를 다시 읽지 않는다", async () => {
    let loads = 0;
    const cache = createSnapshotStateCache(async () => {
      loads += 1;
      return { snapshotMode: true, snapshot: local, serverActiveYear: 2026 };
    });
    const first = await cache.get();
    const second = await cache.get();
    expect(loads).toBe(1);
    expect(second).toBe(first);
    expect(second.snapshot?.header.id).toBe("snapshot");
  });

  it("동시 호출도 한 번만 읽는다", async () => {
    let loads = 0;
    const cache = createSnapshotStateCache(async () => {
      loads += 1;
      return { snapshotMode: true, snapshot: local, serverActiveYear: 2026 };
    });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(loads).toBe(1);
  });

  it("근거가 바뀌면(동기화·초기화) 다시 읽는다", async () => {
    let loads = 0;
    const cache = createSnapshotStateCache(async () => {
      loads += 1;
      return { snapshotMode: false, snapshot: null, serverActiveYear: null };
    });
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(loads).toBe(2);
  });
});

describe("isSnapshotStale", () => {
  it("근거가 없으면 오래됨이 아니다 (PREPARING 기기)", () => {
    expect(isSnapshotStale(null, new Date("2099-01-01T00:00:00Z"))).toBe(false);
  });

  it("freshUntil을 기준으로 화면 표시와 판정이 같은 답을 낸다", () => {
    expect(isSnapshotStale(local.header, new Date("2027-02-28T14:59:59Z"))).toBe(false);
    expect(isSnapshotStale(local.header, new Date("2027-02-28T15:00:00Z"))).toBe(true);
  });
});

describe("명단 소속 확인", () => {
  it("Set으로 O(1) 확인한다", () => {
    expect(local.members.has(7)).toBe(true);
    expect(local.members.has(8)).toBe(false);
  });
});
