export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";
export type MealApplyMethod = "NONE" | "YN" | "WEEKDAY" | "DATE";

export const MEAL_KINDS: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];
export const MEAL_LABEL: Record<MealKind, string> = {
  BREAKFAST: "조식",
  LUNCH: "중식",
  DINNER: "석식",
};
export const MEAL_SHORT: Record<MealKind, string> = {
  BREAKFAST: "조",
  LUNCH: "중",
  DINNER: "석",
};
export const METHOD_LABEL: Record<MealApplyMethod, string> = {
  NONE: "신청불가",
  YN: "신청/미신청",
  WEEKDAY: "요일선택",
  DATE: "날짜선택",
};
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function monthsOf(
  startYear: number,
  startMonth: number,
  monthCount: number,
): { year: number; month: number }[] {
  return Array.from({ length: monthCount }, (_, i) => {
    const m = startMonth - 1 + i;
    return { year: startYear + Math.floor(m / 12), month: (m % 12) + 1 };
  });
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

export function expandWeekdays(openDates: string[], weekdays: number[]): string[] {
  const set = new Set(weekdays);
  return openDates.filter((d) => set.has(weekdayOf(d))).sort();
}

export function calcMealFee(price: number, dayCount: number, exempt: boolean): number {
  return exempt ? 0 : price * dayCount;
}

export function buildAppTitle(startYear: number, startMonth: number, subject: string): string {
  return `${startYear}년 ${String(startMonth).padStart(2, "0")}월 ${subject}`;
}

/** 학번: 1학년 2반 4번 → 10204 */
export function studentNumberOf(grade: number, classNum: number, number: number): number {
  return grade * 10000 + classNum * 100 + number;
}
