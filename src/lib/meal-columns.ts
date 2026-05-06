import { formatMonthDateKey, getDaysInMonthUtc } from "@/lib/date-range";

export type MealKind = "BREAKFAST" | "DINNER";

export interface MealColumn {
  key: string;
  date: string;
  day: number;
  mealKind: MealKind;
  shortLabel: "조" | "석";
  label: "조식" | "석식";
}

export function getDateDayKey(value: string | Date): string {
  if (typeof value === "string") {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return new Date(value).toISOString().slice(0, 10);
}

function createMealColumn(date: string, day: number, mealKind: MealKind): MealColumn {
  return {
    key: `${date}:${mealKind}`,
    date,
    day,
    mealKind,
    shortLabel: mealKind === "BREAKFAST" ? "조" : "석",
    label: mealKind === "BREAKFAST" ? "조식" : "석식",
  };
}

export function buildMonthlyMealColumns(
  year: number,
  month: number,
  breakfastDates: Array<string | Date> = [],
): MealColumn[] {
  const breakfastSet = new Set(breakfastDates.map(getDateDayKey));
  const daysInMonth = getDaysInMonthUtc(year, month);
  const columns: MealColumn[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = formatMonthDateKey(year, month, day);
    if (breakfastSet.has(date)) {
      columns.push(createMealColumn(date, day, "BREAKFAST"));
    }
    columns.push(createMealColumn(date, day, "DINNER"));
  }

  return columns;
}
