import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections, toDateKey } from "@/lib/meal-plan-server";
import { dateKeyToUtcDate } from "@/lib/date-range";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import {
  getRegistrationContext,
  resolveApplicationYear,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import { displayNameOf, getReportProfiles } from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";
import { z } from "zod";

const patchStatusSchema = z.object({
  status: z.enum(["APPROVED", "CANCELLED"]),
});

const patchMealsSchema = z.object({
  meals: studentRegisterSchema.shape.meals,
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  return routeResponse(() => readRegistration(params));
}

async function readRegistration(
  params: Promise<{ id: string; regId: string }>,
): Promise<NextResponse> {
  await requireActor("READ_ADMIN");

  const { id, regId } = await params;
  const applicationId = parseIdParam(id);
  const registrationId = parseIdParam(regId);

  const reg = await prisma.mealRegistration.findUnique({
    where: { id: registrationId },
    include: {
      application: { select: { academicYear: true } },
      meals: true,
      mealDates: { orderBy: { date: "asc" } },
    },
  });

  if (!reg || reg.applicationId !== applicationId) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  const mode = await rosterMode(prisma);
  const academicYear = await resolveApplicationYear(prisma, mode, reg.application.academicYear);
  const report = (await getReportProfiles(prisma, [reg.userId], academicYear, false)).get(reg.userId);
  const profile = report?.historical;

  return NextResponse.json({
    academicYear,
    registration: {
      id: reg.id,
      status: reg.status,
      addedBy: reg.addedBy,
      createdAt: reg.createdAt,
      updatedAt: reg.updatedAt,
      user: {
        id: reg.userId,
        name: displayNameOf(report),
        grade: profile?.grade ?? null,
        classNum: profile?.classNum ?? null,
        number: profile?.number ?? null,
      },
      ...(report?.warning ? { profileWarning: report.warning } : {}),
      meals: reg.meals.map((rm) => ({
        mealKind: rm.mealKind,
        applied: rm.applied,
        exempt: rm.exempt,
        weekdaysByMonth: rm.weekdaysByMonth
          ? (JSON.parse(rm.weekdaysByMonth) as Record<string, number[]>)
          : null,
        selectedDates: reg.mealDates
          .filter((d) => d.mealKind === rm.mealKind)
          .map((d) => toDateKey(d.date)),
      })),
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const registrationId = parseIdParam((await params).regId);

    const body: unknown = await request.json().catch(() => null);

    const reg = await prisma.mealRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, applicationId: true, userId: true, status: true },
    });
    if (!reg) {
      return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
    }

    const change = {
      scope: "REGISTRATION",
      applicationId: reg.applicationId,
      userId: reg.userId,
    } as const;

    // Branch A: status change
    const statusParsed = patchStatusSchema.safeParse(body);
    if (statusParsed.success) {
      const { status } = statusParsed.data;
      const intent = status === "CANCELLED" ? "CANCEL" : "RESTORE";

      const updated = await withEligibilityMutation(prisma, actor, change, async (tx) => {
        await getRegistrationContext(tx, actor, reg.applicationId, reg.userId, intent);
        return tx.mealRegistration.update({
          where: { id: registrationId },
          data: {
            status,
            cancelledAt: status === "CANCELLED" ? new Date() : null,
            cancelledBy: status === "CANCELLED" ? "ADMIN" : null,
          },
          select: { id: true, status: true },
        });
      });

      return NextResponse.json({ registration: updated });
    }

    // Branch B: meals content update
    const mealsParsed = patchMealsSchema.safeParse(body);
    if (!mealsParsed.success) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const written = await withEligibilityMutation<{ ok: true } | { error: string }>(
      prisma,
      actor,
      { ...change, recorded: (result) => !("error" in result) },
      async (tx) => {
        const intent = reg.status === "APPROVED" ? "EDIT" : "RESTORE";
        const context = await getRegistrationContext(
          tx,
          actor,
          reg.applicationId,
          reg.userId,
          intent,
        );

        const resolved = await resolveRegistrationSelections(
          reg.applicationId,
          context.profile.grade ?? 0,
          mealsParsed.data.meals,
          context.resolveContext,
        );
        if (!resolved.ok) return { error: resolved.error };

        // Replace meal rows; keep existing signature; force status=APPROVED
        await tx.mealRegistration.update({
          where: { id: registrationId },
          data: { status: "APPROVED", cancelledAt: null, cancelledBy: null },
        });
        await tx.mealRegistrationMeal.deleteMany({ where: { registrationId } });
        await tx.mealRegistrationMealDate.deleteMany({
          where: { registrationId },
        });

        await tx.mealRegistrationMeal.createMany({
          data: resolved.resolved.map((r) => ({
            registrationId,
            mealKind: r.mealKind,
            applied: r.applied,
            exempt: r.exempt,
            weekdaysByMonth: r.weekdaysByMonth,
          })),
        });

        const dateRows = resolved.resolved.flatMap((r) =>
          r.dates.map((d) => ({
            registrationId,
            mealKind: r.mealKind,
            date: dateKeyToUtcDate(d),
          })),
        );
        if (dateRows.length > 0) {
          await tx.mealRegistrationMealDate.createMany({
            data: dateRows,
            skipDuplicates: true,
          });
        }

        return { ok: true };
      },
    );

    if ("error" in written) {
      return NextResponse.json({ error: written.error }, { status: 400 });
    }

    return NextResponse.json({ registration: { id: registrationId } });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const registrationId = parseIdParam((await params).regId);

    const reg = await prisma.mealRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, applicationId: true, userId: true },
    });
    if (!reg) {
      return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
    }

    await withEligibilityMutation(
      prisma,
      actor,
      {
        scope: "REGISTRATION",
        applicationId: reg.applicationId,
        userId: reg.userId,
      },
      async (tx) => {
        await getRegistrationContext(tx, actor, reg.applicationId, reg.userId, "CANCEL");
        return tx.mealRegistration.delete({ where: { id: registrationId } });
      },
    );

    return NextResponse.json({ success: true });
  });
}
