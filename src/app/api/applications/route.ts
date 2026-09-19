import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

export async function GET() {
  return routeResponse(async () => {
    const actor = await requireActor("STUDENT");
    const userId = selfUserId(actor);

    const now = new Date();
    const draftYears = await prisma.academicYear.findMany({
      where: { state: "DRAFT" },
      select: { year: true },
    });

    const applications = await prisma.mealApplication.findMany({
      where: {
        status: "OPEN",
        applyStartAt: { lte: now },
        applyEndAt: { gte: now },
        // 초안 학년도 공고는 작성해 둘 수 있을 뿐 접수 대상이 아니다.
        NOT: { academicYear: { in: draftYears.map((y) => y.year) } },
      },
      include: {
        meals: true,
        registrations: {
          where: { userId },
          select: { id: true, status: true },
        },
      },
      orderBy: { applyEndAt: "asc" },
    });

    const result = applications.map((app) => {
      const reg = app.registrations[0];
      let myStatus: "NONE" | "APPLIED" | "CANCELLED" = "NONE";
      if (reg) {
        myStatus = reg.status === "CANCELLED" ? "CANCELLED" : "APPLIED";
      }

      return {
        id: app.id,
        title: app.title,
        description: app.description,
        applyStartAt: app.applyStartAt,
        applyEndAt: app.applyEndAt,
        meals: app.meals
          .filter((m) => m.method !== "NONE")
          .map((m) => ({
            mealKind: m.mealKind,
            price: m.price,
            method: m.method,
            exemptionSelectable: m.exemptionSelectable,
          })),
        myStatus,
      };
    });

    return NextResponse.json({ applications: result });
  });
}
