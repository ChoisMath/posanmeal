import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calcMealFee } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-plan";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registrations = await prisma.mealRegistration.findMany({
    where: { userId: session.user.dbUserId },
    include: {
      application: {
        select: {
          id: true,
          title: true,
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
