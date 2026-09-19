import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDateKey, runLocalFaceCheckIn, toFaceCandidates, type LocalFaceRepo } from "@/lib/facecheck-local";
import type { LocalCheckIn, LocalUser } from "@/lib/local-db";

const WINDOWS = {
  breakfast: { start: "00:00", end: "00:00" },
  lunch: { start: "00:00", end: "00:00" },
  dinner: { start: "00:00", end: "23:59" },
};
const CLOSED = {
  breakfast: { start: "00:00", end: "00:00" },
  lunch: { start: "00:00", end: "00:00" },
  dinner: { start: "00:00", end: "00:00" },
};
const FACE_MATCH = { threshold: 0.55, margin: 0.05 };
const NOW = new Date("2026-09-05T08:30:00Z");
const confirmation = { userId: 1, mealKind: "DINNER" as const, date: "2026-09-05" };

const axis = (i: number) => Array.from({ length: 4 }, (_, k) => (k === i ? 1 : 0));
const CANDIDATES = toFaceCandidates([
  { userId: 1, embeddings: [axis(0)] },
  { userId: 9, embeddings: [axis(1)] },
]);

function makeRepo(users: LocalUser[], eligible = new Set<string>()) {
  const checkins: LocalCheckIn[] = [];
  const repo: LocalFaceRepo = {
    getUser: async (id) => users.find((u) => u.id === id),
    getCheckIn: async (userId, date, mealKind) =>
      checkins.find((c) => c.userId === userId && c.date === date && c.mealKind === mealKind),
    isEligible: async (userId, date, mealKind) => eligible.has(`${userId}:${date}:${mealKind}`),
    addCheckIn: async (c) => {
      checkins.push({ ...c, id: checkins.length + 1 });
    },
  };
  return { repo, checkins };
}

const STUDENT: LocalUser = { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7 };
const TEACHER: LocalUser = { id: 9, name: "박교사", role: "TEACHER" };

describe("localDateKey", () => {
  it("UTC 자정 전에도 KST 다음날 사용", () => expect(localDateKey(new Date("2026-09-04T16:00:00Z"))).toBe("2026-09-05"));
  it("KST 날짜를 YYYY-MM-DD로", () => expect(localDateKey(NOW)).toBe("2026-09-05"));
});

describe("runLocalFaceCheckIn", () => {
  let ctx: ReturnType<typeof makeRepo>;
  beforeEach(() => {
    ctx = makeRepo([STUDENT, TEACHER], new Set(["1:2026-09-05:DINNER"]));
  });

  it("식사 시간 아님 → NO_MEAL_WINDOW", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: CLOSED },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: false, errorCode: "NO_MEAL_WINDOW" });
  });

  it("기기 타임존과 무관하게 KST 식사 시간·날짜 사용", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: new Date("2026-09-04T23:30:00Z"),
      mealWindows: { ...CLOSED, breakfast: { start: "08:00", end: "09:00" } } }, ctx.repo);
    expect(r).toMatchObject({ needConfirmation: true, date: "2026-09-05", mealKind: "BREAKFAST" });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("미매칭 → matched:false, 저장 없음", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(3), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: false, matched: false, errorCode: "UNMATCHED" });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("학생 정상 → 저장(synced:0, STUDENT) + success", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation },
      ctx.repo,
    );
    expect(r).toMatchObject({
      success: true, matched: true, type: "STUDENT", mealKind: "DINNER", user: { id: 1, name: "김학생" },
    });
    expect(ctx.checkins[0]).toMatchObject({ userId: 1, date: "2026-09-05", mealKind: "DINNER", type: "STUDENT", synced: 0 });
    expect(r.similarity).toBeCloseTo(1);
    expect(r.runnerUp).toBeCloseTo(0);
  });

  it("학생 두 번째 → duplicate (서버와 같은 문구)", async () => {
    const input = { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation };
    await runLocalFaceCheckIn(input, ctx.repo);
    const r = await runLocalFaceCheckIn(input, ctx.repo);
    expect(r).toMatchObject({ success: false, duplicate: true, error: "이미 석식 체크인 하였습니다." });
    expect(r.checkedAt).toBeDefined();
    expect(ctx.checkins).toHaveLength(1);
  });

  it("학생 미신청 → notApplicant + 문구", async () => {
    const noEligible = makeRepo([STUDENT]);
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation },
      noEligible.repo,
    );
    expect(r).toMatchObject({ success: false, matched: true, notApplicant: true, error: "오늘 석식 신청자가 아닙니다." });
    expect(noEligible.checkins).toHaveLength(0);
  });

  it("교사 type 없음 → needType, 저장 없음", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(1), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: false, matched: true, needType: true, user: { id: 9 }, mealKind: "DINNER" });
    expect(ctx.checkins).toHaveLength(0);
  });

  it.each(["WORK", "PERSONAL"] as const)("교사 확인 + type=%s → 저장 + success", async (type) => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(1), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation: { ...confirmation, userId: 9 }, type },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: true, type });
    expect(ctx.checkins[0]).toMatchObject({ userId: 9, type, synced: 0 });
  });

  it.each([STUDENT, TEACHER])("$role 미확인 후보는 type만 보내도 조회·저장하지 않음", async (user) => {
    const getCheckIn = vi.spyOn(ctx.repo, "getCheckIn");
    const isEligible = vi.spyOn(ctx.repo, "isEligible");
    const r = await runLocalFaceCheckIn({ embedding: axis(user.id === 1 ? 0 : 1), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, type: "WORK" }, ctx.repo);
    expect(r).toMatchObject({ success: false, needConfirmation: true, needType: user.role === "TEACHER",
      user: { id: user.id }, date: "2026-09-05", mealKind: "DINNER" });
    expect(getCheckIn).not.toHaveBeenCalled();
    expect(isEligible).not.toHaveBeenCalled();
    expect(ctx.checkins).toHaveLength(0);
  });

  it.each([
    { ...confirmation, userId: 9 },
    { ...confirmation, date: "2026-09-04" },
    { ...confirmation, mealKind: "LUNCH" as const },
  ])("확인 대상 변경 시 저장 거부: %j", async (changed) => {
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation: changed }, ctx.repo);
    expect(r).toMatchObject({ success: false, errorCode: "CONFIRMATION_CHANGED" });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("교사 확인에 type 없으면 다시 선택 요구", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(1), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation: { ...confirmation, userId: 9 } }, ctx.repo);
    expect(r).toMatchObject({ success: false, needConfirmation: true, needType: true });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("학생에게 type을 보내도 STUDENT로 저장", async () => {
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation, type: "PERSONAL" }, ctx.repo);
    expect(r).toMatchObject({ success: true, type: "STUDENT" });
    expect(ctx.checkins[0].type).toBe("STUDENT");
  });

  it("학생·교사 외 역할은 확인 요청이 있어도 저장 거부", async () => {
    const invalid = makeRepo([{ ...STUDENT, role: "ADMIN" } as unknown as LocalUser]);
    const r = await runLocalFaceCheckIn({ embedding: axis(0), candidates: CANDIDATES,
      faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, confirmation }, invalid.repo);
    expect(r).toMatchObject({ success: false, errorCode: "ROLE_NOT_ALLOWED" });
    expect(invalid.checkins).toHaveLength(0);
  });

  it("명단에 없는 매칭 → matched:false + 동기화 안내", async () => {
    const empty = makeRepo([]);
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
      empty.repo,
    );
    expect(r).toMatchObject({ success: false, matched: false });
    expect(r.error).toContain("동기화");
  });
});
