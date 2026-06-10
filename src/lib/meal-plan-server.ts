import { prisma } from "@/lib/prisma";
import { dateKeyToUtcDate } from "@/lib/date-range";
import type { AdminApplicationInput, StudentRegisterInput } from "@/lib/schemas/meal-plan";
import { buildAppTitle, monthKeyOf, weekdayOf, MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-plan";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────
// Shared registration resolution
// ──────────────────────────────────────────────

export type ResolvedMealSelection = {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  weekdaysByMonth: string | null; // JSON-serialised or null
  dates: string[]; // "YYYY-MM-DD"
};

/**
 * Resolves the student's meal selection into concrete date lists.
 * Returns { ok: false, error } instead of throwing so the caller can return HTTP 400.
 */
export async function resolveRegistrationSelections(
  applicationId: number,
  grade: number,
  meals: StudentRegisterInput["meals"],
): Promise<{ ok: true; resolved: ResolvedMealSelection[] } | { ok: false; error: string }> {
  const [appMeals, openRows] = await Promise.all([
    prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
    prisma.mealApplicationMealDate.findMany({ where: { applicationId, grade } }),
  ]);

  const openByKind = new Map<MealKind, string[]>();
  for (const row of openRows) {
    const key = row.mealKind as MealKind;
    const dateKey = toDateKey(row.date);
    const arr = openByKind.get(key);
    if (arr) {
      arr.push(dateKey);
    } else {
      openByKind.set(key, [dateKey]);
    }
  }
  for (const [k, arr] of openByKind) {
    openByKind.set(k, arr.sort());
  }

  const resolved: ResolvedMealSelection[] = [];

  for (const mealInput of meals) {
    const kind = mealInput.mealKind as MealKind;
    const conf = appMeals.find((m) => m.mealKind === kind);

    if (!conf || conf.method === "NONE") {
      return { ok: false, error: "신청할 수 없는 식사입니다." };
    }

    if (mealInput.exempt && !conf.exemptionSelectable) {
      return { ok: false, error: "면제를 선택할 수 없습니다." };
    }

    const open = openByKind.get(kind) ?? [];
    let dates: string[] = [];

    if (mealInput.applied) {
      if (conf.method === "YN") {
        dates = open;
      } else if (conf.method === "WEEKDAY") {
        const byMonth = mealInput.weekdaysByMonth ?? {};
        dates = open.filter((d) => (byMonth[monthKeyOf(d)] ?? []).includes(weekdayOf(d)));
      } else {
        // DATE
        const sel = new Set(mealInput.selectedDates ?? []);
        const invalidDate = [...sel].some((d) => !open.includes(d));
        if (invalidDate) {
          return { ok: false, error: "선택할 수 없는 날짜가 포함되어 있습니다." };
        }
        dates = [...sel].sort();
      }

      if (dates.length === 0) {
        return { ok: false, error: `${MEAL_LABEL[kind]} 신청 날짜가 없습니다.` };
      }
    }

    resolved.push({
      mealKind: kind,
      applied: mealInput.applied,
      exempt: mealInput.exempt,
      weekdaysByMonth:
        conf.method === "WEEKDAY" && mealInput.weekdaysByMonth
          ? JSON.stringify(mealInput.weekdaysByMonth)
          : null,
      dates,
    });
  }

  if (resolved.every((r) => !r.applied)) {
    return { ok: false, error: "신청할 식사를 선택해주세요." };
  }

  return { ok: true, resolved };
}

/**
 * Writes (upserts) a MealRegistration and its meal/date rows inside a transaction.
 * Returns { registrationId, created } — created=true on INSERT, false on UPDATE.
 */
export async function writeRegistration(
  tx: PrismaTx,
  applicationId: number,
  userId: number,
  signature: string,
  resolved: ResolvedMealSelection[],
  addedBy?: "ADMIN",
): Promise<{ registrationId: number; created: boolean }> {
  const existing = await tx.mealRegistration.findUnique({
    where: { applicationId_userId: { applicationId, userId } },
    select: { id: true },
  });

  const parent = existing
    ? await tx.mealRegistration.update({
        where: { id: existing.id },
        data: {
          status: "APPROVED",
          signature,
          cancelledAt: null,
          cancelledBy: null,
          ...(addedBy ? { addedBy } : {}),
        },
      })
    : await tx.mealRegistration.create({
        data: {
          applicationId,
          userId,
          signature,
          status: "APPROVED",
          ...(addedBy ? { addedBy } : {}),
        },
      });

  await tx.mealRegistrationMeal.deleteMany({ where: { registrationId: parent.id } });
  await tx.mealRegistrationMealDate.deleteMany({ where: { registrationId: parent.id } });

  await tx.mealRegistrationMeal.createMany({
    data: resolved.map((r) => ({
      registrationId: parent.id,
      mealKind: r.mealKind,
      applied: r.applied,
      exempt: r.exempt,
      weekdaysByMonth: r.weekdaysByMonth,
    })),
  });

  const dateRows = resolved.flatMap((r) =>
    r.dates.map((d) => ({
      registrationId: parent.id,
      mealKind: r.mealKind,
      date: dateKeyToUtcDate(d),
    })),
  );

  if (dateRows.length > 0) {
    await tx.mealRegistrationMealDate.createMany({ data: dateRows, skipDuplicates: true });
  }

  return { registrationId: parent.id, created: !existing };
}

// ──────────────────────────────────────────────
// Application management
// ──────────────────────────────────────────────

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
    where: { applicationId, status: "APPROVED" },
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
