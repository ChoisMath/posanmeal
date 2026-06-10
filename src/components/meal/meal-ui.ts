import type { MealKind } from "@/lib/meal-plan";

export const MEAL_THEME: Record<
  MealKind,
  { side: string; head: string; cell: string; text: string }
> = {
  BREAKFAST: {
    side: "bg-sky-100 dark:bg-sky-950",
    head: "bg-sky-50 dark:bg-sky-900/30",
    cell: "bg-sky-50/60",
    text: "text-sky-700 dark:text-sky-300",
  },
  LUNCH: {
    side: "bg-orange-100 dark:bg-orange-950",
    head: "bg-orange-50 dark:bg-orange-900/30",
    cell: "bg-orange-50/60",
    text: "text-orange-700 dark:text-orange-300",
  },
  DINNER: {
    side: "bg-rose-100 dark:bg-rose-950",
    head: "bg-rose-50 dark:bg-rose-900/30",
    cell: "bg-rose-50/60",
    text: "text-rose-700 dark:text-rose-300",
  },
};

export const OPEN_DATE_BG = "bg-yellow-100 dark:bg-yellow-900/40";
