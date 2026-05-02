"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DateMultiPickerProps {
  value: Set<string>;
  onChange: (value: Set<string>) => void;
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DateMultiPicker({ value, onChange }: DateMultiPickerProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const days = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    return [
      ...Array.from({ length: firstDay }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
  }, [year, month]);

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const toggle = (day: number) => {
    const key = dateKey(year, month, day);
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold">{year}년 {month}월</p>
        <Button type="button" variant="ghost" size="icon" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <div key={day} className="py-1 text-muted-foreground">{day}</div>
        ))}
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} />;
          const key = dateKey(year, month, day);
          const selected = value.has(key);
          return (
            <button
              type="button"
              key={key}
              onClick={() => toggle(day)}
              className={`min-h-11 rounded-md border text-sm ${
                selected ? "border-purple-500 bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-100" : "hover:bg-muted"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">선택 {value.size}일</p>
    </div>
  );
}
