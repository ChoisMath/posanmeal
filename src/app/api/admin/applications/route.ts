import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { adminApplicationSchema } from "@/lib/schemas/meal-plan";
import { saveApplication, toDateKey } from "@/lib/meal-plan-server";

export async function GET() {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [applications, mealDates, registrationGroups, cancelledGroups] = await Promise.all([
    prisma.mealApplication.findMany({
      orderBy: { id: "desc" },
      include: { meals: true },
    }),
    prisma.mealApplicationMealDate.findMany({
      select: { applicationId: true, mealKind: true, date: true },
    }),
    prisma.mealRegistration.groupBy({
      by: ["applicationId"],
      where: { status: "APPROVED" },
      _count: true,
    }),
    prisma.mealRegistration.groupBy({
      by: ["applicationId"],
      where: { status: "CANCELLED" },
      _count: true,
    }),
  ]);

  // 식사별 distinct 날짜 수 계산 (grade 중복 제거)
  const openDateCountMap = new Map<string, Set<string>>();
  for (const row of mealDates) {
    const key = `${row.applicationId}:${row.mealKind}`;
    const set = openDateCountMap.get(key) ?? new Set<string>();
    set.add(toDateKey(row.date));
    openDateCountMap.set(key, set);
  }

  const registrationCountMap = new Map(
    registrationGroups.map((g) => [g.applicationId, g._count]),
  );
  const cancelledCountMap = new Map(
    cancelledGroups.map((g) => [g.applicationId, g._count]),
  );

  const result = applications.map((app) => ({
    id: app.id,
    title: app.title,
    description: app.description,
    status: app.status,
    startYear: app.startYear,
    startMonth: app.startMonth,
    monthCount: app.monthCount,
    applyStartAt: app.applyStartAt?.toISOString() ?? null,
    applyEndAt: app.applyEndAt?.toISOString() ?? null,
    meals: app.meals.map((m) => ({
      mealKind: m.mealKind,
      price: m.price,
      exemptionSelectable: m.exemptionSelectable,
      method: m.method,
      openDateCount: openDateCountMap.get(`${app.id}:${m.mealKind}`)?.size ?? 0,
    })),
    registrationCount: registrationCountMap.get(app.id) ?? 0,
    cancelledCount: cancelledCountMap.get(app.id) ?? 0,
  }));

  return NextResponse.json({ applications: result });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = adminApplicationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const app = await saveApplication(parsed.data);
  return NextResponse.json({ application: { id: app.id } }, { status: 201 });
}
