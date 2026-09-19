import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/meal-plan-server";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import {
  gradeFor,
  resolveApplicationYear,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("STUDENT");
    const userId = selfUserId(actor);
    const applicationId = parseIdParam((await params).id);

    const stored = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      select: { academicYear: true },
    });
    if (!stored) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }

    const mode = await rosterMode(prisma);
    const year = await resolveApplicationYear(prisma, mode, stored.academicYear);
    const profiles = await getAcademicProfiles(prisma, [userId], year);
    if (!profiles.get(userId) && mode === "READY") {
      throw new DomainError("MISSING_PROFILE", "해당 학년도의 학적 정보가 없습니다.");
    }
    const grade = await gradeFor(prisma, mode, profiles.get(userId), userId);

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
        where: { applicationId_userId: { applicationId, userId } },
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
  });
}
