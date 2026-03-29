"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  mealPeriod?: { startDate: string; endDate: string } | null;
  checkIns: { date: string; checkedAt: string }[];
}

export function StudentTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [students, setStudents] = useState<Student[]>([]);
  const [grade, setGrade] = useState(0);
  const [classNum, setClassNum] = useState(0);

  useEffect(() => {
    fetch(`/api/teacher/students?year=${year}&month=${month}`)
      .then((res) => res.json())
      .then((data) => {
        setStudents(data.students || []);
        setGrade(data.grade || 0);
        setClassNum(data.classNum || 0);
      });
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const daysInMonth = new Date(year, month, 0).getDate();

  // 주말 판별
  const isWeekend = (day: number) => {
    const d = new Date(year, month - 1, day).getDay();
    return d === 0 || d === 6;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-fit-base">{grade}학년 {classNum}반 — {year}년 {month}월</h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-auto max-h-[70vh] border rounded-lg">
        <table className="text-xs border-collapse w-full">
          <thead className="sticky top-0 z-20">
            <tr>
              {/* 학생명 컬럼 - 좌측 고정 */}
              <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[90px] text-fit-sm">
                번호 이름
              </th>
              {/* 날짜 컬럼 */}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const weekend = isWeekend(day);
                return (
                  <th
                    key={day}
                    className={`px-1 py-2 text-center font-medium border-b min-w-[28px] ${
                      weekend
                        ? "bg-red-50 text-red-400 dark:bg-red-950 dark:text-red-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {day}
                  </th>
                );
              })}
              {/* 합계 컬럼 - 우측 고정 */}
              <th className="sticky right-0 z-30 bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b border-l min-w-[44px] text-fit-sm">
                합계
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const checkedDaysSet = new Set(
                student.checkIns.map((c) => new Date(c.date).getDate())
              );
              const hasMealPeriod = !!student.mealPeriod;

              return (
                <tr key={student.id} className="hover:bg-muted/50">
                  {/* 학생명 셀 - 좌측 고정 */}
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <div className="flex items-center gap-1 text-fit-sm">
                      <span className="font-semibold">{student.number}</span>
                      <span>{student.name}</span>
                      {!hasMealPeriod && (
                        <span className="text-[10px] text-red-400 ml-0.5">미</span>
                      )}
                    </div>
                  </td>
                  {/* 날짜 셀 */}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const checked = checkedDaysSet.has(day);
                    const weekend = isWeekend(day);
                    return (
                      <td
                        key={day}
                        className={`text-center border-b px-1 py-1.5 ${
                          checked
                            ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                            : weekend
                              ? "bg-red-50/50 dark:bg-red-950/30"
                              : ""
                        }`}
                      >
                        {checked ? "O" : ""}
                      </td>
                    );
                  })}
                  {/* 합계 셀 - 우측 고정 */}
                  <td className="sticky right-0 z-10 bg-background text-center border-b border-l px-2 py-1.5 font-medium">
                    {student.checkIns.length}/{daysInMonth}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
