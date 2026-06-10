import { buildMonthlyMealColumns } from "@/lib/meal-columns";
import { describe, it, expect } from "vitest";

describe("buildMonthlyMealColumns", () => {
  it("조식·중식은 활성 날짜에만, 석식은 항상", () => {
    const cols = buildMonthlyMealColumns(2026, 7, {
      BREAKFAST: ["2026-07-01"],
      LUNCH: ["2026-07-01", "2026-07-02"],
    });
    const day1 = cols.filter((c) => c.day === 1).map((c) => c.mealKind);
    const day2 = cols.filter((c) => c.day === 2).map((c) => c.mealKind);
    const day3 = cols.filter((c) => c.day === 3).map((c) => c.mealKind);
    expect(day1).toEqual(["BREAKFAST", "LUNCH", "DINNER"]);
    expect(day2).toEqual(["LUNCH", "DINNER"]);
    expect(day3).toEqual(["DINNER"]);
  });

  it("activeDates 없으면 석식만 31개 (7월)", () => {
    const cols = buildMonthlyMealColumns(2026, 7);
    expect(cols).toHaveLength(31);
    expect(cols.every((c) => c.mealKind === "DINNER")).toBe(true);
  });

  it("key 형식은 YYYY-MM-DD:KIND", () => {
    const cols = buildMonthlyMealColumns(2026, 7, { BREAKFAST: ["2026-07-05"] });
    const bfCol = cols.find((c) => c.day === 5 && c.mealKind === "BREAKFAST");
    expect(bfCol?.key).toBe("2026-07-05:BREAKFAST");
    const dinnerCol = cols.find((c) => c.day === 5 && c.mealKind === "DINNER");
    expect(dinnerCol?.key).toBe("2026-07-05:DINNER");
  });

  it("label/shortLabel 매핑", () => {
    const cols = buildMonthlyMealColumns(2026, 7, {
      BREAKFAST: ["2026-07-01"],
      LUNCH: ["2026-07-01"],
    });
    const day1 = cols.filter((c) => c.day === 1);
    expect(day1.find((c) => c.mealKind === "BREAKFAST")?.shortLabel).toBe("조");
    expect(day1.find((c) => c.mealKind === "LUNCH")?.shortLabel).toBe("중");
    expect(day1.find((c) => c.mealKind === "DINNER")?.shortLabel).toBe("석");
    expect(day1.find((c) => c.mealKind === "BREAKFAST")?.label).toBe("조식");
    expect(day1.find((c) => c.mealKind === "LUNCH")?.label).toBe("중식");
    expect(day1.find((c) => c.mealKind === "DINNER")?.label).toBe("석식");
  });
});
