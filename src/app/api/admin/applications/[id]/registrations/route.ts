import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { studentRegisterSchema } from "@/lib/schemas/meal-plan";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import {
  getRegistrationContext,
  resolveApplicationYear,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import {
  compareByProfile,
  currentClassLabelOf,
  displayNameOf,
  getReportProfiles,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";
import { readYearState } from "@/lib/academic-year/roster-service";
import { z } from "zod";

// Admin body: no signature, just userId + meals
const adminRegisterSchema = z.object({
  userId: z.number().int().positive(),
  meals: studentRegisterSchema.shape.meals,
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const includeCurrent = new URL(request.url).searchParams.get("includeCurrent") === "1";
  return routeResponse(() => listRegistrations(params, includeCurrent));
}

async function listRegistrations(
  params: Promise<{ id: string }>,
  includeCurrent: boolean,
): Promise<NextResponse> {
  await requireActor("READ_ADMIN");
  const applicationId = parseIdParam((await params).id);

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      title: true,
      academicYear: true,
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

  const mode = await rosterMode(prisma);
  const academicYear = await resolveApplicationYear(prisma, mode, application.academicYear);
  const academicYearState = await readYearState(prisma, academicYear);

  const registrationRows = await prisma.mealRegistration.findMany({
    where: { applicationId },
    select: {
      id: true,
      createdAt: true,
      status: true,
      addedBy: true,
      userId: true,
      user: { select: { id: true, email: true } },
      meals: {
        select: { mealKind: true, applied: true, exempt: true },
      },
    },
  });

  const profiles = await getReportProfiles(
    prisma,
    registrationRows.map((r) => r.userId),
    academicYear,
    includeCurrent,
  );

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

  const registrations = registrationRows
    .slice()
    .sort((a, b) => {
      const left = profiles.get(a.userId)?.historical;
      const right = profiles.get(b.userId)?.historical;
      const gradeDiff = (left?.grade ?? 0) - (right?.grade ?? 0);
      if (gradeDiff !== 0) return gradeDiff;
      return compareByProfile(profiles.get(a.userId), profiles.get(b.userId), "STUDENT");
    })
    .map((r) => {
      const report = profiles.get(r.userId);
      const profile = report?.historical;
      return {
        id: r.id,
        createdAt: r.createdAt,
        status: r.status,
        addedBy: r.addedBy,
        user: {
          id: r.user.id,
          email: r.user.email,
          name: displayNameOf(report),
          grade: profile?.grade ?? null,
          classNum: profile?.classNum ?? null,
          number: profile?.number ?? null,
          gender: profile?.gender ?? null,
        },
        ...(report?.warning ? { profileWarning: report.warning } : {}),
        ...(includeCurrent ? { currentClass: currentClassLabelOf(report) } : {}),
        meals: r.meals.map((m) => ({
          mealKind: m.mealKind,
          applied: m.applied,
          exempt: m.exempt,
          dayCount: dayCountMap.get(`${r.id}:${m.mealKind}`) ?? 0,
        })),
      };
    });

  return NextResponse.json({ application, academicYear, academicYearState, registrations });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const applicationId = parseIdParam((await params).id);

    const parsed = adminRegisterSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const input = parsed.data;

    const app = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!app) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }

    const written = await withEligibilityMutation<
      { registrationId: number; created: boolean } | { error: string }
    >(
      prisma,
      actor,
      {
        scope: "REGISTRATION",
        applicationId,
        userId: input.userId,
        recorded: (result) => !("error" in result),
      },
      async (tx) => {
        const existing = await tx.mealRegistration.findUnique({
          where: {
            applicationId_userId: { applicationId, userId: input.userId },
          },
          select: { status: true },
        });
        const intent = existing?.status === "APPROVED" ? "EDIT" : existing ? "RESTORE" : "CREATE";

        const context = await getRegistrationContext(
          tx,
          actor,
          applicationId,
          input.userId,
          intent,
        );
        const resolved = await resolveRegistrationSelections(
          applicationId,
          context.profile.grade ?? 0,
          input.meals,
          context.resolveContext,
        );
        if (!resolved.ok) return { error: resolved.error };

        return writeRegistration(
          tx,
          applicationId,
          input.userId,
          "(관리자 등록)",
          resolved.resolved,
          "ADMIN",
        );
      },
    );

    if ("error" in written) {
      return NextResponse.json({ error: written.error }, { status: 400 });
    }

    return NextResponse.json(
      { registration: { id: written.registrationId } },
      { status: written.created ? 201 : 200 },
    );
  });
}
