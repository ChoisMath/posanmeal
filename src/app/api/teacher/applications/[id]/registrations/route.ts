import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import {
  applicationYearOrNull,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import {
  compareByProfile,
  displayNameOf,
  getReportProfiles,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";
import { getTeacherScope, listScopeStudentIds } from "@/lib/academic-year/teacher-scope";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return routeResponse(async () => {
    const actor = await requireActor("TEACHER");
    const scope = await getTeacherScope(prisma, actor);
    if (!scope) {
      throw new DomainError("FORBIDDEN", "담임 교사가 아닙니다.");
    }

    const applicationId = parseIdParam((await params).id);
    const application = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        title: true,
        academicYear: true,
        meals: { select: { mealKind: true, method: true, exemptionSelectable: true } },
      },
    });

    const mode = await rosterMode(prisma);
    const academicYear = application
      ? applicationYearOrNull(application.academicYear, mode, scope.year)
      : null;
    // 없는 공고와 지난 학년도 공고에 같은 답을 준다. 담임에게 "그 공고가 있긴 하다"는
    // 사실조차 알리지 않는다 — 지난 해 학급 자료는 관리자 조회로만 연다.
    if (!application || academicYear !== scope.year) {
      throw new DomainError("FORBIDDEN", "담당 학급의 공고가 아닙니다.");
    }

    const studentIds = await listScopeStudentIds(prisma, scope);

    const registrationRows = studentIds.length === 0 ? [] : await prisma.mealRegistration.findMany({
      where: { applicationId, status: "APPROVED", userId: { in: studentIds } },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        addedBy: true,
        signature: true,
        meals: { select: { mealKind: true, applied: true, exempt: true } },
      },
    });

    const profiles = await getReportProfiles(
      prisma,
      registrationRows.map((r) => r.userId),
      academicYear,
      false,
    );

    const regIds = registrationRows.map((r) => r.id);
    const dayCounts = regIds.length > 0
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
      .sort((a, b) => compareByProfile(profiles.get(a.userId), profiles.get(b.userId), "STUDENT"))
      .map((r) => {
        const report = profiles.get(r.userId);
        return {
          id: r.id,
          createdAt: r.createdAt,
          addedBy: r.addedBy,
          signature: r.signature,
          user: {
            number: report?.historical?.number ?? null,
            name: displayNameOf(report),
          },
          ...(report?.warning ? { profileWarning: report.warning } : {}),
          meals: r.meals.map((m) => ({
            mealKind: m.mealKind,
            applied: m.applied,
            exempt: m.exempt,
            dayCount: dayCountMap.get(`${r.id}:${m.mealKind}`) ?? 0,
          })),
        };
      });

    return NextResponse.json({ application, academicYear, registrations });
  });
}
