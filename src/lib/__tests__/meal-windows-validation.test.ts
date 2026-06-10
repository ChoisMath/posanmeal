// src/lib/__tests__/meal-windows-validation.test.ts
import { describe, expect, it } from "vitest";
import {
  validateMealWindows,
  mapServerError,
  type MealWindowsForm,
} from "@/lib/meal-windows-validation";

const valid: MealWindowsForm = {
  breakfast: { start: "04:00", end: "10:00" },
  lunch: { start: "10:30", end: "14:00" },
  dinner: { start: "15:00", end: "21:00" },
};

describe("validateMealWindows", () => {
  it("returns null for the default valid windows", () => {
    expect(validateMealWindows(valid)).toBeNull();
  });

  it("returns null when windows are exactly adjacent (no gap between them)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "10:00" },
        lunch: { start: "10:00", end: "14:00" },
        dinner: { start: "14:00", end: "21:00" },
      }),
    ).toBeNull();
  });

  it("rejects empty values", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "", end: "10:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("시간을 HH:MM 형식으로 입력해주세요");
  });

  it("rejects malformed time strings", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "4:00", end: "10:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("시간을 HH:MM 형식으로 입력해주세요");
  });

  it("rejects when breakfast start equals end", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "08:00", end: "08:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("종료 시간은 시작 시간보다 늦어야 합니다");
  });

  it("rejects when dinner end is before dinner start", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "10:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "21:00", end: "15:00" },
      }),
    ).toBe("종료 시간은 시작 시간보다 늦어야 합니다");
  });

  it("rejects overlapping windows (breakfast spills into dinner)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "16:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("식사 시간대가 서로 겹칠 수 없습니다");
  });

  it("rejects overlapping windows (dinner spills into breakfast)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "08:00", end: "10:00" },
        lunch: { start: "10:30", end: "14:00" },
        dinner: { start: "07:00", end: "21:00" },
      }),
    ).toBe("식사 시간대가 서로 겹칠 수 없습니다");
  });

  it("중식 형식 오류", () => {
    expect(validateMealWindows({ ...valid, lunch: { start: "10시", end: "14:00" } }))
      .toBe("시간을 HH:MM 형식으로 입력해주세요");
  });

  it("조식과 중식 겹침", () => {
    expect(validateMealWindows({ ...valid, breakfast: { start: "04:00", end: "11:00" }, lunch: { start: "10:30", end: "14:00" } }))
      .toBe("식사 시간대가 서로 겹칠 수 없습니다");
  });

  it("중식과 석식 겹침", () => {
    expect(validateMealWindows({ ...valid, lunch: { start: "10:30", end: "15:30" } }))
      .toBe("식사 시간대가 서로 겹칠 수 없습니다");
  });
});

describe("mapServerError", () => {
  it("maps the server's invalid-meal-window message", () => {
    expect(mapServerError("Invalid meal window")).toBe(
      "시간을 HH:MM 형식으로 입력해주세요",
    );
  });

  it("maps the start-before-end message", () => {
    expect(mapServerError("Start time must be before end time")).toBe(
      "종료 시간은 시작 시간보다 늦어야 합니다",
    );
  });

  it("maps the overlap message", () => {
    expect(mapServerError("Meal windows must not overlap")).toBe(
      "식사 시간대가 서로 겹칠 수 없습니다",
    );
  });

  it("returns null for unknown or missing errors", () => {
    expect(mapServerError(undefined)).toBeNull();
    expect(mapServerError("Some other error")).toBeNull();
  });
});
