import { dateKeyToUtcDate, formatMonthDateKey, getDaysInMonthUtc } from "@/lib/date-range";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 학년도는 3월 1일에 시작한다. 1~2월은 직전 학년도에 속한다. */
export function academicYearOfDate(dateKey: string): number {
  const date = dateKeyToUtcDate(dateKey);
  const month = date.getUTCMonth() + 1;
  return month < 3 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
}

export function academicYearBounds(year: number): { startDate: string; endDate: string } {
  const lastFebruaryDay = getDaysInMonthUtc(year + 1, 2);
  return {
    startDate: formatMonthDateKey(year, 3, 1),
    endDate: formatMonthDateKey(year + 1, 2, lastFebruaryDay),
  };
}

/**
 * 절대시각 기준 다음 KST 자정. nowKST()가 돌려주는 "재해석된" Date는
 * 절대시각이 어긋나 있어 여기서 쓰면 안 된다.
 */
export function nextKstMidnight(now: Date): Date {
  const shifted = now.getTime() + KST_OFFSET_MS;
  const nextShiftedMidnight = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS;
  return new Date(nextShiftedMidnight - KST_OFFSET_MS);
}

/** 절대시각이 속한 KST 날짜. `nowKST()`의 재해석된 Date를 넣으면 안 된다. */
export function kstDateKey(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = dateKeyToUtcDate(dateKey);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
