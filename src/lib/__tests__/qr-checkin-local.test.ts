import { beforeEach, describe, expect, it } from "vitest";
import { isLocalQR, parseLocalQR, runLocalQrCheckIn, type LocalQrRepo } from "@/lib/qr-checkin-local";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";
import { LEGACY_SNAPSHOT_STATE, type LocalSnapshotState } from "@/lib/academic-year/local-snapshot";

const OPEN = {
  breakfast: { start: "00:00", end: "00:00" },
  lunch: { start: "00:00", end: "00:00" },
  dinner: { start: "00:00", end: "23:59" },
};
const CLOSED = {
  breakfast: { start: "00:00", end: "00:00" },
  lunch: { start: "00:00", end: "00:00" },
  dinner: { start: "00:00", end: "00:00" },
};
const NOW = new Date(2026, 8, 5, 17, 30); // 로컬 2026-09-05 17:30

const STUDENT: LocalUser = { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7 };
const TEACHER: LocalUser = { id: 9, name: "박교사", role: "TEACHER" };

function makeRepo(
  users: LocalUser[],
  eligible = new Set<string>(),
  settings: Record<string, string> = {},
  snapshotState: LocalSnapshotState = LEGACY_SNAPSHOT_STATE,
) {
  const checkins: LocalCheckIn[] = [];
  const repo: LocalQrRepo = {
    getSetting: async (key) => settings[key],
    getUser: async (id) => users.find((u) => u.id === id),
    getCheckIn: async (userId, date, mealKind) =>
      checkins.find((c) => c.userId === userId && c.date === date && c.mealKind === mealKind),
    isEligible: async (userId, date, mealKind) => eligible.has(`${userId}:${date}:${mealKind}`),
    addCheckIn: async (c) => {
      checkins.push({ ...c, id: checkins.length + 1 });
    },
    getSnapshotState: async () => snapshotState,
    getDeviceId: async () => "device-1",
  };
  return { repo, checkins };
}

