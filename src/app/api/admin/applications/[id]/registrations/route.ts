import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin, canReadAdmin } from "@/lib/permissions";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";
import { z } from "zod";

// Admin body: no signature, just userId + meals
const adminRegisterSchema = z.object({
  userId: z.number().int().positive(),
  meals: studentRegisterSchema.shape.meals,
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canReadAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      title: true,
      startYear: true,
      startMonth: true,
      monthCount: true,
      applyStartAt: true,
      applyEndAt: true,
      meals: {
        select: {
          mealKind: true,
          price: true,
          exemptionSelectable: true,
          method: true,
        },
      },
    },
  });

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const registrationRows = await prisma.mealRegistration.findMany({
    where: { applicationId },
    select: {
      id: true,
      createdAt: true,
      status: true,
      addedBy: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          grade: true,
          classNum: true,
          number: true,
          gender: true,
        },
      },
      meals: {
        select: { mealKind: true, applied: true, exempt: true },
      },
    },
    orderBy: [
      { user: { grade: "asc" } },
      { user: { classNum: "asc" } },
      { user: { number: "asc" } },
    ],
  });

  // Aggregate dayCount per (registrationId, mealKind) using groupBy
  const regIds = registrationRows.map((r) => r.id);

  const dayCounts =
    regIds.length > 0
      ? await prisma.mealRegistrationMealDate.groupBy({
          by: ["registrationId", "mealKind"],
          where: { registrationId: { in: regIds } },
          _count: { date: true },
        })
      : [];

  const dayCountMap = new Map<string, number>();
  for (const row of dayCounts) {
    dayCountMap.set(`${row.registrationId}:${row.mealKind}`, row._count.date);
  }

  const registrations = registrationRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    addedBy: r.addedBy,
    user: r.user,
    meals: r.meals.map((m) => ({
      mealKind: m.mealKind,
      applied: m.applied,
      exempt: m.exempt,
      dayCount: dayCountMap.get(`${r.id}:${m.mealKind}`) ?? 0,
    })),
  }));

  return NextResponse.json({ application, registrations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const parsed = adminRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const input = parsed.data;

  const [app, targetUser] = await Promise.all([
    prisma.mealApplication.findUnique({ where: { id: applicationId }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { role: true, grade: true },
    }),
  ]);

  if (!app) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  if (!targetUser || targetUser.role !== "STUDENT" || targetUser.grade == null) {
    return NextResponse.json({ error: "학생 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const resolveResult = await resolveRegistrationSelections(
    applicationId,
    targetUser.grade,
    input.meals,
  );

  if (!resolveResult.ok) {
    return NextResponse.json({ error: resolveResult.error }, { status: 400 });
  }

  const { registrationId, created } = await prisma.$transaction((tx) =>
    writeRegistration(tx, applicationId, input.userId, "(관리자 등록)", resolveResult.resolved, "ADMIN"),
  );

  return NextResponse.json({ registration: { id: registrationId } }, { status: created ? 201 : 200 });
}
