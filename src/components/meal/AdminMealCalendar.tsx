"use client";

import { formatMonthDateKey, getDaysInMonthUtc } from "@/lib/date-range";
import { WEEKDAY_LABELS, weekdayOf, type MealKind } from "@/lib/meal-plan";
import { MEAL_THEME } from "./meal-ui";

const GRADES = [1, 2, 3] as const;

interface AdminMealCalendarProps {
  year: number;
  month: number;
  mealKind: MealKind;
  /** `${grade}:${YYYY-MM-DD}` 형태 키 */
  checked: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}

function gradeKey(grade: number, dateKey: string) {
  return `${grade}:${dateKey}`;
}

export default function AdminMealCalendar({
  year,
  month,
  mealKind,
  checked,
  onChange,
  disabled = false,
}: AdminMealCalendarProps) {
  const theme = MEAL_THEME[mealKind];
  const daysInMonth = getDaysInMonthUtc(year, month);

  // 달의 모든 날짜 키 목록
  const allDateKeys = Array.from({ length: daysInMonth }, (_, i) =>
    formatMonthDateKey(year, month, i + 1),
  );

  // 달 전체 키 목록 (날짜×학년)
  const allMonthKeys = allDateKeys.flatMap((dk) =>
    GRADES.map((g) => gradeKey(g, dk)),
  );

  // 특정 요일(0=일~6=토)에 해당하는 날짜 키들
  function dateKeysOfWeekday(wd: number) {
    return allDateKeys.filter((dk) => weekdayOf(dk) === wd);
  }

  // 특정 요일의 모든 (날짜×학년) 키
  function allKeysOfWeekday(wd: number) {
    return dateKeysOfWeekday(wd).flatMap((dk) => GRADES.map((g) => gradeKey(g, dk)));
  }

  // 특정 요일×학년 모든 키
  function allKeysOfWeekdayGrade(wd: number, grade: number) {
    return dateKeysOfWeekday(wd).map((dk) => gradeKey(grade, dk));
  }

  function isAllChecked(keys: string[]) {
    return keys.length > 0 && keys.every((k) => checked.has(k));
  }

  function toggle(keys: string[]) {
    const next = new Set(checked);
    if (isAllChecked(keys)) {
      keys.forEach((k) => next.delete(k));
    } else {
      keys.forEach((k) => next.add(k));
    }
    onChange(next);
  }

  // 달력 주(week) 빌드: 첫날 요일에 맞춰 null 패딩
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const totalCells = firstWeekday + daysInMonth;
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

  const monthLabel = `${year}년 ${String(month).padStart(2, "0")}월 급식일 선택`;

  return (
    <div className={`overflow-x-auto rounded-xl ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <table className="border-collapse text-sm">
        <thead>
          {/* 캡션 행 */}
          <tr>
            <th
              colSpan={7 * 3}
              className={`px-3 py-2 text-center font-semibold ${theme.head} ${theme.text}`}
            >
              <span className="inline-flex items-center gap-3 whitespace-nowrap">
                {monthLabel}
                <label className="inline-flex items-center gap-1 cursor-pointer font-normal text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={isAllChecked(allMonthKeys)}
                    onChange={() => toggle(allMonthKeys)}
                  />
                  전체
                </label>
              </span>
            </th>
          </tr>

          {/* 요일 헤더 행 */}
          <tr>
            {WEEKDAY_LABELS.map((label, wd) => {
              const wdKeys = allKeysOfWeekday(wd);
              return (
                <th
                  key={wd}
                  colSpan={3}
                  className={`px-1 py-1 text-center whitespace-nowrap border border-border/30 ${theme.head}`}
                >
                  <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer min-h-9 justify-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isAllChecked(wdKeys)}
                      onChange={() => toggle(wdKeys)}
                      disabled={wdKeys.length === 0}
                    />
                    <span className={`text-xs font-medium whitespace-nowrap ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : ""}`}>
                      {label}
                    </span>
                  </label>
                </th>
              );
            })}
          </tr>

          {/* 학년 행 (요일별 ×3학년 버튼) */}
          <tr>
            {WEEKDAY_LABELS.map((_, wd) => (
              GRADES.map((grade) => {
                const keys = allKeysOfWeekdayGrade(wd, grade);
                return (
                  <th
                    key={`${wd}-${grade}`}
                    className={`px-0.5 py-0.5 text-center whitespace-nowrap border border-border/30 ${theme.head}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(keys)}
                      disabled={keys.length === 0}
                      className={`min-h-9 w-full px-1 text-xs rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors whitespace-nowrap ${theme.text} disabled:opacity-30`}
                      title={`${["일","월","화","수","목","금","토"][wd]}요일 ${grade}학년 전체 토글`}
                    >
                      ⬇ {grade}
                    </button>
                  </th>
                );
              })
            ))}
          </tr>
        </thead>

        <tbody>
          {weeks.map((week, wi) => (
            /* 주마다 2행: 날짜 숫자 행 + 체크박스 행 */
            <>
              {/* 날짜 숫자 행 */}
              <tr key={`w${wi}-date`}>
                {week.map((day, di) => {
                  const dateKey = day ? formatMonthDateKey(year, month, day) : null;
                  const wd = di; // di == 요일 인덱스 (0=일)
                  return (
                    <td
                      key={di}
                      colSpan={3}
                      className={`px-1 py-0.5 text-center whitespace-nowrap border border-border/30 text-xs font-medium
                        ${day ? theme.cell : "bg-muted/20"}
                        ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-500" : ""}
                      `}
                    >
                      {day ?? ""}
                    </td>
                  );
                })}
              </tr>

              {/* 체크박스 행 */}
              <tr key={`w${wi}-check`}>
                {week.map((day, di) => {
                  if (!day) {
                    return (
                      <>
                        {GRADES.map((g) => (
                          <td
                            key={g}
                            className="border border-border/30 bg-muted/20"
                          />
                        ))}
                      </>
                    );
                  }
                  const dateKey = formatMonthDateKey(year, month, day);
                  return (
                    <>
                      {GRADES.map((grade) => {
                        const k = gradeKey(grade, dateKey);
                        return (
                          <td
                            key={grade}
                            className={`px-0.5 py-0.5 text-center whitespace-nowrap border border-border/30 ${theme.cell}`}
                          >
                            <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={checked.has(k)}
                                onChange={() => {
                                  const next = new Set(checked);
                                  if (next.has(k)) next.delete(k);
                                  else next.add(k);
                                  onChange(next);
                                }}
                              />
                              <span className={`text-[10px] leading-none whitespace-nowrap ${theme.text}`}>
                                {grade}
                              </span>
                            </label>
                          </td>
                        );
                      })}
                    </>
                  );
                })}
              </tr>
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
