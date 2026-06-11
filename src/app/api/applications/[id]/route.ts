import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/meal-plan-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { grade: true, role: true },
  });

  if (!dbUser || dbUser.role !== "STUDENT") {
    return NextResponse.json({ error: "학생만 접근 가능합니다." }, { status: 403 });
  }

  const grade = dbUser.grade;

  const [app, registrationCount, myRegistration] = await Promise.all([
    prisma.mealApplication.findUnique({
      where: { id: applicationId },
      include: {
        meals: true,
        mealDates: {
          where: grade != null ? { grade } : { grade: -1 },
          orderBy: { date: "asc" },
        },
      },
    }),
    prisma.mealRegistration.count({
      where: { applicationId, status: "APPROVED" },
    }),
    prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
      include: {
        meals: true,
        mealDates: { orderBy: { date: "asc" } },
      },
    }),
  ]);

  if (!app) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const application = {
    id: app.id,
    title: app.title,
    description: app.description,
    startYear: app.startYear,
    startMonth: app.startMonth,
    monthCount: app.monthCount,
    applyStartAt: app.applyStartAt,
    applyEndAt: app.applyEndAt,
    status: app.status,
    meals: app.meals
      .filter((m) => m.method !== "NONE")
      .map((m) => {
        const openDates = app.mealDates
          .filter((d) => d.mealKind === m.mealKind)
          .map((d) => toDateKey(d.date));
        return {
          mealKind: m.mealKind,
          price: m.price,
          exemptionSelectable: m.exemptionSelectable,
          method: m.method,
          openDates,
        };
      }),
  };

  let myRegistrationResult = null;
  if (myRegistration) {
    myRegistrationResult = {
      status: myRegistration.status,
      addedBy: myRegistration.addedBy,
      updatedAt: myRegistration.updatedAt,
      meals: myRegistration.meals.map((rm) => {
        const selectedDates = myRegistration.mealDates
          .filter((d) => d.mealKind === rm.mealKind)
          .map((d) => toDateKey(d.date));
        return {
          mealKind: rm.mealKind,
          applied: rm.applied,
          exempt: rm.exempt,
          weekdaysByMonth: rm.weekdaysByMonth
            ? (JSON.parse(rm.weekdaysByMonth) as Record<string, number[]>)
            : null,
          selectedDates,
        };
      }),
    };
  }

  return NextResponse.json({
    application,
    registrationCount,
    myRegistration: myRegistrationResult,
  });
}
