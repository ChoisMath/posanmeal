import { formatMonthDateKey, getDaysInMonthUtc } from "@/lib/date-range";

export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";

export interface MealColumn {
  key: string;
  date: string;
  day: number;
  mealKind: MealKind;
  shortLabel: "조" | "중" | "석";
  label: "조식" | "중식" | "석식";
}

export function getDateDayKey(value: string | Date): string {
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return new Date(value).toISOString().slice(0, 10);
}

const SHORT_LABEL: Record<MealKind, "조" | "중" | "석"> = {
  BREAKFAST: "조",
  LUNCH: "중",
  DINNER: "석",
};

const LABEL: Record<MealKind, "조식" | "중식" | "석식"> = {
  BREAKFAST: "조식",
  LUNCH: "중식",
  DINNER: "석식",
};

function createMealColumn(date: string, day: number, mealKind: MealKind): MealColumn {
  return {
    key: `${date}:${mealKind}`,
    date,
    day,
    mealKind,
    shortLabel: SHORT_LABEL[mealKind],
    label: LABEL[mealKind],
  };
}

export function buildMonthlyMealColumns(
  year: number,
  month: number,
  activeDates: Partial<Record<"BREAKFAST" | "LUNCH", Array<string | Date>>> = {},
): MealColumn[] {
  const breakfastSet = new Set((activeDates.BREAKFAST ?? []).map(getDateDayKey));
  const lunchSet = new Set((activeDates.LUNCH ?? []).map(getDateDayKey));
  const daysInMonth = getDaysInMonthUtc(year, month);
  const columns: MealColumn[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = formatMonthDateKey(year, month, day);
    if (breakfastSet.has(date)) {
      columns.push(createMealColumn(date, day, "BREAKFAST"));
    }
    if (lunchSet.has(date)) {
      columns.push(createMealColumn(date, day, "LUNCH"));
    }
    columns.push(createMealColumn(date, day, "DINNER"));
  }

  return columns;
}
