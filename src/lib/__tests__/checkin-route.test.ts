import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QRTokenPayload } from "@/lib/qr-token";

const mocks = vi.hoisted(() => {
  process.env.QR_JWT_SECRET = "test-qr-secret";
  return {
    userFindUnique: vi.fn(),
    userFindMany: vi.fn(),
    recordFindMany: vi.fn(),
    checkInFindFirst: vi.fn(),
    checkInCreate: vi.fn(),
    mealDateFindFirst: vi.fn(),
    getCachedSettings: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
    userAcademicRecord: { findMany: mocks.recordFindMany },
    checkIn: { findFirst: mocks.checkInFindFirst, create: mocks.checkInCreate },
    mealRegistrationMealDate: { findFirst: mocks.mealDateFindFirst },
    $queryRaw: () => Promise.resolve([{ mode: "PREPARING" }]),
    $transaction: (run: (tx: unknown) => Promise<unknown>) => run(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/settings-cache", () => ({ getCachedSettings: mocks.getCachedSettings }));

const OPEN_SETTINGS = {
  mealWindows: {
    breakfast: { start: "00:00", end: "00:00" },
    lunch: { start: "00:00", end: "00:00" },
    dinner: { start: "00:00", end: "23:59" },
  },
  faceMatch: { threshold: 0.55, margin: 0.05 },
};

const STUDENT = {
  id: 1, name: "김학생", role: "STUDENT", grade: 2, classNum: 3, number: 7,
  photoUrl: null, accessState: "ACTIVE",
};

function profileRow(user: typeof STUDENT) {
  return { ...user, gender: null, subject: null, homeroom: null, position: null };
}

async function postToken(payload: QRTokenPayload) {
  const { signQRToken } = await import("@/lib/qr-token");
  const { POST } = await import("@/app/api/checkin/route");
  return POST(
    new Request("http://localhost/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: signQRToken(payload) }),
    }),
  );
}

describe("/api/checkin — 최신 계정 상태로 판정", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T09:00:00Z"));
    mocks.getCachedSettings.mockResolvedValue(OPEN_SETTINGS);
    mocks.recordFindMany.mockResolvedValue([]);
    mocks.userFindMany.mockResolvedValue([profileRow(STUDENT)]);
    mocks.userFindUnique.mockResolvedValue(STUDENT);
    mocks.checkInFindFirst.mockResolvedValue(null);
    mocks.mealDateFindFirst.mockResolvedValue({ registrationId: 1 });
    mocks.checkInCreate.mockResolvedValue({ checkedAt: new Date("2026-09-02T09:00:00Z") });
  });

  afterEach(() => vi.useRealTimers());

  it("정상 QR은 체크인을 만든다", async () => {
    const res = await postToken({ userId: 1, role: "STUDENT", type: "STUDENT" });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({ id: 1, name: "김학생", grade: 2, classNum: 3 });
    expect(mocks.checkInCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "QR", type: "STUDENT" }) }),
    );
  });

  it("이용이 중지된 계정은 저장 없이 ACCOUNT_INACTIVE로 거절한다", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...STUDENT, accessState: "INACTIVE" });

    const res = await postToken({ userId: 1, role: "STUDENT", type: "STUDENT" });

    expect(res.status).toBe(403);
    expect((await res.json()).errorCode).toBe("ACCOUNT_INACTIVE");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("저장 직전에 이용이 중지되면 저장하지 않는다", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(STUDENT)
      .mockResolvedValueOnce({ ...STUDENT, accessState: "INACTIVE" });

    const res = await postToken({ userId: 1, role: "STUDENT", type: "STUDENT" });

    expect(res.status).toBe(403);
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("역할이 바뀐 계정의 옛 교사 QR은 근무 식사로 통과하지 않는다", async () => {
    const res = await postToken({ userId: 1, role: "TEACHER", type: "WORK" });

    expect(res.status).toBe(400);
    expect((await res.json()).errorCode).toBe("ROLE_CHANGED");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });

  it("미신청 학생은 NO_MEAL_PERIOD로 거절한다", async () => {
    mocks.mealDateFindFirst.mockResolvedValue(null);

    const res = await postToken({ userId: 1, role: "STUDENT", type: "STUDENT" });

    expect((await res.json()).errorCode).toBe("NO_MEAL_PERIOD");
    expect(mocks.checkInCreate).not.toHaveBeenCalled();
  });
});
