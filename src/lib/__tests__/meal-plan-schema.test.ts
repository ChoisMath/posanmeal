import { describe, expect, it } from "vitest";
import { adminApplicationSchema, studentRegisterSchema } from "@/lib/schemas/meal-plan";

const validAdmin = {
  subject: "급식신청",
  description: "안내문",
  startYear: 2026,
  startMonth: 7,
  monthCount: 1,
  applyStartAt: "2026-06-10T17:00:00+09:00",
  applyEndAt: "2026-06-12T16:00:00+09:00",
  meals: [
    {
      mealKind: "DINNER",
      price: 5680,
      exemptionSelectable: true,
      method: "DATE",
      dates: [{ grade: 1, date: "2026-07-21" }],
    },
    {
      mealKind: "BREAKFAST",
      price: 0,
      exemptionSelectable: false,
      method: "NONE",
      dates: [],
    },
  ],
};

describe("adminApplicationSchema", () => {
  it("정상 통과", () => {
    expect(adminApplicationSchema.safeParse(validAdmin).success).toBe(true);
  });

  it("마감 < 시작이면 실패", () => {
    expect(
      adminApplicationSchema.safeParse({
        ...validAdmin,
        applyEndAt: "2026-06-01T00:00:00+09:00",
      }).success,
    ).toBe(false);
  });

  it("NONE 아닌데 개설일 없으면 실패", () => {
    expect(
      adminApplicationSchema.safeParse({
        ...validAdmin,
        meals: [
          {
            mealKind: "DINNER",
            price: 0,
            exemptionSelectable: false,
            method: "DATE",
            dates: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("식사 중복(mealKind 같은 항목 2개)이면 실패", () => {
    expect(
      adminApplicationSchema.safeParse({
        ...validAdmin,
        meals: [
          { mealKind: "DINNER", price: 5680, exemptionSelectable: false, method: "DATE", dates: [{ grade: 1, date: "2026-07-21" }] },
          { mealKind: "DINNER", price: 4000, exemptionSelectable: false, method: "DATE", dates: [{ grade: 2, date: "2026-07-22" }] },
        ],
      }).success,
    ).toBe(false);
  });

  it("meals 빈 배열이면 실패", () => {
    expect(
      adminApplicationSchema.safeParse({
        ...validAdmin,
        meals: [],
      }).success,
    ).toBe(false);
  });
});

describe("studentRegisterSchema", () => {
  it("학생 신청 정상", () => {
    expect(
      studentRegisterSchema.safeParse({
        signature: "data:image/png;base64,abc",
        meals: [
          { mealKind: "DINNER", applied: true, exempt: false, selectedDates: ["2026-07-21"] },
          { mealKind: "LUNCH", applied: true, exempt: false, weekdaysByMonth: { "2026-07": [1, 3] } },
        ],
      }).success,
    ).toBe(true);
  });

  it("signature 없으면 실패", () => {
    expect(
      studentRegisterSchema.safeParse({
        signature: "",
        meals: [{ mealKind: "DINNER", applied: true, exempt: false }],
      }).success,
    ).toBe(false);
  });

  it("meals 빈 배열이면 실패", () => {
    expect(
      studentRegisterSchema.safeParse({
        signature: "data:image/png;base64,abc",
        meals: [],
      }).success,
    ).toBe(false);
  });
});
