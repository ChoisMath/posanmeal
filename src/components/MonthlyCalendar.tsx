"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCheckins } from "@/hooks/useCheckins";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
  mealKind?: "BREAKFAST" | "DINNER" | null;
}

interface MonthlyCalendarProps {
  showType?: boolean;
}

export function MonthlyCalendar({ showType = false }: MonthlyCalendarProps) {
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

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

  const checkInMap = useMemo(() => {
    const map = new Map<string, CheckInRecord>();
    checkIns.forEach((c) => {
      const key = c.date.slice(0, 10);
      const existing = map.get(key);
      if (!existing || c.mealKind === "BREAKFAST") map.set(key, c);
    });
    return map;
  }, [checkIns]);

  const getCheckIn = (day: number) => {
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
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">{year}년 {month}월</h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {dayNames.map((d) => (
          <div key={d} className="font-semibold py-1 text-muted-foreground">{d}</div>
        ))}
        {Array.from({ length: firstDayOfWeek }, (_, i) => <div key={`empty-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const checkIn = getCheckIn(day);
          return (
            <div key={day} className={`py-2 rounded-md text-sm ${checkIn ? checkIn.type === "WORK" ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200" : "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : ""}`}>
              <div>{day}</div>
              {checkIn && showType && (
                <div className={`text-[10px] font-medium ${checkIn.type === "WORK" ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                  {checkIn.mealKind === "BREAKFAST" ? "조식" : checkIn.type === "WORK" ? "근무" : "석식"}
                </div>
              )}
              {checkIn && <div className="text-[10px] text-muted-foreground">{formatTime(checkIn.checkedAt)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
