import { beforeEach, describe, expect, it, vi } from "vitest";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInCreate: vi.fn(),
  getFaceCandidates: vi.fn(),
  getCachedSettings: vi.fn(),
  isStudentEligibleToday: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    checkIn: { findFirst: mocks.checkInFindFirst, create: mocks.checkInCreate },
  },
}));
vi.mock("@/lib/face-embedding-cache", () => ({
  getFaceCandidates: mocks.getFaceCandidates,
}));
vi.mock("@/lib/settings-cache", () => ({
  getCachedSettings: mocks.getCachedSettings,
}));
vi.mock("@/lib/meal-kind", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meal-kind")>();
  return { ...actual, isStudentEligibleToday: mocks.isStudentEligibleToday };
});

// 축 0 단위벡터 — 등록 임베딩과 요청 임베딩을 동일하게 두어 유사도 1
const emb = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

const STUDENT = { id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7, photoUrl: null };
const TEACHER = { id: 9, name: "박교사", role: "TEACHER", grade: null, classNum: null, number: null, photoUrl: null };

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
    vi.clearAllMocks();
    process.env.FACECHECK_KIOSK_KEY = "test-key";
    mocks.getCachedSettings.mockResolvedValue(OPEN_SETTINGS);
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 1, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.checkInFindFirst.mockResolvedValue(null);
    mocks.isStudentEligibleToday.mockResolvedValue(true);
    mocks.checkInCreate.mockResolvedValue({ checkedAt: new Date("2026-09-02T09:00:00Z") });
  });

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

  it("학생 매칭 → source FACE, type STUDENT로 즉시 체크인", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, type: "STUDENT", source: "FACE" }),
      }),
    );
  });

  it("학생 미자격 → notApplicant, 체크인 없음", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.isStudentEligibleToday.mockResolvedValue(false);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
    expect(body.notApplicant).toBe(true);
    expect(body.error).toBe("오늘 석식 신청자가 아닙니다.");
    expect(body.user.name).toBe("김학생");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("중복 → duplicate 응답", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.checkInFindFirst.mockResolvedValue({ checkedAt: new Date() });
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();
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

  it("교사 + type WORK → WORK로 체크인", async () => {
    mocks.getFaceCandidates.mockResolvedValue([
      { userId: 9, embeddings: [Float32Array.from(emb)] },
    ]);
    mocks.userFindUnique.mockResolvedValue(TEACHER);
    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb, type: "WORK" }))).json();
    expect(body.success).toBe(true);
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 9, type: "WORK", source: "FACE" }),
      }),
    );
  });

  it("학생에게 type이 와도 STUDENT로 저장", async () => {
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    const { POST } = await import("@/app/api/facecheck/route");
    await POST(request({ embedding: emb, type: "WORK" }));
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
    mocks.checkInCreate.mockRejectedValueOnce({ code: "P2002" } as any);

    const { POST } = await import("@/app/api/facecheck/route");
    const body = await (await POST(request({ embedding: emb }))).json();

    expect(body.success).toBe(false);
    expect(body.matched).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(body.user.name).toBe("김학생");
    expect(body.mealKind).toBe("DINNER");
    expect(body.checkedAt).toBeDefined();
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
