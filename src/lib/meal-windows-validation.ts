// src/lib/meal-windows-validation.ts
export type { MealWindows as MealWindowsForm } from "@/lib/meal-kind-local";
import type { MealWindow, MealWindows } from "@/lib/meal-kind-local";

const TIME_PATTERN = /^\d{2}:\d{2}$/;

const ERROR_FORMAT = "시간을 HH:MM 형식으로 입력해주세요";
const ERROR_ORDER = "종료 시간은 시작 시간보다 늦어야 합니다";
const ERROR_OVERLAP = "식사 시간대가 서로 겹칠 수 없습니다";

// Inlined intentionally — same helper exists in meal-kind.ts and meal-kind-local.ts.
// Keeping each module self-contained to avoid pulling those modules' other exports.
function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: MealWindow, b: MealWindow): boolean {
  return toMinutes(a.end) > toMinutes(b.start) && toMinutes(a.start) < toMinutes(b.end);
}

export function validateMealWindows(form: MealWindows): string | null {
  const windows = [form.breakfast, form.lunch, form.dinner];

  const allValues = windows.flatMap((w) => [w.start, w.end]);
  if (allValues.some((v) => !TIME_PATTERN.test(v))) {
    return ERROR_FORMAT;
  }

  for (const w of windows) {
    if (toMinutes(w.start) >= toMinutes(w.end)) {
      return ERROR_ORDER;
    }
  }

  // Check all 3 pairs: breakfast-lunch, breakfast-dinner, lunch-dinner
  const pairs: [MealWindow, MealWindow][] = [
    [form.breakfast, form.lunch],
    [form.breakfast, form.dinner],
    [form.lunch, form.dinner],
  ];
  for (const [a, b] of pairs) {
    if (overlaps(a, b)) {
      return ERROR_OVERLAP;
    }
  }

  return null;
}

// Keys must match the error strings returned from src/app/api/system/settings/route.ts PUT.
export function mapServerError(serverError: string | undefined): string | null {
  if (!serverError) return null;
  switch (serverError) {
    case "Invalid meal window":
      return ERROR_FORMAT;
    case "Start time must be before end time":
      return ERROR_ORDER;
    case "Meal windows must not overlap":
      return ERROR_OVERLAP;
    default:
      return null;
  }
}
