import { describe, expect, it } from "vitest";
import { applicationSchema } from "@/lib/schemas/application";

describe("applicationSchema", () => {
  it("accepts breakfast applications with apply dates and allowed dates only", () => {
    const result = applicationSchema.safeParse({
      type: "BREAKFAST",
      title: "5월 조식",
      applyStart: "2026-05-01",
      applyEnd: "2026-05-03",
      allowedDates: ["2026-05-05", "2026-05-07"],
    });

    expect(result.success).toBe(true);
  });

  it("requires apply dates for breakfast applications", () => {
    const result = applicationSchema.safeParse({
      type: "BREAKFAST",
      title: "5월 조식",
      allowedDates: ["2026-05-05", "2026-05-07"],
    });

    expect(result.success).toBe(false);
  });

  it("still requires apply and meal date ranges for dinner", () => {
    const result = applicationSchema.safeParse({
      type: "DINNER",
      title: "5월 석식",
      applyStart: "2026-05-01",
      applyEnd: "2026-05-03",
      mealStart: "2026-05-05",
    });

    expect(result.success).toBe(false);
  });
});
