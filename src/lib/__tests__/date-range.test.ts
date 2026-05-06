import { describe, expect, it } from "vitest";
import { buildMonthDateRange, dateKeyToUtcDate } from "@/lib/date-range";

describe("date range helpers", () => {
  it("builds a UTC month range that includes the last date-only database value", () => {
    const { startDate, endDate, daysInMonth } = buildMonthDateRange(2026, 4);

    expect(daysInMonth).toBe(30);
    expect(startDate.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(dateKeyToUtcDate("2026-04-30").getTime()).toBeLessThanOrEqual(endDate.getTime());
  });

  it("rejects invalid date keys before they reach database queries", () => {
    expect(() => dateKeyToUtcDate("2026-4-30")).toThrow("Invalid date key");
    expect(() => dateKeyToUtcDate("2026-04-31")).toThrow("Invalid date key");
  });
});
