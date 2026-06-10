"use client";

import { getDaysInMonthUtc, formatMonthDateKey } from "@/lib/date-range";
import { WEEKDAY_LABELS, weekdayOf } from "@/lib/meal-plan";
import { MEAL_THEME, OPEN_DATE_BG } from "./meal-ui";
import type { MealKind } from "@/lib/meal-plan";

interface StudentMealCalendarProps {
  year: number;
  month: number;
  mealKind: MealKind;
  openDates: Set<string>;
  mode: "readonly" | "weekday" | "date";
  selectedDates: Set<string>;
  selectedWeekdays?: Set<number>;
  onToggleDate?: (date: string) => void;
  onToggleWeekday?: (weekday: number) => void;
}

export function StudentMealCalendar({
  year,
  month,
  mealKind,
  openDates,
  mode,
  selectedDates,
  selectedWeekdays,
  onToggleDate,
  onToggleWeekday,
}: StudentMealCalendarProps) {
  const theme = MEAL_THEME[mealKind];
  const daysInMonth = getDaysInMonthUtc(year, month);

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  // 이 달에 속하는 개설일만 필터
  const monthOpenDates = new Set<string>(
    [...openDates].filter((d) => d.startsWith(monthStr)),
  );

  // 요일별로 개설일이 있는지 확인
  const weekdaysWithOpenDates = new Set<number>(
    [...monthOpenDates].map(weekdayOf),
  );

  // 달력 주 빌드
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const weeks: (number | null)[][] = [];
  let current: (number | null)[] = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    weeks.push(current);
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm w-full">
        <thead>
          {/* 월 캡션 */}
          <tr>
            <th
              colSpan={7}
              className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${theme.head} ${theme.text}`}
            >
              {year}년 {String(month).padStart(2, "0")}월
            </th>
          </tr>
          {/* 요일 헤더 */}
          <tr>
            {WEEKDAY_LABELS.map((label, wd) => {
              const hasOpen = weekdaysWithOpenDates.has(wd);
              const isSelected = selectedWeekdays?.has(wd) ?? false;
              return (
                <th
                  key={wd}
                  className={`px-1 py-1 text-center whitespace-nowrap border border-border/30 ${theme.head}`}
                >
                  {mode === "weekday" ? (
                    <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer min-h-11 justify-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={isSelected}
                        disabled={!hasOpen}
                        onChange={() => hasOpen && onToggleWeekday?.(wd)}
                      />
                      <span
                        className={`text-xs font-medium ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : ""}`}
                      >
                        {label}
                      </span>
                    </label>
                  ) : (
                    <span
                      className={`text-xs font-medium ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : ""}`}
                    >
                      {label}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (!day) {
                  return (
                    <td
                      key={di}
                      className="border border-border/30 bg-muted/20 py-1"
                    />
                  );
                }
                const dateKey = formatMonthDateKey(year, month, day);
                const isOpen = monthOpenDates.has(dateKey);
                const isSelected = selectedDates.has(dateKey);

                const cellBg = isSelected
                  ? `${OPEN_DATE_BG} ring-2 ring-inset ring-amber-400 dark:ring-amber-500`
                  : isOpen
                    ? OPEN_DATE_BG
                    : "";

                return (
                  <td
                    key={di}
                    className={`px-0.5 py-1 text-center whitespace-nowrap border border-border/30 ${cellBg}`}
                  >
                    {mode === "date" && isOpen ? (
                      <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer min-h-11 justify-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={isSelected}
                          onChange={() => onToggleDate?.(dateKey)}
                        />
                        <span
                          className={`text-xs font-medium ${di === 0 ? "text-red-500" : di === 6 ? "text-blue-500" : ""}`}
                        >
                          {day}
                        </span>
                      </label>
                    ) : (
                      <span
                        className={`text-xs font-medium block min-h-11 flex items-center justify-center ${di === 0 ? "text-red-500" : di === 6 ? "text-blue-500" : ""}`}
                      >
                        {day}
                        {isSelected && mode !== "date" && (
                          <span className="ml-0.5 text-amber-600 dark:text-amber-400">✓</span>
                        )}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
