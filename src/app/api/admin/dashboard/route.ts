import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { dateKeyToUtcDate } from "@/lib/date-range";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  let targetDate: Date;
  try {
    targetDate = dateKeyToUtcDate(dateParam);
  } catch {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const [counts, records, breakfastApproved, lunchApproved] = await Promise.all([
    prisma.checkIn.groupBy({
      by: ["type", "mealKind"],
      where: { date: targetDate },
      _count: { id: true },
    }),
    prisma.checkIn.findMany({
      where: { date: targetDate },
      select: {
        id: true,
        type: true,
        mealKind: true,
        source: true,
        checkedAt: true,
        user: { select: { name: true, role: true, grade: true, classNum: true, number: true } },
      },
      orderBy: { checkedAt: "asc" },
    }),
    prisma.mealRegistrationMealDate.findFirst({
      where: { date: targetDate, mealKind: "BREAKFAST", registration: { status: "APPROVED" } },
      select: { date: true },
    }),
    prisma.mealRegistrationMealDate.findFirst({
      where: { date: targetDate, mealKind: "LUNCH", registration: { status: "APPROVED" } },
      select: { date: true },
    }),
  ]);

  const hasBreakfast = Boolean(breakfastApproved);
  const hasLunch = Boolean(lunchApproved);

  const studentBreakfastCount = counts
    .filter((c) => c.type === "STUDENT" && c.mealKind === "BREAKFAST")
    .reduce((sum, c) => sum + c._count.id, 0);
  const studentLunchCount = counts
    .filter((c) => c.type === "STUDENT" && c.mealKind === "LUNCH")
    .reduce((sum, c) => sum + c._count.id, 0);
  const studentDinnerCount = counts
    .filter((c) => c.type === "STUDENT" && c.mealKind === "DINNER")
    .reduce((sum, c) => sum + c._count.id, 0);
  const teacherWorkCount = counts
    .filter((c) => c.type === "WORK")
    .reduce((sum, c) => sum + c._count.id, 0);
  const teacherPersonalCount = counts
    .filter((c) => c.type === "PERSONAL")
    .reduce((sum, c) => sum + c._count.id, 0);

  return NextResponse.json({
    date: dateParam,
    hasBreakfast,
    hasLunch,
    studentCount: studentDinnerCount,
    breakfastStudentCount: studentBreakfastCount,
    lunchStudentCount: studentLunchCount,
    dinnerStudentCount: studentDinnerCount,
    teacherWorkCount,
    teacherPersonalCount,
    records: records.map((c) => ({
      id: c.id,
      userName: c.user.name,
      role: c.user.role,
      type: c.type,
      mealKind: c.mealKind,
      source: c.source,
      checkedAt: c.checkedAt.toISOString(),
      grade: c.user.grade,
      classNum: c.user.classNum,
      number: c.user.number,
    })),
  });
}
