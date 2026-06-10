import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveMealKind, type MealWindows } from "@/lib/meal-kind";

const windows: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  lunch: { start: "10:30", end: "14:00" },
  dinner: { start: "15:00", end: "21:00" },
};

function at(hhmm: string) {
  const [hour, minute] = hhmm.split(":").map(Number);
  const date = new Date("2026-05-02T00:00:00");
  date.setHours(hour, minute, 0, 0);
  return date;
}

describe("resolveMealKind", () => {
  it("returns BREAKFAST inside the breakfast window", () => {
    expect(resolveMealKind(at("07:00"), windows)).toBe("BREAKFAST");
  });

  it("includes the start boundary and excludes the end boundary", () => {
    expect(resolveMealKind(at("04:00"), windows)).toBe("BREAKFAST");
    expect(resolveMealKind(at("09:59"), windows)).toBe("BREAKFAST");
    expect(resolveMealKind(at("10:00"), windows)).toBeNull();
  });

  it("returns DINNER inside the dinner window", () => {
    expect(resolveMealKind(at("18:00"), windows)).toBe("DINNER");
  });

  it("returns null outside meal windows", () => {
    expect(resolveMealKind(at("21:00"), windows)).toBeNull();
    expect(resolveMealKind(at("23:30"), windows)).toBeNull();
  });

  it("returns LUNCH inside the lunch window", () => {
    expect(resolveMealKind(at("12:00"), windows)).toBe("LUNCH");
  });

  it("returns null in the gap between lunch and dinner", () => {
    expect(resolveMealKind(at("14:30"), windows)).toBeNull();
  });
});

// Mock prisma for isStudentEligibleToday tests
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mealRegistrationMealDate: {
      findFirst: vi.fn(),
    },
  },
}));

describe("isStudentEligibleToday", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a matching MealRegistrationMealDate row exists (DINNER)", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue({
      registrationId: 1,
      mealKind: "DINNER",
      date: new Date("2026-06-11T00:00:00.000Z"),
    });

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const result = await isStudentEligibleToday(42, "DINNER", new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toBe(true);
  });

  it("returns false when no matching row exists (DINNER)", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue(null);

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const result = await isStudentEligibleToday(42, "DINNER", new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toBe(false);
  });

  it("returns true when a matching MealRegistrationMealDate row exists (BREAKFAST)", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue({
      registrationId: 2,
      mealKind: "BREAKFAST",
      date: new Date("2026-06-11T00:00:00.000Z"),
    });

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const result = await isStudentEligibleToday(99, "BREAKFAST", new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toBe(true);
  });

  it("returns true when a matching MealRegistrationMealDate row exists (LUNCH)", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue({
      registrationId: 3,
      mealKind: "LUNCH",
      date: new Date("2026-06-11T00:00:00.000Z"),
    });

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const result = await isStudentEligibleToday(7, "LUNCH", new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toBe(true);
  });

  it("returns false when no LUNCH row exists", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue(null);

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const result = await isStudentEligibleToday(7, "LUNCH", new Date("2026-06-11T00:00:00.000Z"));
    expect(result).toBe(false);
  });

  it("calls findFirst with correct query shape", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.mealRegistrationMealDate.findFirst).mockResolvedValue(null);

    const { isStudentEligibleToday } = await import("@/lib/meal-kind");
    const todayDate = new Date("2026-06-11T00:00:00.000Z");
    await isStudentEligibleToday(42, "DINNER", todayDate);

    expect(prisma.mealRegistrationMealDate.findFirst).toHaveBeenCalledWith({
      where: {
        mealKind: "DINNER",
        date: todayDate,
        registration: { userId: 42, status: "APPROVED" },
      },
      select: { registrationId: true },
    });
  });
});
