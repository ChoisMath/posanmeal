import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildMonthDateRange } from "@/lib/date-range";
import { buildMonthlyMealColumns, getDateDayKey, type MealKind } from "@/lib/meal-columns";
import { getCachedSettings } from "@/lib/settings-cache";
import { buildCardQrString } from "@/lib/qr-card";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import {
  compareByProfile,
  displayNameOf,
  getReportProfiles,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";
import { getTeacherScope, listScopeStudentIds } from "@/lib/academic-year/teacher-scope";
import { academicYearOfDate, kstDateKey } from "@/lib/academic-year/calendar";

export async function GET(request: Request) {
  return routeResponse(() => listStudents(request));
}

async function listStudents(request: Request): Promise<NextResponse> {
  const actor = await requireActor("TEACHER");

  // 담당 학급은 운영 연도 기록에서만 나온다.
  const scope = await getTeacherScope(prisma, actor);
  if (!scope) {
    throw new DomainError("FORBIDDEN", "담임 교사가 아닙니다.");
  }

  const { searchParams } = new URL(request.url);
  const currentMonth = kstDateKey(new Date()).slice(0, 7);
  const firstMonth = `${scope.year}-03`;
  const lastMonth = `${scope.year + 1}-02`;
  const defaultMonth = currentMonth < firstMonth ? firstMonth : currentMonth > lastMonth ? lastMonth : currentMonth;
  const year = Number(searchParams.get("year") ?? defaultMonth.slice(0, 4));
  const month = Number(searchParams.get("month") ?? defaultMonth.slice(5));
  if (!Number.isInteger(year) || year < 2000 || year > 2101 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("INVALID_INPUT", "조회 기간을 확인하세요.");
  }
  if (academicYearOfDate(`${year}-${String(month).padStart(2, "0")}-01`) !== scope.year) {
    throw new DomainError("FORBIDDEN", "담당 학생 기록은 현재 운영 학년도에 한해 조회할 수 있습니다.");
  }

  const { startDate, endDate } = buildMonthDateRange(year, month);
  const studentIds = await listScopeStudentIds(prisma, scope);

  const [profiles, photos, checkIns, appliedRows] = await Promise.all([
    getReportProfiles(prisma, studentIds, scope.year, false),
    prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, photoUrl: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: { in: studentIds }, date: { gte: startDate, lte: endDate } },
      select: { userId: true, date: true, checkedAt: true, type: true, mealKind: true },
      orderBy: [{ date: "asc" }, { mealKind: "asc" }],
    }),
    prisma.mealRegistrationMealDate.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        registration: { status: "APPROVED", userId: { in: studentIds } },
      },
      select: { date: true, mealKind: true, registration: { select: { userId: true } } },
    }),
  ]);

  const photoByUser = new Map(photos.map((row) => [row.id, row.photoUrl]));

  const checkInsByUser = new Map<number, Array<Omit<(typeof checkIns)[number], "userId">>>();
  for (const { userId, ...rest } of checkIns) {
    const list = checkInsByUser.get(userId);
    if (list) list.push(rest);
    else checkInsByUser.set(userId, [rest]);
  }

  const appliedByUser = new Map<number, { date: string; mealKind: MealKind }[]>();
  for (const row of appliedRows) {
    const userId = row.registration.userId;
    const list = appliedByUser.get(userId) ?? [];
    list.push({ date: getDateDayKey(row.date), mealKind: row.mealKind });
    appliedByUser.set(userId, list);
  }

  const visibleMeals = [...appliedRows, ...checkIns];
  const mealColumns = buildMonthlyMealColumns(year, month, {
    BREAKFAST: visibleMeals.filter((r) => r.mealKind === "BREAKFAST").map((r) => r.date),
    LUNCH: visibleMeals.filter((r) => r.mealKind === "LUNCH").map((r) => r.date),
  });

  const settings = await getCachedSettings();

  const students = studentIds
    .slice()
    .sort((a, b) => compareByProfile(profiles.get(a), profiles.get(b), "STUDENT"))
    .map((id) => {
      const report = profiles.get(id);
      return {
        id,
        name: displayNameOf(report),
        number: report?.historical?.number ?? null,
        photoUrl: photoByUser.get(id) ?? null,
        checkIns: checkInsByUser.get(id) ?? [],
        appliedDates: appliedByUser.get(id) ?? [],
        qrString: buildCardQrString(id, settings.qrGeneration),
        ...(report?.warning ? { profileWarning: report.warning } : {}),
      };
    });

  return NextResponse.json({
    students,
    grade: scope.grade,
    classNum: scope.classNum,
    academicYear: scope.year,
    year,
    month,
    mealColumns,
  });
}
