import { beforeEach, describe, expect, it } from "vitest";
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
const NOW = new Date(2026, 8, 5, 17, 30); // 로컬 2026-09-05 17:30

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
  it("기기 로컬 날짜를 YYYY-MM-DD로", () => expect(localDateKey(NOW)).toBe("2026-09-05"));
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

  it("미매칭 → matched:false, 저장 없음", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(3), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: false, matched: false });
    expect(ctx.checkins).toHaveLength(0);
  });

  it("학생 정상 → 저장(synced:0, STUDENT) + success", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
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
    const input = { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS };
    await runLocalFaceCheckIn(input, ctx.repo);
    const r = await runLocalFaceCheckIn(input, ctx.repo);
    expect(r).toMatchObject({ success: false, duplicate: true, error: "이미 석식 체크인 하였습니다." });
    expect(r.checkedAt).toBeDefined();
    expect(ctx.checkins).toHaveLength(1);
  });

  it("학생 미신청 → notApplicant + 문구", async () => {
    const noEligible = makeRepo([STUDENT]);
    const r = await runLocalFaceCheckIn(
      { embedding: axis(0), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS },
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

  it("교사 type=WORK → 저장 + success", async () => {
    const r = await runLocalFaceCheckIn(
      { embedding: axis(1), candidates: CANDIDATES, faceMatch: FACE_MATCH, now: NOW, mealWindows: WINDOWS, type: "WORK" },
      ctx.repo,
    );
    expect(r).toMatchObject({ success: true, type: "WORK" });
    expect(ctx.checkins[0]).toMatchObject({ userId: 9, type: "WORK", synced: 0 });
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
