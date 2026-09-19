import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { requireActor } from "@/lib/academic-year/request-actor";
import { getTeacherScope } from "@/lib/academic-year/teacher-scope";

export async function GET() {
  return routeResponse(async () => {
    const actor = await requireActor("TEACHER");
    const scope = await getTeacherScope(prisma, actor);
    if (!scope) {
      throw new DomainError("FORBIDDEN", "담임 교사가 아닙니다.");
    }

    const applications = await prisma.mealApplication.findMany({
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

    return NextResponse.json({ applications });
  });
}
