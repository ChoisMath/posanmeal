"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/SignaturePad";
import { StudentMealCalendar } from "./StudentMealCalendar";
import { MEAL_THEME } from "./meal-ui";
import {
  MEAL_LABEL,
  METHOD_LABEL,
  monthsOf,
  monthKeyOf,
  expandWeekdays,
  calcMealFee,
  studentNumberOf,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";
import { useUser } from "@/hooks/useUser";

interface ApplicationMeal {
  mealKind: MealKind;
  price: number;
  exemptionSelectable: boolean;
  method: MealApplyMethod;
  openDates: string[];
}

interface ApplicationDetail {
  id: number;
  title: string;
  description: string | null;
  startYear: number;
  startMonth: number;
  monthCount: number;
  applyStartAt: string;
  applyEndAt: string;
  status: string;
  meals: ApplicationMeal[];
}

interface MyRegistrationMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  weekdaysByMonth: Record<string, number[]> | null;
  selectedDates: string[];
}

interface MyRegistration {
  status: string;
  meals: MyRegistrationMeal[];
}

// 식사별 UI 상태
interface MealState {
  applied: boolean;
  exempt: boolean;
  // DATE mode
  dates: Set<string>;
  // WEEKDAY mode: monthKey → 선택된 요일 Set
  weekdays: Record<string, Set<number>>;
}

interface StudentApplicationViewProps {
  applicationId: number;
  onBack: () => void;
  onSubmitted: () => void;
}

function formatApplyDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}시${min}분`;
}

function buildInitialMealState(
  meal: ApplicationMeal,
  existing?: MyRegistrationMeal,
): MealState {
  if (!existing) {
    // YN 기본: applied=true
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

export function StudentApplicationView({
  applicationId,
  onBack,
  onSubmitted,
}: StudentApplicationViewProps) {
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [hasExisting, setHasExisting] = useState(false);
  const [mealStates, setMealStates] = useState<Record<string, MealState>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/applications/${applicationId}`);
        if (!res.ok) {
          toast.error("공고를 불러오지 못했습니다.");
          onBack();
          return;
        }
        const json = await res.json();
        const app: ApplicationDetail = json.application;
        const myReg: MyRegistration | null = json.myRegistration;

        setApplication(app);
        setRegistrationCount(json.registrationCount ?? 0);
        setHasExisting(myReg?.status === "APPROVED");

        const states: Record<string, MealState> = {};
        for (const meal of app.meals) {
          const existing = myReg?.meals.find((m) => m.mealKind === meal.mealKind);
          states[meal.mealKind] = buildInitialMealState(meal, existing);
        }
        setMealStates(states);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [applicationId, onBack]);

  const updateMealState = useCallback(
    (kind: MealKind, patch: Partial<MealState>) => {
      setMealStates((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], ...patch },
      }));
    },
    [],
  );

  const handleToggleDate = useCallback(
    (kind: MealKind, dateKey: string) => {
      setMealStates((prev) => {
        const cur = prev[kind];
        const next = new Set(cur.dates);
        if (next.has(dateKey)) next.delete(dateKey);
        else next.add(dateKey);
        return { ...prev, [kind]: { ...cur, dates: next } };
      });
    },
    [],
  );

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

  const handleCancel = async () => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("신청이 취소되었습니다.");
        onSubmitted();
        onBack();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "취소에 실패했습니다.");
      }
    } catch {
      toast.error("취소 중 오류가 발생했습니다.");
    }
  };

  const handleSubmit = async () => {
    if (!signature) {
      toast.error("서명을 입력해주세요.");
      return;
    }
    if (!application) return;

    setSubmitting(true);
    try {
      const mealsBody = application.meals.map((meal) => {
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

      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, meals: mealsBody }),
      });

      if (res.ok) {
        toast.success(
          hasExisting ? "신청이 수정되었습니다." : "신청이 완료되었습니다.",
        );
        onSubmitted();
        onBack();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "신청에 실패했습니다.");
      }
    } catch {
      toast.error("신청 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !application) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    );
  }

  const now = new Date();
  const isApplyOpen =
    application.status === "OPEN" &&
    now >= new Date(application.applyStartAt) &&
    now <= new Date(application.applyEndAt);

  const months = monthsOf(application.startYear, application.startMonth, application.monthCount);

  // 전체 합계 계산
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
      const allWds: number[] = [];
      for (const wds of Object.values(st.weekdays)) allWds.push(...wds);
      const expanded = expandWeekdays(meal.openDates, allWds);
      dayCount = expanded.length;
    }
    totalFee += calcMealFee(meal.price, dayCount, st.exempt);
  }

  const studentNumber =
    user?.grade && user?.classNum && user?.number
      ? studentNumberOf(user.grade, user.classNum, user.number)
      : null;

  return (
    <div className="space-y-3">
      {/* 뒤로가기 버튼 */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm min-h-11"
      >
        <ChevronLeft className="size-4" />
        <span>목록으로</span>
      </button>

      {/* 상단 정보 표 */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-3">
        <h2 className="font-bold text-base whitespace-nowrap">{application.title}</h2>
        {application.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {application.description}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap w-24">신청 기간</td>
                <td className="py-2 font-medium whitespace-nowrap">
                  {formatApplyDateTime(application.applyStartAt)} ~ {formatApplyDateTime(application.applyEndAt)}
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">신청 인원</td>
                <td className="py-2 font-medium whitespace-nowrap">{registrationCount}명</td>
              </tr>
              {user && (
                <>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">이름</td>
                    <td className="py-2 font-medium whitespace-nowrap">{user.name}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">학번</td>
                    <td className="py-2 font-medium whitespace-nowrap">
                      {studentNumber != null ? studentNumber : `${user.grade}학년 ${user.classNum}반 ${user.number}번`}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {!isApplyOpen && (
          <p className="text-sm text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
            {application.status !== "OPEN"
              ? "마감된 공고입니다."
              : "신청 기간이 아닙니다."}
          </p>
        )}
      </div>

      {/* 식사별 섹션 */}
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
          const allWds: number[] = [];
          for (const wds of Object.values(st.weekdays)) allWds.push(...wds);
          const expanded = expandWeekdays(meal.openDates, allWds);
          dayCount = expanded.length;
          derivedSelectedDates = new Set(expanded);
        }

        const fee = calcMealFee(meal.price, dayCount, st.exempt);
        const isDisabled = !isApplyOpen;

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
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={st.applied}
                      disabled={isDisabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: true })}
                      className="h-4 w-4"
                    />
                    신청함
                  </label>
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={!st.applied}
                      disabled={isDisabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: false })}
                      className="h-4 w-4"
                    />
                    신청안함
                  </label>
                </div>
              )}
            </div>

            <div className={`p-3 space-y-3 ${isDisabled ? "opacity-60 pointer-events-none" : ""}`}>
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
                <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
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

      {/* 합계 + 서명 + 버튼 */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-4">
        <p className="text-base font-bold whitespace-nowrap">
          총 납부 금액 : {totalFee.toLocaleString()}원
        </p>

        {isApplyOpen && (
          <>
            <div>
              <p className="text-sm font-medium mb-2">서명</p>
              <SignaturePad onSignatureChange={setSignature} />
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="outline"
                className="rounded-lg min-h-11 whitespace-nowrap"
                onClick={onBack}
              >
                목록으로
              </Button>
              {hasExisting && (
                <Button
                  variant="outline"
                  className="rounded-lg min-h-11 whitespace-nowrap text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={handleCancel}
                >
                  신청 취소
                </Button>
              )}
              <Button
                className="rounded-lg min-h-11 whitespace-nowrap"
                disabled={!signature || submitting}
                onClick={handleSubmit}
              >
                {submitting ? "처리 중..." : hasExisting ? "신청 수정" : "신청하기"}
              </Button>
            </div>
          </>
        )}

        {!isApplyOpen && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="rounded-lg min-h-11 whitespace-nowrap"
              onClick={onBack}
            >
              목록으로
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
