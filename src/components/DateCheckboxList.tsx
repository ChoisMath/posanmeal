"use client";

import { Button } from "@/components/ui/button";

interface DateCheckboxListProps {
  dates: string[];
  value: Set<string>;
  onChange: (value: Set<string>) => void;
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

export function DateCheckboxList({ dates, value, onChange }: DateCheckboxListProps) {
  const toggle = (date: string) => {
    const next = new Set(value);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(new Set(dates))}>
          전체 선택
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(new Set())}>
          전체 해제
        </Button>
        <span className="ml-auto text-xs text-muted-foreground self-center">
          선택 {value.size}일
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {dates.map((date) => (
          <label
            key={date}
            className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={value.has(date)}
              onChange={() => toggle(date)}
              className="h-4 w-4"
            />
            <span>{formatDate(date)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
