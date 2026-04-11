"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
}

interface UserRecord {
  id: number;
  name: string;
  number: number | null;
  grade: number | null;
  classNum: number | null;
  subject: string | null;
  homeroom: string | null;
  mealPeriod: { startDate: string; endDate: string } | null;
  checkIns: CheckInRecord[];
}

type Category = "teacher" | "1" | "2" | "3";

function MealGrid({ category, year, month, refreshKey }: { category: Category; year: number; month: number; refreshKey: number }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const isTeacher = category === "teacher";

  const fetchData = useCallback(() => {
    fetch(`/api/admin/checkins?year=${year}&month=${month}&category=${category}`)
      .then((res) => res.json())
      .then((data) => setUsers(data.users || []));
  }, [year, month, category]);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  const daysInMonth = new Date(year, month, 0).getDate();

  const weekendSet = useMemo(() => {
    const set = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) set.add(d);
    }
    return set;
  }, [year, month, daysInMonth]);

  const isWeekend = (day: number) => weekendSet.has(day);

  // 일자별 합계 계산 (memoized)
  const { dailyTotals, grandTotal } = useMemo(() => {
    const totals = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      let total = 0;
      let work = 0;
      let personal = 0;
      users.forEach((user) => {
        const checkIn = user.checkIns.find((c) => new Date(c.date).getDate() === day);
        if (checkIn) {
          total++;
          if (checkIn.type === "WORK") work++;
          else personal++;
        }
      });
      return { total, work, personal };
    });
    const grand = users.reduce((sum, u) => sum + u.checkIns.length, 0);
    return { dailyTotals: totals, grandTotal: grand };
  }, [users, daysInMonth]);

  // 교사 셀 클릭 → 타입 전환
  async function handleToggleType(userId: number, checkIn: CheckInRecord) {
    const newType = checkIn.type === "WORK" ? "PERSONAL" : "WORK";
    const res = await fetch("/api/admin/checkins", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: checkIn.id, type: newType }),
    });
    if (res.ok) {
      // 로컬 state 즉시 업데이트 (리페치 없이)
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                checkIns: u.checkIns.map((c) =>
                  c.id === checkIn.id ? { ...c, type: newType } : c
                ),
              }
            : u
        )
      );
    }
  }

  if (users.length === 0) {
    return <p className="text-center text-muted-foreground py-8 text-sm">데이터가 없습니다.</p>;
  }

  return (
    <div className="overflow-auto max-h-[65vh] border rounded-lg">
      <table className="text-xs border-collapse w-full">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[100px] text-fit-sm">
              {isTeacher ? "이름" : "반 번호 이름"}
            </th>
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
            <th className="sticky right-0 z-30 bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b border-l min-w-[44px] text-fit-sm">
              합계
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const checkedDaysMap = new Map(
              user.checkIns.map((c) => [new Date(c.date).getDate(), c])
            );

            return (
              <tr key={user.id} className="hover:bg-muted/50">
                <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                  <div className="text-fit-sm">
                    {isTeacher ? (
                      <span className="font-semibold">{user.name}</span>
                    ) : (
                      <>
                        <span className="text-muted-foreground">{user.classNum}-</span>
                        <span className="font-semibold">{user.number}</span>
                        <span className="ml-1">{user.name}</span>
                      </>
                    )}
                    {!isTeacher && !user.mealPeriod && (
                      <span className="text-[10px] text-red-400 ml-0.5">미</span>
                    )}
                  </div>
                </td>
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const checkIn = checkedDaysMap.get(day);
                  const weekend = isWeekend(day);
                  return (
                    <td
                      key={day}
                      className={`text-center border-b px-0.5 py-1.5 ${
                        checkIn
                          ? checkIn.type === "WORK"
                            ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold"
                            : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                          : weekend
                            ? "bg-red-50/50 dark:bg-red-950/30"
                            : ""
                      } ${isTeacher && checkIn ? "cursor-pointer hover:opacity-70 select-none" : ""}`}
                      title={checkIn ? `${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}${isTeacher ? " (클릭하여 변경)" : ""}` : undefined}
                      onClick={isTeacher && checkIn ? () => handleToggleType(user.id, checkIn) : undefined}
                    >
                      {checkIn ? (isTeacher ? (checkIn.type === "WORK" ? "근" : "개") : "O") : ""}
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 bg-background text-center border-b border-l px-2 py-1.5 font-medium">
                  {user.checkIns.length}/{daysInMonth}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* 일자별 합계 footer */}
        <tfoot className="sticky bottom-0 z-20">
          {isTeacher ? (
            <>
              <tr>
                <td className="sticky left-0 z-30 bg-blue-50 dark:bg-blue-950 px-2 py-1.5 border-t border-r font-semibold text-blue-700 dark:text-blue-300 text-fit-sm">근무</td>
                {dailyTotals.map((d, i) => (
                  <td key={i} className={`text-center border-t px-0.5 py-1.5 font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ${d.work > 0 ? "" : "opacity-30"}`}>
                    {d.work || ""}
                  </td>
                ))}
                <td className="sticky right-0 z-30 bg-blue-50 dark:bg-blue-950 text-center border-t border-l px-2 py-1.5 font-bold text-blue-700 dark:text-blue-300">
                  {dailyTotals.reduce((s, d) => s + d.work, 0)}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-30 bg-green-50 dark:bg-green-950 px-2 py-1.5 border-t border-r font-semibold text-green-700 dark:text-green-300 text-fit-sm">개인</td>
                {dailyTotals.map((d, i) => (
                  <td key={i} className={`text-center border-t px-0.5 py-1.5 font-semibold bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 ${d.personal > 0 ? "" : "opacity-30"}`}>
                    {d.personal || ""}
                  </td>
                ))}
                <td className="sticky right-0 z-30 bg-green-50 dark:bg-green-950 text-center border-t border-l px-2 py-1.5 font-bold text-green-700 dark:text-green-300">
                  {dailyTotals.reduce((s, d) => s + d.personal, 0)}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-30 bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
                {dailyTotals.map((d, i) => (
                  <td key={i} className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${d.total > 0 ? "" : "opacity-30"}`}>
                    {d.total || ""}
                  </td>
                ))}
                <td className="sticky right-0 z-30 bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                  {grandTotal}
                </td>
              </tr>
            </>
          ) : (
            <tr>
              <td className="sticky left-0 z-30 bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
              {dailyTotals.map((d, i) => (
                <td key={i} className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${d.total > 0 ? "" : "opacity-30"}`}>
                  {d.total || ""}
                </td>
              ))}
              <td className="sticky right-0 z-30 bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                {grandTotal}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

export function AdminMealTable({ refreshKey = 0 }: { refreshKey?: number } = {}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<Category>("teacher");

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  async function handleExport() {
    const res = await fetch(`/api/admin/export?year=${year}&month=${month}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `석식현황_${year}_${month}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Category)}>
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="teacher">교사</TabsTrigger>
          <TabsTrigger value="1">1학년</TabsTrigger>
          <TabsTrigger value="2">2학년</TabsTrigger>
          <TabsTrigger value="3">3학년</TabsTrigger>
        </TabsList>

        {(["teacher", "1", "2", "3"] as const).map((cat) => (
          <TabsContent key={cat} value={cat}>
            <div className="flex items-center justify-center gap-4 mb-4">
              <Button variant="ghost" size="icon" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="font-semibold text-fit-base">{year}년 {month}월</h3>
              <Button variant="ghost" size="icon" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} title="전체 월별 Excel 다운로드">
                <Download className="h-4 w-4 mr-1" /> Excel
              </Button>
            </div>
            <MealGrid category={cat} year={year} month={month} refreshKey={refreshKey} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
