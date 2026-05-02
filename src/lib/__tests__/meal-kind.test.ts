import { describe, expect, it } from "vitest";
import { resolveMealKind, type MealWindows } from "@/lib/meal-kind";

const windows: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
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
    expect(resolveMealKind(at("12:30"), windows)).toBeNull();
    expect(resolveMealKind(at("21:00"), windows)).toBeNull();
    expect(resolveMealKind(at("23:30"), windows)).toBeNull();
  });
});
