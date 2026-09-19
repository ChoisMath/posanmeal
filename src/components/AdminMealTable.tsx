"use client";

import { useState, useMemo, type CSSProperties } from "react";
import useSWR, { useSWRConfig } from "swr";
import { errorTextOf, fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { academicYearOfDate } from "@/lib/academic-year/calendar";
import { todayKST } from "@/lib/timezone";
import {
  buildMonthlyMealColumns,
  getDateDayKey,
  type MealColumn,
  type MealKind,
} from "@/lib/meal-columns";

interface CheckInRecord {
  id: number;
  date: string;
  checkedAt: string;
  type: string;
  mealKind?: MealKind | null;
}

interface UserRecord {
  id: number;
  name: string;
  number: number | null;
  grade: number | null;
  classNum: number | null;
  subject: string | null;
  homeroom: string | null;
  profileWarning?: string;
  currentClass?: string;
  checkIns: CheckInRecord[];
}

type Category = "teacher" | "1" | "2" | "3" | "unknown";
const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: "teacher", label: "교사" },
  { value: "1", label: "1학년" },
  { value: "2", label: "2학년" },
  { value: "3", label: "3학년" },
  { value: "unknown", label: "확인 필요" },
];
const EMPTY_USERS: UserRecord[] = [];

function MealGrid({ category, year, month, includeCurrent, readonly = false }: { category: Category; year: number; month: number; includeCurrent: boolean; readonly?: boolean }) {
  const { mutate } = useSWRConfig();
  const gridKey = `/api/admin/checkins?year=${year}&month=${month}&category=${category}`;
  const { data, error, isLoading, mutate: mutateGrid } = useSWR(
    `${gridKey}${includeCurrent ? "&includeCurrent=1" : ""}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  const users: UserRecord[] = data?.users ?? EMPTY_USERS;
  const isTeacher = category === "teacher";
  const needsProfile = category === "unknown";

  const daysInMonth = new Date(year, month, 0).getDate();
  const mealColumns: MealColumn[] = data?.mealColumns ?? buildMonthlyMealColumns(year, month);

  const weekendSet = useMemo(() => {
    const set = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) set.add(d);
    }
    return set;
  }, [year, month, daysInMonth]);

  const isWeekend = (day: number) => weekendSet.has(day);

  // 진행 중인 셀 클릭(userId:day) — 중복 클릭 방지
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());

  // 컬럼 하이라이트용 hovered day
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const colHoverStyle = (day: number): CSSProperties | undefined =>
    hoveredDay === day ? { backgroundColor: "rgb(254, 240, 188)" } : undefined;

  // 일자별 합계 계산 (memoized)
  const { dailyTotals, grandTotal } = useMemo(() => {
    const totals = mealColumns.map((column) => {
      let total = 0;
      let work = 0;
      let personal = 0;
      users.forEach((user) => {
        const checkIn = user.checkIns.find((c) => checkInCellKey(c) === column.key);
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
  }, [users, mealColumns]);

  // 날짜를 "YYYY-MM-DD" (KST 달력 기준)로 포맷
  function checkInCellKey(checkIn: CheckInRecord): string {
    return `${getDateDayKey(checkIn.date)}:${checkIn.mealKind ?? "DINNER"}`;
  }

  // 셀 클릭: 교사=cycle, 학생=toggle
  async function handleCellClick(userId: number, column: MealColumn) {
    const key = `${userId}:${column.key}`;
    if (pendingCells.has(key)) return;
    setPendingCells((prev) => new Set(prev).add(key));
    const action = isTeacher ? "cycle" : "toggle";
    try {
      const res = await fetch("/api/admin/checkins/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, date: column.date, mealKind: column.mealKind, action }),
      });
      if (res.ok) {
        await mutate((key) => typeof key === "string" && (key === gridKey || key.startsWith(`${gridKey}&`)));
      } else {
        const data = await res.json().catch(() => null);
        toast.error(errorTextOf(data, "체크인 변경에 실패했습니다."));
      }
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setPendingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (error) {
    return <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <p className="break-keep">급식 기록을 불러오지 못했습니다.</p>
      <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={() => void mutateGrid()}>다시 불러오기</Button>
    </div>;
  }
  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">기록을 불러오는 중…</p>;
  if (users.length === 0) {
    return <p className="text-center text-muted-foreground py-8 text-sm">데이터가 없습니다.</p>;
  }

  return (
    <div className="flex-1 min-h-0 border rounded-lg overflow-auto">
      <table className="text-xs border-collapse w-full whitespace-nowrap">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-[4] bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[100px] text-fit-sm">
              {isTeacher || needsProfile ? "이름" : "반 번호 이름"}
            </th>
            {includeCurrent && <th className="sticky top-0 z-[2] bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r">현재 학급·상태</th>}
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
                  className={`sticky top-0 z-[2] px-1 py-2 text-center font-medium border-b min-w-11 ${
                    weekend
                      ? "bg-red-50 text-red-400 dark:bg-red-950 dark:text-red-400"
                      : mealHeaderClass
                  }`}
                  style={colHoverStyle(column.day)}
                  onMouseEnter={() => setHoveredDay(column.day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  title={column.label}
                >
                  <span>{column.day}</span>
                  <span className="block text-[10px] leading-none opacity-70">{column.shortLabel}</span>
                </th>
              );
            })}
            {isTeacher && (
              <>
                <th className="sticky top-0 z-[2] bg-green-50 dark:bg-green-950 px-2 py-2 text-center font-medium text-green-700 dark:text-green-300 border-b border-l min-w-[44px] text-fit-sm">
                  개인
                </th>
                <th className="sticky top-0 z-[2] bg-blue-50 dark:bg-blue-950 px-2 py-2 text-center font-medium text-blue-700 dark:text-blue-300 border-b border-l min-w-[44px] text-fit-sm">
                  근무
                </th>
              </>
            )}
            <th className="sticky top-0 right-0 z-[4] bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b border-l min-w-[44px] text-fit-sm">
              합계
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const checkedDaysMap = new Map(
              user.checkIns.map((c) => [checkInCellKey(c), c])
            );

            return (
              <tr key={user.id} className="hover:bg-muted/50">
                <td className="sticky left-0 z-[3] bg-background px-2 py-1.5 border-b border-r">
                  <div className="text-fit-sm">
                    {isTeacher || needsProfile ? (
                      <span className="font-semibold">{user.name}</span>
                    ) : (
                      <>
                        <span className="text-muted-foreground">{user.classNum}-</span>
                        <span className="font-semibold">{user.number}</span>
                        <span className="ml-1">{user.name}</span>
                      </>
                    )}
                  </div>
                  {user.profileWarning && <p className="whitespace-nowrap text-xs text-amber-700">{user.profileWarning}</p>}
                </td>
                {includeCurrent && <td className="border-b border-r px-2 py-1.5 text-muted-foreground">{user.currentClass ?? "확인 필요"}</td>}
                {mealColumns.map((column) => {
                  const checkIn = checkedDaysMap.get(column.key);
                  const weekend = isWeekend(column.day);
                  const pending = pendingCells.has(`${user.id}:${column.key}`);
                  const clickable = !readonly && !needsProfile && !pending;
                  return (
                    <td
                      key={column.key}
                      className={`h-11 min-w-11 text-center border-b px-0.5 py-1.5 ${
                        checkIn
                          ? isTeacher
                            ? checkIn.type === "WORK"
                              ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold"
                              : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                            : column.mealKind === "BREAKFAST"
                              ? "bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 font-bold"
                              : column.mealKind === "LUNCH"
                                ? "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 font-bold"
                                : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                          : weekend
                            ? "bg-red-50/50 dark:bg-red-950/30"
                            : ""
                      } ${clickable ? "cursor-pointer hover:opacity-70 select-none" : ""} ${pending ? "opacity-50" : ""}`}
                      style={colHoverStyle(column.day)}
                      onMouseEnter={() => setHoveredDay(column.day)}
                      onMouseLeave={() => setHoveredDay(null)}
                      title={
                        clickable
                          ? checkIn
                            ? `${column.label} ${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })} (클릭하여 ${isTeacher ? "변경" : "삭제"})`
                            : `${column.label} 클릭하여 추가`
                          : checkIn
                            ? `${column.label} ${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}`
                            : undefined
                      }
                      onClick={clickable ? () => handleCellClick(user.id, column) : undefined}
                    >
                      {checkIn ? (isTeacher ? (checkIn.type === "WORK" ? "근" : "개") : "O") : ""}
                    </td>
                  );
                })}
                {isTeacher && (() => {
                  const workCount = user.checkIns.filter((c) => c.type === "WORK").length;
                  const personalCount = user.checkIns.length - workCount;
                  return (
                    <>
                      <td className="text-center border-b border-l px-2 py-1.5 font-semibold bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300">
                        {personalCount}
                      </td>
                      <td className="text-center border-b border-l px-2 py-1.5 font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                        {workCount}
                      </td>
                    </>
                  );
                })()}
                <td className="sticky right-0 z-[3] bg-background text-center border-b border-l px-2 py-1.5 font-medium">
                  {user.checkIns.length}{isTeacher || needsProfile ? "" : `/${mealColumns.filter((c) => c.mealKind === "DINNER").length}`}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* 일자별 합계 footer */}
        <tfoot>
          {isTeacher ? (
            <>
              <tr>
                <td className="sticky left-0 z-[3] bg-blue-50 dark:bg-blue-950 px-2 py-1.5 border-t border-r font-semibold text-blue-700 dark:text-blue-300 text-fit-sm">근무</td>
                {includeCurrent && <td className="border-t border-r bg-blue-50 dark:bg-blue-950" />}
                {dailyTotals.map((d, i) => (
                  <td
                    key={mealColumns[i]?.key ?? i}
                    className={`text-center border-t px-0.5 py-1.5 font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ${d.work > 0 ? "" : "opacity-30"}`}
                    style={colHoverStyle(mealColumns[i]?.day ?? i + 1)}
                    onMouseEnter={() => setHoveredDay(mealColumns[i]?.day ?? i + 1)}
                    onMouseLeave={() => setHoveredDay(null)}
                  >
                    {d.work || ""}
                  </td>
                ))}
                <td className="text-center border-t border-l px-2 py-1.5 bg-blue-50 dark:bg-blue-950 opacity-30">0</td>
                <td className="text-center border-t border-l px-2 py-1.5 font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                  {dailyTotals.reduce((s, d) => s + d.work, 0)}
                </td>
                <td className="sticky right-0 z-[3] bg-blue-50 dark:bg-blue-950 text-center border-t border-l px-2 py-1.5 font-bold text-blue-700 dark:text-blue-300">
                  {dailyTotals.reduce((s, d) => s + d.work, 0)}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-[3] bg-green-50 dark:bg-green-950 px-2 py-1.5 border-t border-r font-semibold text-green-700 dark:text-green-300 text-fit-sm">개인</td>
                {includeCurrent && <td className="border-t border-r bg-green-50 dark:bg-green-950" />}
                {dailyTotals.map((d, i) => (
                  <td
                    key={mealColumns[i]?.key ?? i}
                    className={`text-center border-t px-0.5 py-1.5 font-semibold bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 ${d.personal > 0 ? "" : "opacity-30"}`}
                    style={colHoverStyle(mealColumns[i]?.day ?? i + 1)}
                    onMouseEnter={() => setHoveredDay(mealColumns[i]?.day ?? i + 1)}
                    onMouseLeave={() => setHoveredDay(null)}
                  >
                    {d.personal || ""}
                  </td>
                ))}
                <td className="text-center border-t border-l px-2 py-1.5 font-bold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                  {dailyTotals.reduce((s, d) => s + d.personal, 0)}
                </td>
                <td className="text-center border-t border-l px-2 py-1.5 bg-green-50 dark:bg-green-950 opacity-30">0</td>
                <td className="sticky right-0 z-[3] bg-green-50 dark:bg-green-950 text-center border-t border-l px-2 py-1.5 font-bold text-green-700 dark:text-green-300">
                  {dailyTotals.reduce((s, d) => s + d.personal, 0)}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-[3] bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
                {includeCurrent && <td className="border-t border-r bg-muted" />}
                {dailyTotals.map((d, i) => (
                  <td
                    key={mealColumns[i]?.key ?? i}
                    className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${d.total > 0 ? "" : "opacity-30"}`}
                    style={colHoverStyle(mealColumns[i]?.day ?? i + 1)}
                    onMouseEnter={() => setHoveredDay(mealColumns[i]?.day ?? i + 1)}
                    onMouseLeave={() => setHoveredDay(null)}
                  >
                    {d.total || ""}
                  </td>
                ))}
                <td className="text-center border-t border-l px-2 py-1.5 font-bold bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                  {dailyTotals.reduce((s, d) => s + d.personal, 0)}
                </td>
                <td className="text-center border-t border-l px-2 py-1.5 font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                  {dailyTotals.reduce((s, d) => s + d.work, 0)}
                </td>
                <td className="sticky right-0 z-[3] bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                  {grandTotal}
                </td>
              </tr>
            </>
          ) : (
            <tr>
              <td className="sticky left-0 z-[3] bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
              {includeCurrent && <td className="border-t border-r bg-muted" />}
              {dailyTotals.map((d, i) => (
                <td key={mealColumns[i]?.key ?? i} className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${d.total > 0 ? "" : "opacity-30"}`}>
                  {d.total || ""}
                </td>
              ))}
              <td className="sticky right-0 z-[3] bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                {grandTotal}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

export function AdminMealTable({ readonly = false }: { readonly?: boolean } = {}) {
  const today = todayKST();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [tab, setTab] = useState<Category>("teacher");
  const [exporting, setExporting] = useState(false);
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const academicYear = academicYearOfDate(`${year}-${String(month).padStart(2, "0")}-01`);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/export?year=${year}&month=${month}${includeCurrent ? "&includeCurrent=1" : ""}`);
      if (!res.ok) {
        toast.error(errorTextOf(await res.json().catch(() => null), "내려받기에 실패했습니다."));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `급식현황_${year}_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("연결을 확인한 뒤 다시 내려받아 주세요.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="h-full min-h-0 min-w-0">
      <Tabs className="h-full min-h-0 gap-2" value={tab} onValueChange={(v) => setTab(v as Category)}>
        <div className="shrink-0 overflow-x-auto">
          <TabsList className="w-full min-w-max gap-2 group-data-horizontal/tabs:h-auto">
            {CATEGORIES.map(({ value, label }) => <TabsTrigger key={value} value={value} className="min-h-11 min-w-11 whitespace-nowrap px-3">{label}</TabsTrigger>)}
          </TabsList>
        </div>

        {CATEGORIES.map(({ value: cat }) => (
          <TabsContent key={cat} value={cat} className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
              <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={prevMonth} aria-label="이전 달" disabled={year === 2000 && month === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="font-semibold text-fit-base whitespace-nowrap">{year}년 {month}월</h3>
              <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={nextMonth} aria-label="다음 달" disabled={year === 2100 && month === 12}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="min-h-11 whitespace-nowrap" onClick={handleExport} disabled={exporting} title="전체 월별 Excel 다운로드">
                <Download className="h-4 w-4 mr-1" /> Excel
              </Button>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <p className="whitespace-nowrap text-xs text-muted-foreground">{academicYear}학년도 최종 소속 기준</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap text-sm">
                <input type="checkbox" className="size-5 shrink-0" checked={includeCurrent} onChange={(event) => setIncludeCurrent(event.target.checked)} />
                현재 학급도 함께 표시
              </label>
            </div>
            {cat === "unknown" && <p className="shrink-0 break-keep rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
              해당 학년도 표시 정보가 없는 식사 기록입니다. 현재 학급으로 대신 표시하지 않습니다.
              사용자 관리에서 해당 학년도 정보를 확인해 주세요. 이 목록에서는 체크인을 변경할 수 없습니다.
            </p>}
            <MealGrid category={cat} year={year} month={month} includeCurrent={includeCurrent} readonly={readonly} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
