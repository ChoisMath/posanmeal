import { describe, expect, it } from "vitest";
import { resolveMealKindLocal, type MealWindows } from "@/lib/meal-kind-local";

const windows: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner: { start: "15:00", end: "21:00" },
};

function at(hour: number, minute = 0) {
  const date = new Date("2026-05-02T00:00:00");
  date.setHours(hour, minute, 0, 0);
  return date;
}

describe("resolveMealKindLocal", () => {
  it("uses the same window rules on the client", () => {
    expect(resolveMealKindLocal(at(7), windows)).toBe("BREAKFAST");
    expect(resolveMealKindLocal(at(18), windows)).toBe("DINNER");
    expect(resolveMealKindLocal(at(12), windows)).toBeNull();
  });
});
