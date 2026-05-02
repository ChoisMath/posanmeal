import { describe, expect, it } from "vitest";
import { validateSelectedDates } from "@/lib/breakfast-validation";

describe("validateSelectedDates", () => {
  const allowed = ["2026-05-05", "2026-05-07", "2026-05-12"];

  it("accepts a non-empty subset of allowed dates", () => {
    expect(validateSelectedDates(["2026-05-05"], allowed)).toEqual({
      ok: true,
      dates: ["2026-05-05"],
    });
  });

  it("rejects empty selections", () => {
    expect(validateSelectedDates([], allowed)).toEqual({
      ok: false,
      code: "INVALID_DATES",
    });
  });

  it("rejects dates outside allowed dates", () => {
    expect(validateSelectedDates(["2026-05-05", "2026-05-06"], allowed)).toEqual({
      ok: false,
      code: "INVALID_DATES",
    });
  });

  it("deduplicates selected dates while preserving first-seen order", () => {
    expect(validateSelectedDates(["2026-05-05", "2026-05-05"], allowed)).toEqual({
      ok: true,
      dates: ["2026-05-05"],
    });
  });
});
