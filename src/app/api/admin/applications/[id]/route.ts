import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { adminApplicationSchema } from "@/lib/schemas/meal-plan";
import { saveApplication, toDateKey } from "@/lib/meal-plan-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);

  const app = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    include: {
      meals: true,
      mealDates: { orderBy: [{ mealKind: "asc" }, { grade: "asc" }, { date: "asc" }] },
    },
  });

  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    application: {
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
        dates: app.mealDates
          .filter((d) => d.mealKind === m.mealKind)
          .map((d) => ({ grade: d.grade, date: toDateKey(d.date) })),
      })),
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const applicationId = parseInt(id, 10);

  const exists = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = adminApplicationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
      { status: 400 },
    );
  }

  const app = await saveApplication(parsed.data, applicationId);
  return NextResponse.json({ application: { id: app.id } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await prisma.mealApplication.delete({ where: { id: parseInt(id, 10) } });
  return NextResponse.json({ success: true });
}
