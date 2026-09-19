import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";
import { invalidateRosterModeCache } from "@/lib/academic-year/roster-mode-cache";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  recordFindFirst: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInCreate: vi.fn(),
  mealDateFindFirst: vi.fn(),
  getFaceCandidates: vi.fn(),
  getCachedSettings: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: { findUnique: mocks.userFindUnique },
    userAcademicRecord: { findFirst: mocks.recordFindFirst },
    checkIn: { findFirst: mocks.checkInFindFirst, create: mocks.checkInCreate },
    mealRegistrationMealDate: { findFirst: mocks.mealDateFindFirst },
    $queryRaw: () => Promise.resolve([{ mode: "PREPARING" }]),
    $transaction: (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/face-embedding-cache", () => ({
  getFaceCandidates: mocks.getFaceCandidates,
}));
vi.mock("@/lib/settings-cache", () => ({
  getCachedSettings: mocks.getCachedSettings,
}));
// 축 0 단위벡터 — 등록 임베딩과 요청 임베딩을 동일하게 두어 유사도 1
const emb = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

const STUDENT = {
  id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7,
  photoUrl: null, accessState: "ACTIVE",
};
const confirmation = { userId: 1, mealKind: "DINNER", date: "2026-09-02" };
const TEACHER = {
  id: 9, name: "박교사", role: "TEACHER", grade: null, classNum: null, number: null,
  photoUrl: null, accessState: "ACTIVE",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/facecheck", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kiosk-key": "test-key", ...headers },
    body: JSON.stringify(body),
  });
}

// 항상 열려있는 석식 윈도우 → resolveMealKind가 DINNER 반환
const OPEN_SETTINGS = {
  mealWindows: {
    breakfast: { start: "00:00", end: "00:00" },
    lunch: { start: "00:00", end: "00:00" },
    dinner: { start: "00:00", end: "23:59" },
  },
  faceMatch: { threshold: 0.55, margin: 0.05 },
};

