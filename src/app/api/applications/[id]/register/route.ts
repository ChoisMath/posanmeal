import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { toDateKey } from "@/lib/meal-plan-server";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { monthKeyOf, weekdayOf, MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-plan";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = studentRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const input = parsed.data;

  const now = new Date();
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (
    !app ||
    app.status !== "OPEN" ||
    !app.applyStartAt ||
    !app.applyEndAt ||
    now < app.applyStartAt ||
    now > app.applyEndAt
  ) {
    return NextResponse.json({ error: "신청 기간이 아닙니다." }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { role: true, grade: true },
  });

  if (!dbUser || dbUser.role !== "STUDENT" || dbUser.grade == null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const grade = dbUser.grade;

  const [appMeals, openRows] = await Promise.all([
    prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
    prisma.mealApplicationMealDate.findMany({ where: { applicationId, grade } }),
  ]);

  const openByKind = new Map<MealKind, string[]>();
  for (const row of openRows) {
    const key = row.mealKind as MealKind;
    const dateKey = toDateKey(row.date);
    const arr = openByKind.get(key);
    if (arr) {
      arr.push(dateKey);
    } else {
      openByKind.set(key, [dateKey]);
    }
  }
  for (const [k, arr] of openByKind) {
    openByKind.set(k, arr.sort());
  }

  const resolved: Array<{
    mealKind: MealKind;
    applied: boolean;
    exempt: boolean;
    weekdaysByMonth: string | null;
    dates: string[];
  }> = [];

  for (const mealInput of input.meals) {
    const kind = mealInput.mealKind as MealKind;
    const conf = appMeals.find((m) => m.mealKind === kind);

    if (!conf || conf.method === "NONE") {
      return NextResponse.json({ error: "신청할 수 없는 식사입니다." }, { status: 400 });
    }

    if (mealInput.exempt && !conf.exemptionSelectable) {
      return NextResponse.json({ error: "면제를 선택할 수 없습니다." }, { status: 400 });
    }

    const open = openByKind.get(kind) ?? [];
    let dates: string[] = [];

    if (mealInput.applied) {
      if (conf.method === "YN") {
        dates = open;
      } else if (conf.method === "WEEKDAY") {
        const byMonth = mealInput.weekdaysByMonth ?? {};
        dates = open.filter((d) => (byMonth[monthKeyOf(d)] ?? []).includes(weekdayOf(d)));
      } else {
        // DATE
        const sel = new Set(mealInput.selectedDates ?? []);
        const invalidDate = [...sel].some((d) => !open.includes(d));
        if (invalidDate) {
          return NextResponse.json({ error: "선택할 수 없는 날짜가 포함되어 있습니다." }, { status: 400 });
        }
        dates = [...sel].sort();
      }

      if (dates.length === 0) {
        return NextResponse.json(
          { error: `${MEAL_LABEL[kind]} 신청 날짜가 없습니다.` },
          { status: 400 },
        );
      }
    }

    resolved.push({
      mealKind: kind,
      applied: mealInput.applied,
      exempt: mealInput.exempt,
      weekdaysByMonth:
        conf.method === "WEEKDAY" && mealInput.weekdaysByMonth
          ? JSON.stringify(mealInput.weekdaysByMonth)
          : null,
      dates,
    });
  }

  if (resolved.every((r) => !r.applied)) {
    return NextResponse.json({ error: "신청할 식사를 선택해주세요." }, { status: 400 });
  }

  const existing = await prisma.mealRegistration.findUnique({
    where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
  });

  const registration = await prisma.$transaction(async (tx) => {
    const parent = existing
      ? await tx.mealRegistration.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            signature: input.signature,
            cancelledAt: null,
            cancelledBy: null,
          },
        })
      : await tx.mealRegistration.create({
          data: {
            applicationId,
            userId: session.user.dbUserId,
            signature: input.signature,
            status: "APPROVED",
          },
        });

    await tx.mealRegistrationMeal.deleteMany({ where: { registrationId: parent.id } });
    await tx.mealRegistrationMealDate.deleteMany({ where: { registrationId: parent.id } });

    await tx.mealRegistrationMeal.createMany({
      data: resolved.map((r) => ({
        registrationId: parent.id,
        mealKind: r.mealKind,
        applied: r.applied,
        exempt: r.exempt,
        weekdaysByMonth: r.weekdaysByMonth,
      })),
    });

    const dateRows = resolved.flatMap((r) =>
      r.dates.map((d) => ({
        registrationId: parent.id,
        mealKind: r.mealKind,
        date: dateKeyToUtcDate(d),
      })),
    );

    if (dateRows.length > 0) {
      await tx.mealRegistrationMealDate.createMany({ data: dateRows, skipDuplicates: true });
    }

    return parent;
  });

  return NextResponse.json({ registration: { id: registration.id } }, { status: existing ? 200 : 201 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);

  const now = new Date();
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (
    !app ||
    app.status !== "OPEN" ||
    !app.applyStartAt ||
    !app.applyEndAt ||
    now < app.applyStartAt ||
    now > app.applyEndAt
  ) {
    return NextResponse.json(
      { error: "신청 취소 기간이 아닙니다.", errorCode: "OUT_OF_APPLY_WINDOW" },
      { status: 400 },
    );
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
  });

  if (!reg || reg.status !== "APPROVED") {
    return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });
  }

  await prisma.mealRegistration.update({
    where: { id: reg.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "STUDENT" },
  });

  return NextResponse.json({ success: true });
}
