import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildMonthDateRange } from "@/lib/date-range";
import { buildMonthlyMealColumns, getDateDayKey, type MealKind } from "@/lib/meal-columns";
import { getCachedSettings } from "@/lib/settings-cache";
import { buildCardQrString } from "@/lib/qr-card";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });

  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const { startDate, endDate } = buildMonthDateRange(year, month);

  const [students, appliedRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: "STUDENT", grade, classNum },
      select: {
        id: true, name: true, number: true, photoUrl: true,
        checkIns: {
          where: { date: { gte: startDate, lte: endDate } },
          select: { date: true, checkedAt: true, type: true, mealKind: true },
          orderBy: [{ date: "asc" }, { mealKind: "asc" }],
        },
      },
      orderBy: { number: "asc" },
    }),
    prisma.mealRegistrationMealDate.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        registration: {
          status: "APPROVED",
          user: { role: "STUDENT", grade, classNum },
        },
      },
      select: {
        date: true,
        mealKind: true,
        registration: { select: { userId: true } },
      },
    }),
  ]);

  const appliedByUser = new Map<number, { date: string; mealKind: MealKind }[]>();
  for (const row of appliedRows) {
    const userId = row.registration.userId;
    const list = appliedByUser.get(userId) ?? [];
    list.push({ date: getDateDayKey(row.date), mealKind: row.mealKind });
    appliedByUser.set(userId, list);
  }

  const mealColumns = buildMonthlyMealColumns(year, month, {
    BREAKFAST: appliedRows.filter((r) => r.mealKind === "BREAKFAST").map((r) => r.date),
    LUNCH: appliedRows.filter((r) => r.mealKind === "LUNCH").map((r) => r.date),
  });

  const settings = await getCachedSettings();

  const studentsOut = students.map((s) => ({
    id: s.id,
    name: s.name,
    number: s.number,
    photoUrl: s.photoUrl,
    checkIns: s.checkIns,
    appliedDates: appliedByUser.get(s.id) ?? [],
    qrString: buildCardQrString(s.id, settings.qrGeneration),
  }));

  return NextResponse.json({ students: studentsOut, grade, classNum, mealColumns });
}
