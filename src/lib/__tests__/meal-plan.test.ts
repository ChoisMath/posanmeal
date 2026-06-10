import { describe, expect, it } from "vitest";
import { expandWeekdays, monthsOf, calcMealFee, buildAppTitle, monthKeyOf } from "@/lib/meal-plan";

describe("monthsOf", () => {
  it("2026-11부터 3개월", () => {
    expect(monthsOf(2026, 11, 3)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  it("1월부터 1개월", () => {
    expect(monthsOf(2026, 1, 1)).toEqual([{ year: 2026, month: 1 }]);
  });
});

describe("expandWeekdays", () => {
  it("개설일 중 선택 요일만", () => {
    // 2026-07-21(화=2) 22(수=3) 24(금=5) 27(월=1), 선택 요일 [월=1, 수=3]
    expect(
      expandWeekdays(["2026-07-21", "2026-07-22", "2026-07-24", "2026-07-27"], [1, 3]),
    ).toEqual(["2026-07-22", "2026-07-27"]);
  });

  it("빈 weekdays면 빈 배열 반환", () => {
    expect(expandWeekdays(["2026-07-21"], [])).toEqual([]);
  });
});

describe("calcMealFee", () => {
  it("면제 아닌 경우 price * dayCount", () => {
    expect(calcMealFee(5680, 8, false)).toBe(45440);
  });

  it("면제는 0원", () => {
    expect(calcMealFee(5680, 8, true)).toBe(0);
  });
});

describe("buildAppTitle", () => {
  it("년도 월 주제로 제목 구성", () => {
    expect(buildAppTitle(2026, 6, "급식신청")).toBe("2026년 06월 급식신청");
  });

  it("한 자리 월은 0 패딩", () => {
    expect(buildAppTitle(2026, 1, "급식신청")).toBe("2026년 01월 급식신청");
  });
});

describe("monthKeyOf", () => {
  it("날짜 키에서 년-월 추출", () => {
    expect(monthKeyOf("2026-07-21")).toBe("2026-07");
  });
});