describe("/api/facecheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidateRosterModeCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00Z"));
    process.env.FACECHECK_KIOSK_KEY = "test-key";
    mocks.getCachedSettings.mockResolvedValue(OPEN_SETTINGS);
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 1, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.checkInFindFirst.mockResolvedValue(null);
    mocks.recordFindFirst.mockResolvedValue(null);
    mocks.mealDateFindFirst.mockResolvedValue({ registrationId: 1 });
    mocks.checkInCreate.mockResolvedValue({ checkedAt: new Date("2026-09-02T09:00:00Z") });
  });

  afterEach(() => vi.useRealTimers());

  it("잘못된 바디 400", async () => {
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: [1, 2, 3] }));
    expect(res.status).toBe(400);
  });

  it("식사 시간 아님 → NO_MEAL_WINDOW", async () => {
    mocks.getCachedSettings.mockResolvedValue({
      ...OPEN_SETTINGS,
      mealWindows: {
        breakfast: { start: "00:00", end: "00:00" },
        lunch: { start: "00:00", end: "00:00" },
        dinner: { start: "00:00", end: "00:00" },
      },
    });
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: emb }));
    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe("NO_MEAL_WINDOW");
  });

  it("매칭 실패 → matched:false, 체크인 없음", async () => {
    mocks.getFaceCandidates.mockResolvedValue([]);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.matched).toBe(false);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("응답에 1·2위 유사도(similarity/runnerUp) 포함 — 미매칭도 동일", async () => {
    const axis1 = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 1 ? 1 : 0));
    const axis2 = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 2 ? 1 : 0));
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 1, embeddings: [Float32Array.from(emb)] },
      { userId: 9, embeddings: [Float32Array.from(axis1)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const matched = await (await POST(request({ embedding: emb }))).json();
    expect(matched.needConfirmation).toBe(true);
    expect(matched.similarity).toBeCloseTo(1);
    expect(matched.runnerUp).toBeCloseTo(0);

    const unmatched = await (await POST(request({ embedding: axis2 }))).json();
    expect(unmatched.matched).toBe(false);
    expect(unmatched.errorCode).toBe("UNMATCHED");
    expect(unmatched.similarity).toBeCloseTo(0);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("학생 확인 → source FACE, type STUDENT로 체크인", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, type: "STUDENT", source: "FACE" }),
      }),
    );
  });

  it("학생 미자격 → notApplicant, 체크인 없음", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.mealDateFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation }))).json();
    expect(body.notApplicant).toBe(true);
    expect(body.error).toBe("오늘 석식 신청자가 아닙니다.");
    expect(body.user.name).toBe("김학생");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("중복 → duplicate 응답", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.checkInFindFirst.mockResolvedValue({ checkedAt: new Date() });
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation }))).json();
    expect(body.duplicate).toBe(true);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("교사 + type 미지정 → needType, 체크인 없음", async () => {
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 9, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.needType).toBe(true);
    expect(body.user.name).toBe("박교사");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it.each(["WORK", "PERSONAL"])("교사 확인 + type %s → 선택한 유형으로 체크인", async (type) => {
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 9, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, type, confirmation: { ...confirmation, userId: 9 } }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 9, type, source: "FACE" }),
      }),
    );
  });

  it("학생에게 type이 와도 STUDENT로 저장", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    await POST(request({ embedding: emb, type: "WORK", confirmation }));
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "STUDENT" }) }),
    );
  });

  it("P2002 레이스 → duplicate 응답에 user·mealKind·checkedAt 포함", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    // 첫 번째 checkInFindFirst: null (중복 아님)
    // checkInCreate: P2002 reject
    // 두 번째 checkInFindFirst: 레이스 checkin 반환
    mocks.checkInFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ checkedAt: new Date("2026-09-02T11:30:00Z") });
    mocks.checkInCreate.mockRejectedValueOnce({ code: "P2002" });

    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation }))).json();

    expect(body.success).toBe(false);
    expect(body.matched).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(body.user.name).toBe("김학생");
    expect(body.mealKind).toBe("DINNER");
    expect(body.checkedAt).toBeDefined();
  });

  it.each([STUDENT, TEACHER])("$role 후보는 type만 보내도 저장과 자격 조회 없이 확인 요구", async (user) => {
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.getFaceCandidates.mockResolvedValue([{ userId: user.id, embeddings: [Float32Array.from(emb)] }]);
    mocks.checkInFindFirst.mockResolvedValue({ checkedAt: new Date() });
    mocks.mealDateFindFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, type: "WORK" }))).json();
    expect(body).toMatchObject({ success: false, matched: true, needConfirmation: true,
      needType: user.role === "TEACHER", user: { id: user.id }, mealKind: "DINNER", date: "2026-09-02" });
    expect(mocks.checkInFindFirst).not.toHaveBeenCalled();
    expect(mocks.mealDateFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it.each([
    { ...confirmation, userId: 9 },
    { ...confirmation, date: "2026-09-01" },
    { ...confirmation, mealKind: "LUNCH" },
  ])("확인 대상 또는 날짜·식사 변경 시 저장 거부: %j", async (changed) => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation: changed }))).json();
    expect(body).toMatchObject({ success: false, errorCode: "CONFIRMATION_CHANGED" });
    expect(mocks.checkInFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("교사 확인에 type 없으면 저장 없이 다시 선택 요구", async () => {
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    mocks.getFaceCandidates.mockResolvedValue([{ userId: 9, embeddings: [Float32Array.from(emb)] }]);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation: { ...confirmation, userId: 9 } }))).json();
    expect(body).toMatchObject({ needConfirmation: true, needType: true });
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("학생·교사 외 역할은 확인 요청이 있어도 저장 거부", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...STUDENT, role: "ADMIN" });
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, confirmation }))).json();
    expect(body).toMatchObject({ success: false, errorCode: "ROLE_NOT_ALLOWED" });
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("이용이 중지된 계정은 매칭 단계에서 저장 없이 거절한다", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...STUDENT, accessState: "INACTIVE" });
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: emb }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ success: false, errorCode: "ACCOUNT_INACTIVE" });
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("확인 요청 뒤 저장 직전에 이용이 중지되면 저장하지 않는다", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(STUDENT)
      .mockResolvedValueOnce({ ...STUDENT, accessState: "INACTIVE" });
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: emb, confirmation }));

    expect(res.status).toBe(403);
    expect((await res.json()).errorCode).toBe("ACCOUNT_INACTIVE");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("키오스크 키 헤더 없음 → 401 KIOSK_UNAUTHORIZED", async () => {
    const { POST } = await import("@/app/api/facecheck/route");
    const res = await POST(request({ embedding: emb }, { "x-kiosk-key": "" }));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.errorCode).toBe("KIOSK_UNAUTHORIZED");
  });

  it("FACECHECK_KIOSK_KEY 미설정 → 503 KIOSK_KEY_UNSET", async () => {
    const original = process.env.FACECHECK_KIOSK_KEY;
    delete process.env.FACECHECK_KIOSK_KEY;
    try {
      const { POST } = await import("@/app/api/facecheck/route");
      const res = await POST(request({ embedding: emb }));
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.errorCode).toBe("KIOSK_KEY_UNSET");
    } finally {
      process.env.FACECHECK_KIOSK_KEY = original;
    }
  });

  it("레이트리밋: 동일 IP 121회째 → 429", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const headers = { "x-forwarded-for": "10.0.0.9" };
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) {
      last = await POST(request({ embedding: emb }, headers));
    }
    expect(last?.status).toBe(429);
    expect((await last!.json()).errorCode).toBe("RATE_LIMITED");
  });
});
