"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Sun, UtensilsCrossed, Moon, ChevronDown } from "lucide-react";
import type { Meal, MealResponse } from "@/lib/neis-meal";
import { ALLERGY_MAP } from "@/lib/neis-meal";

function toKSTDate(d: Date = new Date()): Date {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return new Date(kst.toISOString().slice(0, 10) + "T00:00:00");
}

function formatDateKR(date: Date): string {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = days[date.getDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}

function toYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const MEAL_CONFIG: Record<string, { icon: typeof Sun; label: string; gradient: string; darkBg: string }> = {
  "3": {
    icon: Moon,
    label: "석식",
    gradient: "from-indigo-500 to-indigo-600",
    darkBg: "dark:from-indigo-900 dark:to-indigo-800",
  },
  "2": {
    icon: UtensilsCrossed,
    label: "중식",
    gradient: "from-green-500 to-green-600",
    darkBg: "dark:from-green-900 dark:to-green-800",
  },
  "1": {
    icon: Sun,
    label: "조식",
    gradient: "from-amber-500 to-amber-600",
    darkBg: "dark:from-amber-900 dark:to-amber-800",
  },
};

const MEAL_ORDER = ["3", "2", "1"];

export function MealMenu() {
  const [date, setDate] = useState<Date>(() => toKSTDate());
  const [data, setData] = useState<MealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (d: Date) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meals?date=${toYYYYMMDD(d)}`);
      const json: MealResponse = await res.json();
      setData(json);
    } catch {
      setData({ success: false, date: toYYYYMMDD(d), meals: [], error: "급식 정보를 불러올 수 없습니다" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(date);
  }, [date, fetchData]);

  function goNext() { setDate((d) => addDays(d, 1)); }
  function goPrev() { setDate((d) => addDays(d, -1)); }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  }

  function handleTouchMove(e: React.TouchEvent) {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  }

  function handleTouchEnd() {
    if (touchDeltaX.current > 50) goPrev();
    else if (touchDeltaX.current < -50) goNext();
    touchDeltaX.current = 0;
  }

  const sortedMeals = data?.meals
    ? MEAL_ORDER
        .map((code) => data.meals.find((m) => m.type === code))
        .filter((m): m is Meal => !!m)
    : [];

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-4"
    >
      {/* 날짜 헤더 */}
      <div className="flex items-center justify-between px-2">
        <button
          onClick={goPrev}
          className="p-2 rounded-full hover:bg-muted transition-colors"
          aria-label="이전 날짜"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold">{formatDateKR(date)}</h2>
        <button
          onClick={goNext}
          className="p-2 rounded-full hover:bg-muted transition-colors"
          aria-label="다음 날짜"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-muted/50 h-40 animate-pulse" />
          ))}
        </div>
      )}

      {/* 에러 */}
      {!loading && data && !data.success && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{data.error || "급식 정보를 불러올 수 없습니다"}</p>
          <p className="text-sm mt-1">잠시 후 다시 시도해주세요</p>
        </div>
      )}

      {/* 데이터 없음 */}
      {!loading && data?.success && sortedMeals.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{data.message || "급식 정보가 없습니다"}</p>
        </div>
      )}

      {/* 식사 카드들 */}
      {!loading && data?.success && sortedMeals.map((meal) => (
        <MealCard key={meal.type} meal={meal} />
      ))}
    </div>
  );
}

function MealCard({ meal }: { meal: Meal }) {
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const config = MEAL_CONFIG[meal.type] || MEAL_CONFIG["3"];
  const Icon = config.icon;

  return (
    <div className="rounded-2xl overflow-hidden border border-border/30 bg-card shadow-sm">
      {/* 헤더 */}
      <div className={`bg-gradient-to-r ${config.gradient} ${config.darkBg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white">
          <Icon className="h-4 w-4" />
          <span className="font-semibold text-sm">{config.label}</span>
        </div>
        {meal.calories && (
          <span className="text-white/80 text-xs">{meal.calories}</span>
        )}
      </div>

      {/* 메뉴 목록 */}
      <div className="px-4 py-3 space-y-1.5">
        {meal.dishes.length === 0 ? (
          <p className="text-sm text-muted-foreground">메뉴 정보가 없습니다</p>
        ) : (
          meal.dishes.map((dish, i) => (
            <div key={i} className="flex items-center gap-2 text-sm min-w-0">
              <span className="whitespace-nowrap shrink-0">{dish.name}</span>
              {dish.allergies.length > 0 && (
                <div className="flex gap-1 overflow-x-auto min-w-0 scrollbar-hide">
                  {dish.allergies.map((code) => (
                    <span
                      key={code}
                      className="inline-block px-1.5 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground leading-none whitespace-nowrap shrink-0"
                      title={ALLERGY_MAP[code] || code}
                    >
                      {ALLERGY_MAP[code] || code}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 영양 정보 토글 */}
      {meal.nutrition.length > 0 && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setNutritionOpen((v) => !v)}
            className="w-full px-4 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
          >
            <span>영양 정보</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${nutritionOpen ? "rotate-180" : ""}`} />
          </button>
          {nutritionOpen && (
            <div className="px-4 pb-3 text-xs text-muted-foreground space-y-0.5">
              {meal.nutrition.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
