import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { applicationYearOrNull, rosterMode } from "@/lib/academic-year/registration-context";
import { requireActor } from "@/lib/academic-year/request-actor";
import { getTeacherScope } from "@/lib/academic-year/teacher-scope";

export async function GET() {
  return routeResponse(async () => {
    const actor = await requireActor("TEACHER");
    const scope = await getTeacherScope(prisma, actor);
    if (!scope) {
      throw new DomainError("FORBIDDEN", "담임 교사가 아닙니다.");
    }

    // 이전 학년도 학급 자료는 관리자 조회로만 연다. 담임에게는 운영 연도 공고만 보인다.
    const mode = await rosterMode(prisma);

    const rows = await prisma.mealApplication.findMany({
      orderBy: { id: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        academicYear: true,
        startYear: true,
        startMonth: true,
        monthCount: true,
        applyStartAt: true,
        applyEndAt: true,
        meals: { select: { mealKind: true, method: true } },
      },
    });

    const applications = rows.filter(
      (row) => applicationYearOrNull(row.academicYear, mode, scope.year) === scope.year,
    );

    return NextResponse.json({ applications, academicYear: scope.year });
  });
}
