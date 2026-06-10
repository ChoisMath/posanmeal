import { prisma } from "@/lib/prisma";
import { dateKeyToUtcDate } from "@/lib/date-range";
import type { AdminApplicationInput } from "@/lib/schemas/meal-plan";
import { buildAppTitle } from "@/lib/meal-plan";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function saveApplication(input: AdminApplicationInput, id?: number) {
  return prisma.$transaction(async (tx) => {
    const data = {
      title: buildAppTitle(input.startYear, input.startMonth, input.subject),
      description: input.description,
      startYear: input.startYear,
      startMonth: input.startMonth,
      monthCount: input.monthCount,
      applyStartAt: new Date(input.applyStartAt),
      applyEndAt: new Date(input.applyEndAt),
      // 구 코드 호환: type="MULTI" 마커 (구 코드의 BREAKFAST 분기를 타지 않게)
      type: "MULTI",
      applyStart: dateKeyToUtcDate(input.applyStartAt.slice(0, 10)),
      applyEnd: dateKeyToUtcDate(input.applyEndAt.slice(0, 10)),
    };

    const app = id
      ? await tx.mealApplication.update({ where: { id }, data })
      : await tx.mealApplication.create({ data });

    await tx.mealApplicationMeal.deleteMany({ where: { applicationId: app.id } });
    await tx.mealApplicationMealDate.deleteMany({ where: { applicationId: app.id } });

    await tx.mealApplicationMeal.createMany({
      data: input.meals.map((m) => ({
        applicationId: app.id,
        mealKind: m.mealKind,
        price: m.price,
        exemptionSelectable: m.exemptionSelectable,
        method: m.method,
      })),
    });

    if (input.meals.some((m) => m.dates.length > 0)) {
      await tx.mealApplicationMealDate.createMany({
        data: input.meals.flatMap((m) =>
          m.dates.map((d) => ({
            applicationId: app.id,
            mealKind: m.mealKind,
            grade: d.grade,
            date: dateKeyToUtcDate(d.date),
          })),
        ),
        skipDuplicates: true,
      });
    }

    if (id) await resyncRegistrations(tx, app.id);

    return app;
  });
}

export async function resyncRegistrations(tx: PrismaTx, applicationId: number) {
  const meals = await tx.mealApplicationMeal.findMany({ where: { applicationId } });
  const openDates = await tx.mealApplicationMealDate.findMany({ where: { applicationId } });
  const regs = await tx.mealRegistration.findMany({
    where: { applicationId },
    include: { user: { select: { grade: true } }, meals: true },
  });

  for (const reg of regs) {
    const grade = reg.user.grade ?? 0;
    for (const meal of meals) {
      const open = openDates
        .filter((d) => d.mealKind === meal.mealKind && d.grade === grade)
        .map((d) => d.date);
      const regMeal = reg.meals.find((m) => m.mealKind === meal.mealKind);
      if (!regMeal?.applied) continue;

      if (meal.method === "YN") {
        await tx.mealRegistrationMealDate.deleteMany({
          where: { registrationId: reg.id, mealKind: meal.mealKind },
        });
        if (open.length > 0) {
          await tx.mealRegistrationMealDate.createMany({
            data: open.map((date) => ({
              registrationId: reg.id,
              mealKind: meal.mealKind,
              date,
            })),
            skipDuplicates: true,
          });
        }
      } else {
        if (open.length > 0) {
          await tx.mealRegistrationMealDate.deleteMany({
            where: { registrationId: reg.id, mealKind: meal.mealKind, date: { notIn: open } },
          });
        } else {
          await tx.mealRegistrationMealDate.deleteMany({
            where: { registrationId: reg.id, mealKind: meal.mealKind },
          });
        }
      }
    }
  }
}
