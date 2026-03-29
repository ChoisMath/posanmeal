"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CheckInRecord {
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

type Category = "teacher" | "1" | "2" | "3" | "today";

function MealGrid({ category, year, month }: { category: Exclude<Category, "today">; year: number; month: number }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const isTeacher = category === "teacher";

  useEffect(() => {
    fetch(`/api/admin/checkins?year=${year}&month=${month}&category=${category}`)
      .then((res) => res.json())
      .then((data) => setUsers(data.users || []));
  }, [year, month, category]);

  const daysInMonth = new Date(year, month, 0).getDate();

  const isWeekend = (day: number) => {
    const d = new Date(year, month - 1, day).getDay();
    return d === 0 || d === 6;
  };

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
                      }`}
                      title={checkIn ? `${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : undefined}
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
      </table>
    </div>
  );
}

function TodayView() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const today = now.getDate();
  const categories: { key: Exclude<Category, "today">; label: string }[] = [
    { key: "teacher", label: "교사" },
    { key: "1", label: "1학년" },
    { key: "2", label: "2학년" },
    { key: "3", label: "3학년" },
  ];

  return (
    <div className="space-y-4">
      {categories.map(({ key, label }) => (
        <TodaySection key={key} category={key} label={label} year={year} month={month} today={today} />
      ))}
    </div>
  );
}

function TodaySection({ category, label, year, month, today }: {
  category: Exclude<Category, "today">; label: string; year: number; month: number; today: number;
}) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const isTeacher = category === "teacher";

  useEffect(() => {
    fetch(`/api/admin/checkins?year=${year}&month=${month}&category=${category}`)
      .then((res) => res.json())
      .then((data) => setUsers(data.users || []));
  }, [year, month, category]);

  const checkedCount = users.filter((u) =>
    u.checkIns.some((c) => new Date(c.date).getDate() === today)
  ).length;

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between px-3 py-2 bg-muted rounded-t-lg">
        <h4 className="font-semibold text-sm">{label}</h4>
        <span className="text-xs text-muted-foreground">
          {checkedCount}/{users.length}명 체크인
        </span>
      </div>
      <div className="overflow-auto max-h-[30vh]">
        <table className="text-xs w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-muted px-2 py-1.5 text-left font-medium text-muted-foreground border-b min-w-[100px]">
                {isTeacher ? "이름" : "반 번호 이름"}
              </th>
              <th className="bg-muted px-2 py-1.5 text-center font-medium text-muted-foreground border-b w-16">구분</th>
              <th className="bg-muted px-2 py-1.5 text-center font-medium text-muted-foreground border-b w-16">시각</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const todayCheckIn = user.checkIns.find(
                (c) => new Date(c.date).getDate() === today
              );
              return (
                <tr key={user.id} className={`border-b ${todayCheckIn ? "" : "opacity-40"}`}>
                  <td className="px-2 py-1.5">
                    {isTeacher ? (
                      <span className="font-semibold">{user.name}</span>
                    ) : (
                      <span>
                        <span className="text-muted-foreground">{user.classNum}-</span>
                        <span className="font-semibold">{user.number}</span>
                        <span className="ml-1">{user.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {todayCheckIn ? (
                      <span className={`font-medium ${todayCheckIn.type === "WORK" ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`}>
                        {todayCheckIn.type === "STUDENT" ? "학생" : todayCheckIn.type === "WORK" ? "근무" : "개인"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {todayCheckIn ? new Date(todayCheckIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-"}
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

export function AdminMealTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<Category>("today");

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Category)}>
        <TabsList className="grid w-full grid-cols-5 mb-4">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="teacher">교사</TabsTrigger>
          <TabsTrigger value="1">1학년</TabsTrigger>
          <TabsTrigger value="2">2학년</TabsTrigger>
          <TabsTrigger value="3">3학년</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <TodayView />
        </TabsContent>

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
            </div>
            <MealGrid category={cat} year={year} month={month} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