describe("parseLocalQR / isLocalQR", () => {
  it("4-part 카드 QR", () => {
    expect(parseLocalQR("posanmeal:12:3:STUDENT")).toEqual({ userId: 12, generation: "3", type: "STUDENT", mealKind: undefined });
  });
  it("5-part QR은 식사 종류를 실어 온다", () => {
    expect(parseLocalQR("posanmeal:12:3:STUDENT:BREAKFAST")).toMatchObject({ mealKind: "BREAKFAST" });
    expect(parseLocalQR("posanmeal:12:3:STUDENT:OTHER")).toMatchObject({ mealKind: undefined });
  });
  it("접두어·자릿수·id가 틀리면 null", () => {
    expect(parseLocalQR("eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBeNull();
    expect(parseLocalQR("posanmeal:abc:3:STUDENT")).toBeNull();
    expect(parseLocalQR("posanmeal:1:2")).toBeNull();
    expect(parseLocalQR("other:1:2:STUDENT")).toBeNull();
  });
  it("isLocalQR은 접두어만 본다", () => {
    expect(isLocalQR("posanmeal:1:2:STUDENT")).toBe(true);
    expect(isLocalQR("eyJhbGciOiJIUzI1NiJ9.x.y")).toBe(false);
  });
});

describe("runLocalQrCheckIn", () => {
  let ctx: ReturnType<typeof makeRepo>;
  beforeEach(() => {
    ctx = makeRepo([STUDENT, TEACHER], new Set(["1:2026-09-05:DINNER"]), { qrGeneration: "3" });
  });

  const run = (data: string, mealWindows = OPEN, repo: LocalQrRepo = ctx.repo) =>
    runLocalQrCheckIn({ data, now: NOW, mealWindows }, repo);

  it("JWT 등 로컬 형식이 아니면 잘못된 QR", async () => {
    expect(await run("eyJhbGciOiJIUzI1NiJ9.x.y")).toEqual({ success: false, error: "잘못된 QR코드입니다." });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("세대 불일치 → 만료 안내", async () => {
    const r = await run("posanmeal:1:2:STUDENT");
    expect(r.success).toBe(false);
    expect(r.error).toContain("만료");
  });

  it("저장된 세대가 없으면 세대 검사를 건너뛴다", async () => {
    const { repo } = makeRepo([STUDENT], new Set(["1:2026-09-05:DINNER"]));
    expect(await run("posanmeal:1:99:STUDENT", OPEN, repo)).toMatchObject({ success: true });
  });

  it("명단에 없는 사용자", async () => {
    expect(await run("posanmeal:77:3:STUDENT")).toEqual({ success: false, error: "미등록 사용자입니다." });
  });

  it("역할과 QR 유형 불일치", async () => {
    expect(await run("posanmeal:9:3:STUDENT")).toEqual({ success: false, error: "잘못된 QR 유형입니다." });
    expect(await run("posanmeal:1:3:WORK")).toEqual({ success: false, error: "잘못된 QR 유형입니다." });
  });

  it("식사 시간 아님", async () => {
    expect(await run("posanmeal:1:3:STUDENT", CLOSED)).toEqual({ success: false, error: "현재 식사 시간이 아닙니다." });
  });

  it("QR에 실린 식사 종류가 시간 창보다 우선한다", async () => {
    const { repo, checkins } = makeRepo([STUDENT], new Set(["1:2026-09-05:BREAKFAST"]), { qrGeneration: "3" });
    const r = await run("posanmeal:1:3:STUDENT:BREAKFAST", CLOSED, repo);
    expect(r).toMatchObject({ success: true, mealKind: "BREAKFAST" });
    expect(checkins[0]).toMatchObject({ mealKind: "BREAKFAST" });
  });

  it("학생 미신청 → notApplicant + 사용자 정보", async () => {
    const { repo, checkins } = makeRepo([STUDENT], new Set(), { qrGeneration: "3" });
    const r = await run("posanmeal:1:3:STUDENT", OPEN, repo);
    expect(r).toMatchObject({
      success: false,
      notApplicant: true,
      mealKind: "DINNER",
      user: { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7 },
    });
    expect(checkins).toHaveLength(0);
  });

  it("중복 → duplicate + 기존 시각", async () => {
    await run("posanmeal:1:3:STUDENT");
    const r = await run("posanmeal:1:3:STUDENT");
    expect(r).toMatchObject({ success: false, duplicate: true, mealKind: "DINNER", user: { id: 1 } });
    expect(r.checkedAt).toBe(ctx.checkins[0].checkedAt);
    expect(r.error).toContain("이미");
    expect(ctx.checkins).toHaveLength(1);
  });

  it("학생 성공 → synced:0으로 저장", async () => {
    const r = await run("posanmeal:1:3:STUDENT");
    expect(r).toMatchObject({ success: true, type: "STUDENT", mealKind: "DINNER", user: { id: 1, name: "김학생" } });
    expect(ctx.checkins[0]).toMatchObject({ userId: 1, date: "2026-09-05", mealKind: "DINNER", type: "STUDENT", synced: 0 });
    expect(r.checkedAt).toBe(ctx.checkins[0].checkedAt);
  });

  it("교사 근무 QR은 자격 검사 없이 저장", async () => {
    const r = await run("posanmeal:9:3:WORK");
    expect(r).toMatchObject({ success: true, type: "WORK", user: { id: 9, role: "TEACHER" } });
    expect(ctx.checkins[0]).toMatchObject({ userId: 9, type: "WORK", synced: 0 });
  });
});

describe("runLocalQrCheckIn — 명부 근거", () => {
  const snapshot = {
    id: "snap-1",
    version: 1,
    lastEligibilityEventId: 1,
    activeYear: 2026,
    issuedAt: "2026-09-05T00:00:00Z",
    freshUntil: "2026-09-06T00:00:00Z",
    coversUntil: "2026-09-18",
    users: [{ userId: 1, role: "STUDENT" as const, accessState: "ACTIVE" as const, accessEventId: 1 }],
    eligible: [],
    profiles: [],
  };
  const state = { snapshotMode: true, snapshot, serverActiveYear: 2026 };

  it("근거 모드가 아니면 기존과 똑같이 저장한다 (PREPARING 서버)", async () => {
    const ctx = makeRepo([STUDENT], new Set(["1:2026-09-05:DINNER"]), { qrGeneration: "3" });
    const r = await runLocalQrCheckIn({ data: "posanmeal:1:3:STUDENT", now: NOW, mealWindows: OPEN }, ctx.repo);
    expect(r.success).toBe(true);
    expect(r.stale).toBeUndefined();
    expect(ctx.checkins[0]).toMatchObject({ deviceId: "device-1" });
    expect(ctx.checkins[0].snapshotId).toBeUndefined();
  });

  it("근거 모드면 snapshotId를 함께 저장한다", async () => {
    const ctx = makeRepo([STUDENT], new Set(["1:2026-09-05:DINNER"]), { qrGeneration: "3" }, state);
    const r = await runLocalQrCheckIn(
      { data: "posanmeal:1:3:STUDENT", now: NOW, mealWindows: OPEN },
      ctx.repo,
      () => new Date("2026-09-05T08:00:00Z"),
    );
    expect(r).toMatchObject({ success: true });
    expect(ctx.checkins[0]).toMatchObject({ snapshotId: "snap-1", deviceId: "device-1" });
  });

  it("freshUntil이 지나도 저장하고 stale을 알린다", async () => {
    const ctx = makeRepo([STUDENT], new Set(["1:2026-09-05:DINNER"]), { qrGeneration: "3" }, state);
    const r = await runLocalQrCheckIn(
      { data: "posanmeal:1:3:STUDENT", now: NOW, mealWindows: OPEN },
      ctx.repo,
      () => new Date("2026-09-10T08:00:00Z"),
    );
    expect(r).toMatchObject({ success: true, stale: true });
    expect(ctx.checkins).toHaveLength(1);
    expect(ctx.checkins[0].stale).toBe(true);
  });

  it("학년도가 바뀌었으면 저장하지 않는다", async () => {
    const ctx = makeRepo([STUDENT], new Set(["1:2026-09-05:DINNER"]), { qrGeneration: "3" }, { ...state, serverActiveYear: 2027 });
    const r = await runLocalQrCheckIn(
      { data: "posanmeal:1:3:STUDENT", now: NOW, mealWindows: OPEN },
      ctx.repo,
      () => new Date("2026-09-05T08:00:00Z"),
    );
    expect(r).toMatchObject({ success: false, error: "학년도 전환 후 동기화가 필요합니다" });
    expect(ctx.checkins).toHaveLength(0);
  });
});
