const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatMonthDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getDaysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateKeyToUtcDate(dateKey: string): Date {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return date;
}

export function buildMonthDateRange(year: number, month: number): {
  startDate: Date;
  endDate: Date;
  daysInMonth: number;
} {
  const daysInMonth = getDaysInMonthUtc(year, month);

  return {
    startDate: dateKeyToUtcDate(formatMonthDateKey(year, month, 1)),
    endDate: dateKeyToUtcDate(formatMonthDateKey(year, month, daysInMonth)),
    daysInMonth,
  };
}
