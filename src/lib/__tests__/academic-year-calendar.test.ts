import { describe, expect, it } from "vitest";
import { academicYearBounds, academicYearOfDate, nextKstMidnight } from "@/lib/academic-year/calendar";

describe("academic year calendar", () => {
  it("keeps January and leap-day in the preceding academic year", () => {
    expect(academicYearOfDate("2027-02-28")).toBe(2026);
    expect(academicYearOfDate("2028-02-29")).toBe(2027);
    expect(academicYearOfDate("2027-03-01")).toBe(2027);
    expect(() => academicYearOfDate("2027-02-29")).toThrow();
    expect(nextKstMidnight(new Date("2027-02-28T14:59:59.000Z")).toISOString()).toBe(
      "2027-02-28T15:00:00.000Z",
    );
  });

  it("treats January as the preceding academic year", () => {
    expect(academicYearOfDate("2027-01-31")).toBe(2026);
    expect(academicYearOfDate("2026-12-31")).toBe(2026);
  });

  it("rejects malformed date keys", () => {
    expect(() => academicYearOfDate("2027-3-1")).toThrow();
    expect(() => academicYearOfDate("2027-13-01")).toThrow();
  });

  it("bounds a year from March 1 to the last day of the next February", () => {
    expect(academicYearBounds(2026)).toEqual({ startDate: "2026-03-01", endDate: "2027-02-28" });
    expect(academicYearBounds(2027)).toEqual({ startDate: "2027-03-01", endDate: "2028-02-29" });
  });

  it("advances to the next KST midnight from any absolute instant", () => {
    // 2027-02-28T15:00:00Z === KST 2027-03-01 00:00 정각 → 그 다음 자정으로 넘어간다.
    expect(nextKstMidnight(new Date("2027-02-28T15:00:00.000Z")).toISOString()).toBe(
      "2027-03-01T15:00:00.000Z",
    );
    expect(nextKstMidnight(new Date("2026-09-19T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-19T15:00:00.000Z",
    );
    // KST 기준 같은 날 이른 새벽(UTC 전날 후반)도 같은 자정을 가리킨다.
    expect(nextKstMidnight(new Date("2026-09-18T16:00:00.000Z")).toISOString()).toBe(
      "2026-09-19T15:00:00.000Z",
    );
  });
});
