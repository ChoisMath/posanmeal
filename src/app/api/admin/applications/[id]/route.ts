import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminApplicationSchema } from "@/lib/schemas/meal-plan";
import { saveApplication, toDateKey } from "@/lib/meal-plan-server";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { requireActor } from "@/lib/academic-year/request-actor";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");
    const applicationId = parseIdParam((await params).id);

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
        academicYear: app.academicYear,
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
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const applicationId = parseIdParam((await params).id);

    const exists = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = adminApplicationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" },
        { status: 400 },
      );
    }

    const app = await saveApplication(actor, parsed.data, applicationId);
    return NextResponse.json({ application: { id: app.id } });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const applicationId = parseIdParam((await params).id);

    const exists = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }

    await withEligibilityMutation(
      prisma,
      actor,
      { scope: "APPLICATION", applicationId },
      // 신청 행은 예전부터 공고 삭제에 딸려 지워진다. 그 동작은 그대로 두고 증거만 남긴다.
      (tx) => tx.mealApplication.delete({ where: { id: applicationId } }),
    );

    return NextResponse.json({ success: true });
  });
}
