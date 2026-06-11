"use client";

import { useCallback, useState, type ReactNode } from "react";
import { StudentMealCalendar } from "./StudentMealCalendar";
import { MEAL_THEME } from "./meal-ui";
import {
  MEAL_LABEL,
  METHOD_LABEL,
  monthsOf,
  monthKeyOf,
  weekdayOf,
  calcMealFee,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

// 서버(resolveRegistrationSelections)와 동일하게 월별 요일 선택을 날짜로 전개
function expandWeekdaysPerMonth(
  openDates: string[],
  weekdays: Record<string, Set<number>>,
): string[] {
  return openDates
    .filter((d) => weekdays[monthKeyOf(d)]?.has(weekdayOf(d)) ?? false)
    .sort();
}

export interface ApplyFormMeal {
  mealKind: MealKind;
  price: number;
  exemptionSelectable: boolean;
  method: MealApplyMethod;
  openDates: string[];
}

export interface ApplyFormApplication {
  startYear: number;
  startMonth: number;
  monthCount: number;
  meals: ApplyFormMeal[];
}

export interface InitialRegistrationMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  weekdaysByMonth: Record<string, number[]> | null;
  selectedDates: string[];
}

export interface RegistrationMealBody {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  selectedDates?: string[];
  weekdaysByMonth?: Record<string, number[]>;
}

interface MealState {
  applied: boolean;
  exempt: boolean;
  dates: Set<string>;
  weekdays: Record<string, Set<number>>;
}

function buildInitialMealState(
  meal: ApplyFormMeal,
  existing?: InitialRegistrationMeal,
): MealState {
  if (!existing) {
    return {
      applied: meal.method === "YN",
      exempt: false,
      dates: new Set(),
      weekdays: {},
    };
  }

  const weekdays: Record<string, Set<number>> = {};
  if (existing.weekdaysByMonth) {
    for (const [mk, wds] of Object.entries(existing.weekdaysByMonth)) {
      weekdays[mk] = new Set(wds);
    }
  }

  return {
    applied: existing.applied,
    exempt: existing.exempt,
    dates: new Set(existing.selectedDates),
    weekdays,
  };
}

interface ApplicationApplyFormProps {
  application: ApplyFormApplication;
  initialMeals?: InitialRegistrationMeal[];
  disabled?: boolean;
  footer: (ctx: {
    buildMealsBody: () => RegistrationMealBody[];
    totalFee: number;
  }) => ReactNode;
}

