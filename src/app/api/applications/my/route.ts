import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calcMealFee } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-plan";
import { routeResponse } from "@/lib/academic-year/api";
import { applicationYearOrNull, rosterMode } from "@/lib/academic-year/registration-context";
import { activeYear } from "@/lib/academic-year/roster-service";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

// 본인 이력은 졸업·전출 여부와 무관하게 계속 보여 준다.
export async function GET() {
  return routeResponse(readMyRegistrations);
}

async function readMyRegistrations(): Promise<NextResponse> {
  const userId = selfUserId(await requireActor("SIGNED_IN"));

  const registrations = await prisma.mealRegistration.findMany({
    where: { userId },
    include: {
      application: {
        select: {
          id: true,
          title: true,
          academicYear: true,
          applyStartAt: true,
          applyEndAt: true,
          meals: true,
        },
      },
      meals: true,
      mealDates: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const mode = await rosterMode(prisma);
  const current = await activeYear(prisma);

  const result = registrations.map((reg) => {
    const mealDateCountByKind = new Map<MealKind, number>();
    for (const d of reg.mealDates) {
      const k = d.mealKind as MealKind;
      mealDateCountByKind.set(k, (mealDateCountByKind.get(k) ?? 0) + 1);
    }

    const meals = reg.meals
      .filter((m) => m.applied)
      .map((m) => {
        const kind = m.mealKind as MealKind;
        const appMeal = reg.application.meals.find((am) => am.mealKind === kind);
        const price = appMeal?.price ?? 0;
        const dayCount = mealDateCountByKind.get(kind) ?? 0;
        const fee = calcMealFee(price, dayCount, m.exempt);
        return {
          mealKind: kind,
          applied: m.applied,
          exempt: m.exempt,
          dayCount,
          price,
          fee,
        };
      });

    return {
      id: reg.id,
      status: reg.status,
      createdAt: reg.createdAt,
      academicYear: applicationYearOrNull(reg.application.academicYear, mode, current),
      application: {
        id: reg.application.id,
        title: reg.application.title,
        applyStartAt: reg.application.applyStartAt,
        applyEndAt: reg.application.applyEndAt,
      },
      meals,
    };
  });

  return NextResponse.json({ registrations: result });
}

