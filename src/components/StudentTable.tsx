"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTeacherStudents } from "@/hooks/useTeacherStudents";
import { buildMonthlyMealColumns, getDateDayKey, type MealColumn } from "@/lib/meal-columns";

export function StudentTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { students, mealColumns: fetchedColumns, grade = 0, classNum = 0, error } =
    useTeacherStudents(year, month);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const mealColumns: MealColumn[] =
    fetchedColumns.length > 0 ? fetchedColumns : buildMonthlyMealColumns(year, month);

  const weekendSet = useMemo(() => {
    const set = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) set.add(d);
    }
    return set;
  }, [year, month, daysInMonth]);
  const isWeekend = (day: number) => weekendSet.has(day);

  const dailyTotals = useMemo(
    () =>
      mealColumns.map((col) =>
        students.filter((s) =>
          s.checkIns.some((c) => `${getDateDayKey(c.date)}:${c.mealKind ?? "DINNER"}` === col.key),
        ).length,
      ),
    [students, mealColumns],
  );
  const grandTotal = useMemo(
    () => students.reduce((sum, s) => sum + s.checkIns.length, 0),
    [students],
  );

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
        <h3 className="font-semibold text-fit-base">
          {grade}학년 {classNum}반 — {year}년 {month}월
        </h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-auto max-h-[70vh] border rounded-lg">
        <table className="text-xs border-collapse w-full whitespace-nowrap">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[90px] text-fit-sm">
                번호 이름
              </th>
              {mealColumns.map((column) => {
                const weekend = isWeekend(column.day);
                const mealHeaderClass =
                  column.mealKind === "BREAKFAST"
                    ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                    : column.mealKind === "LUNCH"
                      ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : "bg-muted text-muted-foreground";
                return (
                  <th
                    key={column.key}
                    className={`px-1 py-2 text-center font-medium border-b min-w-[28px] ${
                      weekend
                        ? "bg-red-50 text-red-400 dark:bg-red-950 dark:text-red-400"
                        : mealHeaderClass
                    }`}
                    title={column.label}
                  >
                    <span>{column.day}</span>
                    <span className="block text-[10px] leading-none opacity-70">{column.shortLabel}</span>
                  </th>
                );
              })}
              <th className="sticky right-0 z-30 bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b border-l min-w-[44px] text-fit-sm">
                합계
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const checkInMap = new Map(
                student.checkIns.map((c) => [`${getDateDayKey(c.date)}:${c.mealKind ?? "DINNER"}`, c]),
              );
              const appliedSet = new Set(student.appliedDates.map((a) => `${a.date}:${a.mealKind}`));
              return (
                <tr key={student.id} className="hover:bg-muted/50">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <div className="flex items-center gap-1 text-fit-sm">
                      <span className="font-semibold">{student.number}</span>
                      <span>{student.name}</span>
                    </div>
                  </td>
                  {mealColumns.map((column) => {
                    const checkIn = checkInMap.get(column.key);
                    const applied = appliedSet.has(column.key);
                    // 신청 칸=흰색 / 미신청 칸=뚜렷한 회색 음영 (칸 단위 판정: column.key = 날짜:식사)
                    const cellClass = checkIn
                      ? column.mealKind === "BREAKFAST"
                        ? "bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 font-bold"
                        : column.mealKind === "LUNCH"
                          ? "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 font-bold"
                          : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                      : applied
                        ? "bg-white dark:bg-zinc-950"
                        : "bg-stone-300/80 dark:bg-zinc-700/70";
                    return (
                      <td
                        key={column.key}
                        className={`text-center border-b px-0.5 py-1.5 ${cellClass}`}
                        title={
                          checkIn
                            ? `${column.label} ${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                            : applied
                              ? `${column.label} 신청`
                              : `${column.label} 미신청`
                        }
                      >
                        {checkIn ? "O" : ""}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-background text-center border-b border-l px-2 py-1.5 font-medium">
                    {student.checkIns.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="sticky left-0 z-30 bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
              {dailyTotals.map((count, i) => (
                <td
                  key={mealColumns[i]?.key ?? i}
                  className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${count > 0 ? "" : "opacity-30"}`}
                >
                  {count || ""}
                </td>
              ))}
              <td className="sticky right-0 z-30 bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
