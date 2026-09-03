import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  systemSettingUpsert: vi.fn(),
  systemSettingFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { upsert: mocks.systemSettingUpsert, findMany: mocks.systemSettingFindMany },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// 서버 route.ts의 검증 로직을 순수 함수로 추출해 테스트
// 실제 라우트와 동일한 구현이어야 함

const timePattern = /^\d{2}:\d{2}$/;

function toMinutes(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aS: number, aE: number, bS: number, bE: number) {
  return aE > bS && aS < bE;
}

type Window = { start: string; end: string };

function validateServerMealWindows(
  bf: Window,
  lu: Window,
  dn: Window,
): "Invalid meal window" | "Start time must be before end time" | "Meal windows must not overlap" | null {
  const allValues = [bf.start, bf.end, lu.start, lu.end, dn.start, dn.end];
  if (allValues.some((v) => typeof v !== "string" || !timePattern.test(v))) {
    return "Invalid meal window";
  }
  const bfS = toMinutes(bf.start);
  const bfE = toMinutes(bf.end);
  const luS = toMinutes(lu.start);
  const luE = toMinutes(lu.end);
  const dnS = toMinutes(dn.start);
  const dnE = toMinutes(dn.end);

  if (bfS >= bfE || luS >= luE || dnS >= dnE) {
    return "Start time must be before end time";
  }
  if (overlaps(bfS, bfE, luS, luE) || overlaps(bfS, bfE, dnS, dnE) || overlaps(luS, luE, dnS, dnE)) {
    return "Meal windows must not overlap";
  }
  return null;
}

const validBf: Window = { start: "04:00", end: "10:00" };
const validLu: Window = { start: "10:30", end: "14:00" };
const validDn: Window = { start: "15:00", end: "21:00" };

describe("서버 mealWindows 검증 (3윈도우)", () => {
  it("유효한 3윈도우 → null", () => {
    expect(validateServerMealWindows(validBf, validLu, validDn)).toBeNull();
  });

  it("HH:MM 형식 위반 → Invalid meal window", () => {
    expect(validateServerMealWindows({ start: "4:00", end: "10:00" }, validLu, validDn)).toBe(
      "Invalid meal window",
    );
  });

  it("중식 형식 위반 → Invalid meal window", () => {
    expect(validateServerMealWindows(validBf, { start: "1030", end: "14:00" }, validDn)).toBe(
      "Invalid meal window",
    );
  });

  it("start >= end → Start time must be before end time", () => {
    expect(validateServerMealWindows({ start: "10:00", end: "10:00" }, validLu, validDn)).toBe(
      "Start time must be before end time",
    );
  });

  it("중식 start > end → Start time must be before end time", () => {
    expect(validateServerMealWindows(validBf, { start: "14:00", end: "10:30" }, validDn)).toBe(
      "Start time must be before end time",
    );
  });

  it("조식-중식 겹침 → Meal windows must not overlap", () => {
    expect(
      validateServerMealWindows({ start: "04:00", end: "11:00" }, { start: "10:30", end: "14:00" }, validDn),
    ).toBe("Meal windows must not overlap");
  });

  it("중식-석식 겹침 → Meal windows must not overlap", () => {
    expect(
      validateServerMealWindows(validBf, { start: "10:30", end: "16:00" }, { start: "15:00", end: "21:00" }),
    ).toBe("Meal windows must not overlap");
  });

  it("조식-석식 겹침 → Meal windows must not overlap", () => {
    expect(
      validateServerMealWindows({ start: "04:00", end: "21:00" }, validLu, { start: "15:00", end: "21:00" }),
    ).toBe("Meal windows must not overlap");
  });

  it("인접(end=start)은 겹침 아님 → null", () => {
    expect(
      validateServerMealWindows(
        { start: "04:00", end: "10:00" },
        { start: "10:00", end: "14:00" },
        { start: "14:00", end: "21:00" },
      ),
    ).toBeNull();
  });
});

function putRequest(body: unknown) {
  return new Request("http://localhost/api/system/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/system/settings — faceMatchThreshold/Margin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN" } });
    mocks.systemSettingFindMany.mockResolvedValue([]);
  });

  it("faceMatchThreshold 1.5(범위 밖) → 400", async () => {
    const { PUT } = await import("@/app/api/system/settings/route");
    const res = await PUT(putRequest({ faceMatchThreshold: 1.5 }));
    expect(res.status).toBe(400);
    expect(mocks.systemSettingUpsert).not.toHaveBeenCalled();
  });

  it("faceMatchThreshold 0.6 → upsert(key: face_match_threshold, value: '0.6')", async () => {
    const { PUT } = await import("@/app/api/system/settings/route");
    const res = await PUT(putRequest({ faceMatchThreshold: 0.6 }));
    expect(res.status).toBe(200);
    expect(mocks.systemSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "face_match_threshold" },
        update: { value: "0.6" },
        create: { key: "face_match_threshold", value: "0.6" },
      }),
    );
  });
});
