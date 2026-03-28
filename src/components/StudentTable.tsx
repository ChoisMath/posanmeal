"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">{grade}학년 {classNum}반 — {year}년 {month}월</h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-3">
        {students.map((student) => {
          const checkedDays = student.checkIns.map((c) => new Date(c.date).getDate());
          const hasMealPeriod = !!student.mealPeriod;
          return (
            <div key={student.id} className="border rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                {student.photoUrl ? (
                  <img src={student.photoUrl} alt={student.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold">{student.name.charAt(0)}</div>
                )}
                <div>
                  <p className="font-semibold">{student.number}번 {student.name}</p>
                  <div className="flex gap-1">
                    {hasMealPeriod ? <Badge variant="secondary" className="text-xs">석식 신청</Badge> : <Badge variant="outline" className="text-xs">미신청</Badge>}
                    <Badge variant="outline" className="text-xs">{student.checkIns.length}/{daysInMonth}일</Badge>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-10 gap-1 text-xs text-center">
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const checked = checkedDays.includes(day);
                  return (
                    <div key={day} className={`py-1 rounded ${checked ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-muted"}`}>
                      {day}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
