export type BreakfastValidationResult =
  | { ok: true; dates: string[] }
  | { ok: false; code: "INVALID_DATES" };

export function validateSelectedDates(
  selectedDates: string[],
  allowedDates: string[],
): BreakfastValidationResult {
  const uniqueDates = Array.from(new Set(selectedDates));
  if (uniqueDates.length === 0) {
    return { ok: false, code: "INVALID_DATES" };
  }

  const allowedSet = new Set(allowedDates);
  if (uniqueDates.some((date) => !allowedSet.has(date))) {
    return { ok: false, code: "INVALID_DATES" };
  }

  return { ok: true, dates: uniqueDates };
}
