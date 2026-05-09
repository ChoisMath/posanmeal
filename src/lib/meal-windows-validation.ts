// src/lib/meal-windows-validation.ts
export type { MealWindows as MealWindowsForm } from "@/lib/meal-kind-local";
import type { MealWindows } from "@/lib/meal-kind-local";

const TIME_PATTERN = /^\d{2}:\d{2}$/;

const ERROR_FORMAT = "시간을 HH:MM 형식으로 입력해주세요";
const ERROR_ORDER = "종료 시간은 시작 시간보다 늦어야 합니다";
const ERROR_OVERLAP = "조식과 석식 시간대가 겹칠 수 없습니다";

// Inlined intentionally — same helper exists in meal-kind.ts and meal-kind-local.ts.
// Keeping each module self-contained to avoid pulling those modules' other exports.
function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateMealWindows(form: MealWindows): string | null {
  const values = [
    form.breakfast.start,
    form.breakfast.end,
    form.dinner.start,
    form.dinner.end,
  ];
  if (values.some((value) => !TIME_PATTERN.test(value))) {
    return ERROR_FORMAT;
  }

  const bfStart = toMinutes(form.breakfast.start);
  const bfEnd = toMinutes(form.breakfast.end);
  const dnStart = toMinutes(form.dinner.start);
  const dnEnd = toMinutes(form.dinner.end);

  if (bfStart >= bfEnd || dnStart >= dnEnd) {
    return ERROR_ORDER;
  }

  if (bfEnd > dnStart && bfStart < dnEnd) {
    return ERROR_OVERLAP;
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
