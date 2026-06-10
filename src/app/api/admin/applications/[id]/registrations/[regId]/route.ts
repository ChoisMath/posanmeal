import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections } from "@/lib/meal-plan-server";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { z } from "zod";

const patchStatusSchema = z.object({
  status: z.enum(["APPROVED", "CANCELLED"]),
});

const patchMealsSchema = z.object({
  meals: studentRegisterSchema.shape.meals,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { regId } = await params;
  const registrationId = parseInt(regId, 10);
  if (Number.isNaN(registrationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // Branch A: status change
  const statusParsed = patchStatusSchema.safeParse(body);
  if (statusParsed.success) {
    const { status } = statusParsed.data;
    const reg = await prisma.mealRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true },
    });
    if (!reg) {
      return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
    }

    const updated = await prisma.mealRegistration.update({
      where: { id: registrationId },
      data: {
        status,
        cancelledAt: status === "CANCELLED" ? new Date() : null,
        cancelledBy: status === "CANCELLED" ? "ADMIN" : null,
      },
      select: { id: true, status: true },
    });

    return NextResponse.json({ registration: updated });
  }

  // Branch B: meals content update
  const mealsParsed = patchMealsSchema.safeParse(body);
  if (!mealsParsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      applicationId: true,
      userId: true,
      signature: true,
      user: { select: { grade: true } },
    },
  });

  if (!reg) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  if (reg.user.grade == null) {
    return NextResponse.json({ error: "학생 학년 정보가 없습니다." }, { status: 400 });
  }

  const resolveResult = await resolveRegistrationSelections(
    reg.applicationId,
    reg.user.grade,
    mealsParsed.data.meals,
  );

  if (!resolveResult.ok) {
    return NextResponse.json({ error: resolveResult.error }, { status: 400 });
  }

  // Replace meal rows; keep existing signature; force status=APPROVED
  await prisma.$transaction(async (tx) => {
    await tx.mealRegistration.update({
      where: { id: registrationId },
      data: { status: "APPROVED", cancelledAt: null, cancelledBy: null },
    });
    await tx.mealRegistrationMeal.deleteMany({ where: { registrationId } });
    await tx.mealRegistrationMealDate.deleteMany({ where: { registrationId } });

    await tx.mealRegistrationMeal.createMany({
      data: resolveResult.resolved.map((r) => ({
        registrationId,
        mealKind: r.mealKind,
        applied: r.applied,
        exempt: r.exempt,
        weekdaysByMonth: r.weekdaysByMonth,
      })),
    });

    const dateRows = resolveResult.resolved.flatMap((r) =>
      r.dates.map((d) => ({
        registrationId,
        mealKind: r.mealKind,
        date: dateKeyToUtcDate(d),
      })),
    );
    if (dateRows.length > 0) {
      await tx.mealRegistrationMealDate.createMany({ data: dateRows, skipDuplicates: true });
    }
  });

  return NextResponse.json({ registration: { id: registrationId } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { regId } = await params;
  const registrationId = parseInt(regId, 10);
  if (Number.isNaN(registrationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true },
  });

  if (!reg) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.mealRegistration.delete({ where: { id: registrationId } });

  return NextResponse.json({ success: true });
}