export function ApplicationApplyForm({
  application,
  initialMeals,
  disabled = false,
  footer,
}: ApplicationApplyFormProps) {
  const [mealStates, setMealStates] = useState<Record<string, MealState>>(() => {
    const states: Record<string, MealState> = {};
    for (const meal of application.meals) {
      const existing = initialMeals?.find((m) => m.mealKind === meal.mealKind);
      states[meal.mealKind] = buildInitialMealState(meal, existing);
    }
    return states;
  });

  const updateMealState = useCallback(
    (kind: MealKind, patch: Partial<MealState>) => {
      setMealStates((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], ...patch },
      }));
    },
    [],
  );

  const handleToggleDate = useCallback((kind: MealKind, dateKey: string) => {
    setMealStates((prev) => {
      const cur = prev[kind];
      const next = new Set(cur.dates);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return { ...prev, [kind]: { ...cur, dates: next } };
    });
  }, []);

  const handleToggleWeekday = useCallback(
    (kind: MealKind, monthKey: string, weekday: number) => {
      setMealStates((prev) => {
        const cur = prev[kind];
        const monthWds = new Set(cur.weekdays[monthKey] ?? []);
        if (monthWds.has(weekday)) monthWds.delete(weekday);
        else monthWds.add(weekday);
        return {
          ...prev,
          [kind]: {
            ...cur,
            weekdays: { ...cur.weekdays, [monthKey]: monthWds },
          },
        };
      });
    },
    [],
  );

  const buildMealsBody = useCallback((): RegistrationMealBody[] => {
    return application.meals.map((meal) => {
      const st = mealStates[meal.mealKind];
      if (!st) return { mealKind: meal.mealKind, applied: false, exempt: false };

      if (meal.method === "YN") {
        return {
          mealKind: meal.mealKind,
          applied: st.applied,
          exempt: st.exempt,
        };
      }

      if (meal.method === "WEEKDAY") {
        const weekdaysByMonth: Record<string, number[]> = {};
        for (const [mk, wds] of Object.entries(st.weekdays)) {
          weekdaysByMonth[mk] = [...wds];
        }
        return {
          mealKind: meal.mealKind,
          applied: Object.values(weekdaysByMonth).some((wds) => wds.length > 0),
          exempt: st.exempt,
          weekdaysByMonth,
        };
      }

      if (meal.method === "DATE") {
        return {
          mealKind: meal.mealKind,
          applied: st.dates.size > 0,
          exempt: st.exempt,
          selectedDates: [...st.dates].sort(),
        };
      }

      return { mealKind: meal.mealKind, applied: false, exempt: false };
    });
  }, [application.meals, mealStates]);

  const months = monthsOf(application.startYear, application.startMonth, application.monthCount);

  let totalFee = 0;
  for (const meal of application.meals) {
    const st = mealStates[meal.mealKind];
    if (!st || !st.applied) continue;
    let dayCount = 0;
    if (meal.method === "YN") {
      dayCount = meal.openDates.length;
    } else if (meal.method === "DATE") {
      dayCount = st.dates.size;
    } else if (meal.method === "WEEKDAY") {
      dayCount = expandWeekdaysPerMonth(meal.openDates, st.weekdays).length;
    }
    totalFee += calcMealFee(meal.price, dayCount, st.exempt);
  }

  return (
    <div className="space-y-3">
      {application.meals.map((meal) => {
        const theme = MEAL_THEME[meal.mealKind];
        const st = mealStates[meal.mealKind];
        if (!st) return null;

        const openDatesSet = new Set(meal.openDates);

        let dayCount = 0;
        let derivedSelectedDates = new Set<string>();

        if (meal.method === "YN") {
          dayCount = st.applied ? meal.openDates.length : 0;
          if (st.applied) derivedSelectedDates = openDatesSet;
        } else if (meal.method === "DATE") {
          dayCount = st.dates.size;
          derivedSelectedDates = st.dates;
        } else if (meal.method === "WEEKDAY") {
          const expanded = expandWeekdaysPerMonth(meal.openDates, st.weekdays);
          dayCount = expanded.length;
          derivedSelectedDates = new Set(expanded);
        }

        const fee = calcMealFee(meal.price, dayCount, st.exempt);

        return (
          <div key={meal.mealKind} className="card-elevated rounded-2xl border-0 overflow-hidden">
            {/* 섹션 헤더 */}
            <div className={`px-4 py-3 flex flex-wrap items-center gap-2 ${theme.side}`}>
              <span className={`font-semibold text-sm whitespace-nowrap ${theme.text}`}>
                {MEAL_LABEL[meal.mealKind]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${theme.head} ${theme.text}`}>
                {METHOD_LABEL[meal.method]}
              </span>
              {meal.method === "YN" && (
                <div className="flex items-center gap-3 ml-auto">
                  <label className={`min-h-11 inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={st.applied}
                      disabled={disabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: true })}
                      className="h-4 w-4"
                    />
                    신청함
                  </label>
                  <label className={`min-h-11 inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={!st.applied}
                      disabled={disabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: false })}
                      className="h-4 w-4"
                    />
                    신청안함
                  </label>
                </div>
              )}
            </div>

            <div className={`p-3 space-y-3 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
              {/* 달력 */}
              {months.map(({ year, month }) => {
                const mk = `${year}-${String(month).padStart(2, "0")}`;
                const selectedWdsForMonth = st.weekdays[mk] ?? new Set<number>();

                return (
                  <StudentMealCalendar
                    key={mk}
                    year={year}
                    month={month}
                    mealKind={meal.mealKind}
                    openDates={openDatesSet}
                    mode={
                      meal.method === "WEEKDAY"
                        ? "weekday"
                        : meal.method === "DATE"
                          ? "date"
                          : "readonly"
                    }
                    selectedDates={derivedSelectedDates}
                    selectedWeekdays={selectedWdsForMonth}
                    onToggleDate={(d) => handleToggleDate(meal.mealKind, d)}
                    onToggleWeekday={(wd) => handleToggleWeekday(meal.mealKind, mk, wd)}
                  />
                );
              })}

              {/* 면제 체크박스 */}
              {meal.exemptionSelectable && (
                <label className="min-h-11 inline-flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={st.exempt}
                    onChange={(e) => updateMealState(meal.mealKind, { exempt: e.target.checked })}
                  />
                  <span className="whitespace-nowrap">면제 대상입니다</span>
                </label>
              )}

              {/* 금액 줄 */}
              <p className="text-sm font-medium whitespace-nowrap">
                총 급식비 : {fee.toLocaleString()}원
                {meal.method !== "YN" && (
                  <span className="text-muted-foreground font-normal">
                    {" "}({meal.price.toLocaleString()}원×{dayCount}일)
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}

      {/* 합계 + footer (서명/안내 + 버튼은 호출측이 렌더링) */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-4">
        <p className="text-base font-bold whitespace-nowrap">
          총 납부 금액 : {totalFee.toLocaleString()}원
        </p>
        {footer({ buildMealsBody, totalFee })}
      </div>
    </div>
  );
}
