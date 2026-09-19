import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { academicYearOfDate } from "@/lib/academic-year/calendar";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import {
  currentClassLabelOf,
  getReportProfiles,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";

export async function GET(request: Request) {
  return routeResponse(() => readDashboard(request));
}

async function readDashboard(request: Request): Promise<NextResponse> {
  await requireActor("READ_ADMIN");

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  const includeCurrent = searchParams.get("includeCurrent") === "1";
  let targetDate: Date;
  try {
    targetDate = dateKeyToUtcDate(dateParam);
  } catch {
    throw new DomainError("INVALID_INPUT", "날짜를 확인하세요.");
  }
  const academicYear = academicYearOfDate(dateParam);

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
        userId: true,
        type: true,
        mealKind: true,
        source: true,
        checkedAt: true,
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

  const profiles = await getReportProfiles(
    prisma,
    records.map((c) => c.userId),
    academicYear,
    includeCurrent,
  );

  return NextResponse.json({
    date: dateParam,
    academicYear,
    hasBreakfast,
    hasLunch,
    studentCount: studentDinnerCount,
    breakfastStudentCount: studentBreakfastCount,
    lunchStudentCount: studentLunchCount,
    dinnerStudentCount: studentDinnerCount,
    teacherWorkCount,
    teacherPersonalCount,
    records: records.map((c) => {
      const report = profiles.get(c.userId);
      const profile = report?.historical;
      return {
        id: c.id,
        userName: profile?.name ?? "",
        role: profile?.role ?? null,
        type: c.type,
        mealKind: c.mealKind,
        source: c.source,
        checkedAt: c.checkedAt.toISOString(),
        grade: profile?.grade ?? null,
        classNum: profile?.classNum ?? null,
        number: profile?.number ?? null,
        ...(report?.warning ? { profileWarning: report.warning } : {}),
        ...(includeCurrent ? { currentClass: currentClassLabelOf(report) } : {}),
      };
    }),
  });
}
