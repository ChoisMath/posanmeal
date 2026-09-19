import { describe, expect, it } from "vitest";
import { runLocalQrCheckIn, type LocalQrRepo } from "@/lib/qr-checkin-local";
import { runLocalFaceCheckIn, toFaceCandidates } from "@/lib/facecheck-local";
import { LEGACY_SNAPSHOT_STATE, toLocalSnapshot, type SnapshotEvidence, type LocalSnapshotState } from "@/lib/academic-year/local-snapshot";
import { toLocalCheckInRow } from "@/components/LocalCheckInsTable";
import { buildLocalCheckInsCsv } from "@/lib/local-checkins-export";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";

const current: LocalUser = { id: 7, role: "STUDENT", name: "현재이름", grade: 2, classNum: 3, number: 4 };
const windows = { breakfast: { start: "00:00", end: "00:00" }, lunch: { start: "00:00", end: "23:59" }, dinner: { start: "00:00", end: "00:00" } };
const snapshot: SnapshotEvidence = {
  id: "early-rollover", version: 2, lastEligibilityEventId: 1, activeYear: 2027,
  issuedAt: "2027-02-20T00:00:00Z", freshUntil: "2027-02-20T15:00:00Z", coversUntil: "2027-03-05",
  users: [{ userId: 7, role: "STUDENT", accessState: "ACTIVE", accessEventId: 1 }], eligible: [],
  profiles: [
    { userId: 7, year: 2026, role: "STUDENT", name: "이전이름", grade: 1, classNum: 1, number: 1, memberState: "ENROLLED" },
    { userId: 7, year: 2027, role: "STUDENT", name: "새이름", grade: 2, classNum: 3, number: 4, memberState: "ENROLLED" },
  ],
};
function context(state: LocalSnapshotState) {
  const saved: LocalCheckIn[] = [];
  const repo: LocalQrRepo = {
    getSetting: async () => "3", getUser: async () => current, isEligible: async () => true,
    getCheckIn: async () => undefined, addCheckIn: async (row) => { saved.push({ ...row, id: 31 }); },
    getSnapshotState: async () => state, getDeviceId: async () => "fixed-device",
  };
  return { repo, saved };
}
const modes = ["QR", "FACE"] as const;
function run(mode: typeof modes[number], date: string, repo: LocalQrRepo, confirm = true) {
  const now = new Date(`${date}T03:20:42Z`);
  return mode === "QR"
    ? runLocalQrCheckIn({ data: "posanmeal:7:3:STUDENT", now, mealWindows: windows }, repo, () => now)
    : runLocalFaceCheckIn({ embedding: [1, 0], candidates: toFaceCandidates([{ userId: 7, embeddings: [[1, 0]] }]),
      faceMatch: { threshold: 0.55, margin: 0.05 }, now, mealWindows: windows,
      ...(confirm ? { confirmation: { userId: 7, date, mealKind: "LUNCH" as const } } : {}) }, repo, () => now);
}

describe.each(modes)("%s 식사일 학년도 표시", (mode) => {
  it.each([
    ["2027-02-28", "이전이름", 1, 1, 1], ["2027-03-01", "새이름", 2, 3, 4],
  ] as const)("조기 전환 후 %s의 명부를 표시하고 사본 보존", async (date, name, grade, classNum, number) => {
    const ctx = context({ snapshotMode: true, snapshot: toLocalSnapshot(snapshot), serverActiveYear: 2027 });
    const result = await run(mode, date, ctx.repo);
    expect(result).toMatchObject({ success: true, user: { id: 7, name, grade, classNum, number } });
    expect(ctx.saved[0]).toMatchObject({ userId: 7, checkedAt: `${date}T03:20:42.000Z`, snapshotId: "early-rollover", deviceId: "fixed-device",
      displayProfile: { id: 7, name, grade, classNum, number } });
    const row = toLocalCheckInRow(ctx.saved[0], { ...current, name: "다시바뀐현재", grade: 3 });
    expect(row).toMatchObject({ name, userLabel: `${grade}-${classNum}-${number}` });
    expect(await buildLocalCheckInsCsv([row]).text()).toContain(name);
  });
  it("READY 해당 연도 결측도 저장하며 현재 학급 대신 확인 필요를 표시한다", async () => {
    const ctx = context({ snapshotMode: true, snapshot: toLocalSnapshot({ ...snapshot, profiles: [snapshot.profiles[1]] }), serverActiveYear: 2027 });
    const result = await run(mode, "2027-02-28", ctx.repo);
    expect(result.success).toBe(true);
    expect(result.user).toMatchObject({ id: 7, name: "학년도 정보 확인 필요" });
    expect(result.user?.grade).toBeUndefined();
    expect(ctx.saved[0]).toMatchObject({ displayProfile: null });
    expect(toLocalCheckInRow(ctx.saved[0], current)).toMatchObject({ name: "-", userLabel: "id:7" });
  });
  it("PREPARING은 기존 User 표시를 유지하고 그 사본을 남긴다", async () => {
    const ctx = context(LEGACY_SNAPSHOT_STATE);
    expect(await run(mode, "2027-02-28", ctx.repo)).toMatchObject({ success: true, user: current });
    expect(ctx.saved[0]).toMatchObject({ displayProfile: current });
  });
});

it("얼굴 확인창도 현재 학급 대신 식사일 학급을 보여 준다", async () => {
  const ctx = context({ snapshotMode: true, snapshot: toLocalSnapshot(snapshot), serverActiveYear: 2027 });
  expect(await run("FACE", "2027-02-28", ctx.repo, false)).toMatchObject({ needConfirmation: true, user: { name: "이전이름", grade: 1, classNum: 1 } });
  expect(ctx.saved).toEqual([]);
});

it("READY 옛 기록에 보존된 표시정보가 없으면 현재 User로 메우지 않는다", () => {
  const row = toLocalCheckInRow({ id: 4, userId: 7, date: "2027-02-28", mealKind: "LUNCH", checkedAt: "2027-02-28T03:20:42Z", type: "STUDENT", synced: 0, snapshotId: "lost-old-snapshot" }, current);
  expect(row).toMatchObject({ name: "-", userLabel: "id:7" });
});
