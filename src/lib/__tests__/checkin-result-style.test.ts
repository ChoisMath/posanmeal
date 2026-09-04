import { describe, expect, it } from "vitest";
import { RESULT_BG_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";

describe("resultCategory", () => {
  it("성공 → success", () => expect(resultCategory({ success: true })).toBe("success"));
  it("중복 → duplicate", () => expect(resultCategory({ success: false, duplicate: true })).toBe("duplicate"));
  it("미신청 → notApplicant", () => expect(resultCategory({ success: false, notApplicant: true })).toBe("notApplicant"));
  it("그 외 실패 → error", () => expect(resultCategory({ success: false })).toBe("error"));
});

describe("색상 매핑", () => {
  it("초록/파랑/빨강/주황", () => {
    expect(RESULT_BG_CLASS.success).toBe("bg-emerald-500");
    expect(RESULT_BG_CLASS.duplicate).toBe("bg-blue-500");
    expect(RESULT_BG_CLASS.notApplicant).toBe("bg-red-500");
    expect(RESULT_BG_CLASS.error).toBe("bg-orange-500");
    expect(RESULT_TEXT_CLASS.duplicate).toContain("text-blue-700");
  });
});
