"use client";

import { useState, useMemo, useRef, type TouchEvent } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCheckins } from "@/hooks/useCheckins";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
  mealKind?: "BREAKFAST" | "LUNCH" | "DINNER" | null;
}

interface MonthlyCalendarProps {
  showType?: boolean;
  teacherCalendar?: boolean;
}

export function MonthlyCalendar({ showType = false, teacherCalendar = false }: MonthlyCalendarProps) {
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const [showWeekends, setShowWeekends] = useState(!teacherCalendar);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { checkIns, error } = useCheckins(year, month);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const cancelSwipe = () => { swipeStart.current = null; };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      cancelSwipe();
      return;
    }
    const touch = event.touches[0];
    swipeStart.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    if (!start) return;
    if (event.touches.length !== 1) {
      cancelSwipe();
      return;
    }
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);
    if (dy > 10 && dy >= dx) cancelSwipe();
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    cancelSwipe();
    if (!start || event.touches.length > 0) return;
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
    if (dx < 0) nextMonth();
    else prevMonth();
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const hideWeekends = teacherCalendar && !showWeekends;
  const dayNames = hideWeekends ? ["월", "화", "수", "목", "금"] : ["일", "월", "화", "수", "목", "금", "토"];
  const weekCount = Math.ceil((firstDayOfWeek + daysInMonth) / 7);
  const calendarDays = Array.from({ length: weekCount }, (_, week) => {
    const days = Array.from({ length: 7 }, (_, weekday) => {
      const day = week * 7 + weekday - firstDayOfWeek + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    });
    const visibleDays = hideWeekends ? days.slice(1, 6) : days;
    return visibleDays.some((day) => day !== null) ? visibleDays : [];
  }).flat();
  const displayedDays = teacherCalendar
    ? calendarDays
    : [...Array<null>(firstDayOfWeek).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const weekendText = (weekday: number) => !teacherCalendar ? "" : weekday === 0
    ? "text-red-600 dark:text-red-400"
    : weekday === 6 ? "text-blue-600 dark:text-blue-400" : "";

  interface DaySlot { breakfast?: CheckInRecord; lunch?: CheckInRecord; dinner?: CheckInRecord }
  const checkInMap = useMemo(() => {
    const map = new Map<string, DaySlot>();
    checkIns.forEach((c) => {
      const key = c.date.slice(0, 10);
      const slot = map.get(key) ?? {};
      if (c.mealKind === "BREAKFAST") slot.breakfast = c;
      else if (c.mealKind === "LUNCH") slot.lunch = c;
      else slot.dinner = c;
      map.set(key, slot);
    });
    return map;
  }, [checkIns]);

  const getDaySlot = (day: number): DaySlot | undefined => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return checkInMap.get(dateStr);
  };

  const formatTime = (checkedAt: string) => {
    const d = new Date(checkedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground text-sm mb-2">데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div>
      <div className={teacherCalendar ? "mb-2 overflow-x-auto" : "mb-4"}>
        <div className={teacherCalendar ? "flex min-w-max items-center gap-2" : "flex items-center justify-between"}>
          <Button variant="ghost" size="icon" className={teacherCalendar ? "min-h-11 min-w-11 shrink-0" : undefined} aria-label="이전 달" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="font-semibold whitespace-nowrap">{year}년 {month}월</h3>
          <Button variant="ghost" size="icon" className={teacherCalendar ? "min-h-11 min-w-11 shrink-0" : undefined} aria-label="다음 달" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {teacherCalendar && (
            <Button variant={showWeekends ? "default" : "outline"} size="sm" className="ml-auto min-h-11 min-w-11 shrink-0 whitespace-nowrap px-2" aria-pressed={showWeekends} title={showWeekends ? "주말 숨기기" : "주말 표시"} onClick={() => setShowWeekends((visible) => !visible)}>
              주말
            </Button>
          )}
        </div>
      </div>
      <div
        onTouchStart={teacherCalendar ? handleTouchStart : undefined}
        onTouchMove={teacherCalendar ? handleTouchMove : undefined}
        onTouchEnd={teacherCalendar ? handleTouchEnd : undefined}
        onTouchCancel={teacherCalendar ? cancelSwipe : undefined}
        style={teacherCalendar ? { gridTemplateRows: `auto repeat(${displayedDays.length / (hideWeekends ? 5 : 7)}, minmax(104px, 1fr))` } : undefined}
        className={`grid text-center text-xs ${hideWeekends ? "grid-cols-5" : "grid-cols-7"} ${teacherCalendar ? "touch-pan-y touch-pinch-zoom border-l border-t border-stone-200 dark:border-zinc-700" : "gap-1"}`}
      >
        {dayNames.map((d, i) => {
          const weekday = hideWeekends ? i + 1 : i;
          const headerBg = !teacherCalendar ? "" : weekday === 0
            ? "bg-red-50 dark:bg-red-950"
            : weekday === 6 ? "bg-blue-50 dark:bg-blue-950" : "bg-stone-100 dark:bg-zinc-800";
          return (
            <div key={d} className={`font-semibold py-1 ${teacherCalendar ? "border-r border-b border-stone-200 dark:border-zinc-700" : ""} ${headerBg} ${weekendText(weekday) || "text-muted-foreground"}`}>{d}</div>
          );
        })}
        {displayedDays.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} aria-hidden="true" className={teacherCalendar ? "border-r border-b border-stone-200 dark:border-zinc-700" : undefined} />;
          const slot = getDaySlot(day);
          const dinner = slot?.dinner;
          const lunch = slot?.lunch;
          const breakfast = slot?.breakfast;
          const primary = dinner ?? lunch ?? breakfast;
          const cellBg = !primary
            ? ""
            : primary.type === "WORK"
              ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
              : "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
          return (
            <div key={day} data-calendar-day={day} className={`py-2 text-sm ${teacherCalendar ? "min-w-0 px-1.5 border-r border-b border-stone-200 dark:border-zinc-700" : "rounded-md"} ${cellBg}`}>
              <div className={`${teacherCalendar ? "text-left text-lg font-medium leading-6" : ""} ${weekendText(new Date(year, month - 1, day).getDay())}`}>{day}</div>
              {breakfast && (
                <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {showType && <span className={teacherCalendar ? "block" : undefined}>조식 </span>}<span className="whitespace-nowrap">{formatTime(breakfast.checkedAt)}</span>
                </div>
              )}
              {lunch && (
                <div className="text-[10px] font-medium text-orange-600 dark:text-orange-400">
                  {showType && <span className={teacherCalendar ? "block" : undefined}>중식 </span>}<span className="whitespace-nowrap">{formatTime(lunch.checkedAt)}</span>
                </div>
              )}
              {dinner && (
                <div className={`text-[10px] font-medium ${dinner.type === "WORK" ? "text-blue-600 dark:text-blue-400" : "text-emerald-700 dark:text-emerald-300"}`}>
                  {showType && <span className={teacherCalendar ? "block" : undefined}>{dinner.type === "WORK" ? "근무 " : "석식 "}</span>}<span className="whitespace-nowrap">{formatTime(dinner.checkedAt)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
