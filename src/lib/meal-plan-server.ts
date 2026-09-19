import { prisma } from "@/lib/prisma";
import { dateKeyToUtcDate } from "@/lib/date-range";
import {
  isWithinAcademicYear,
  YEAR_SPAN_MESSAGE,
  type AdminApplicationInput,
  type StudentRegisterInput,
} from "@/lib/schemas/meal-plan";
import { buildAppTitle, monthKeyOf, weekdayOf, MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-plan";
import type { Actor } from "@/lib/academic-year/contracts";
import { DomainError } from "@/lib/academic-year/errors";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import { gradeFor, resolveApplicationYear, rosterMode } from "@/lib/academic-year/registration-context";

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

export type ResolveContext = {
  appMeals: { mealKind: string; method: string; exemptionSelectable: boolean }[];
  openRows: { mealKind: string; date: Date }[];
};

/**
 * Resolves the student's meal selection into concrete date lists.
 * Returns { ok: false, error } instead of throwing so the caller can return HTTP 400.
 * Pass ctx to skip DB queries when the caller already has the data (N+1 prevention).
 */
export async function resolveRegistrationSelections(
  applicationId: number,
  grade: number,
  meals: StudentRegisterInput["meals"],
  ctx?: ResolveContext,
): Promise<{ ok: true; resolved: ResolvedMealSelection[] } | { ok: false; error: string }> {
  const [appMeals, openRows] = ctx
    ? [ctx.appMeals, ctx.openRows]
    : await Promise.all([
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

/**
 * 자격에 영향을 주는 입력만 골라 정규화한 지문. 제목·설명·접수 안내·금액은
 * 학생의 확정 식사일을 바꾸지 않으므로 여기에 넣지 않는다 — 넣으면 제목만 고쳐도
 * 모든 신청의 확정일이 지워졌다 다시 쓰인다.
 */
export function eligibilitySignature(source: {
  startYear: number;
  startMonth: number;
  monthCount: number;
  meals: { mealKind: string; method: string; exemptionSelectable: boolean }[];
  dates: { mealKind: string; grade: number; date: string }[];
}): string {
  const meals = [...source.meals]
    .map((m) => ({
      mealKind: m.mealKind,
      method: m.method,
      exemptionSelectable: m.exemptionSelectable,
    }))
    .sort((a, b) => a.mealKind.localeCompare(b.mealKind));
  const dates = [...new Set(source.dates.map((d) => `${d.mealKind}|${d.grade}|${d.date}`))].sort();

  return JSON.stringify({
    months: [source.startYear, source.startMonth, source.monthCount],
    meals,
    dates,
  });
}

function signatureOfInput(input: AdminApplicationInput): string {
  return eligibilitySignature({
    startYear: input.startYear,
    startMonth: input.startMonth,
    monthCount: input.monthCount,
    meals: input.meals,
    dates: input.meals.flatMap((m) => m.dates.map((d) => ({ ...d, mealKind: m.mealKind }))),
  });
}

async function signatureOfStored(tx: PrismaTx, applicationId: number): Promise<string> {
  const [app, meals, dates] = await Promise.all([
    tx.mealApplication.findUniqueOrThrow({
      where: { id: applicationId },
      select: { startYear: true, startMonth: true, monthCount: true },
    }),
    tx.mealApplicationMeal.findMany({ where: { applicationId } }),
    tx.mealApplicationMealDate.findMany({ where: { applicationId } }),
  ]);

  return eligibilitySignature({
    startYear: app.startYear ?? 0,
    startMonth: app.startMonth ?? 0,
    monthCount: app.monthCount ?? 0,
    meals,
    dates: dates.map((d) => ({ mealKind: d.mealKind, grade: d.grade, date: toDateKey(d.date) })),
  });
}

export type SavedApplication = { id: number; academicYear: number; eligibilityChanged: boolean };

export async function saveApplication(
  actor: Actor,
  input: AdminApplicationInput,
  id?: number,
): Promise<SavedApplication> {
  return withEligibilityMutation<SavedApplication>(
    prisma,
    actor,
    {
      scope: "APPLICATION",
      require: "WRITE_ADMIN",
      applicationId: id,
      applicationIdOf: (saved) => saved.id,
      recorded: (saved) => saved.eligibilityChanged,
    },
    (tx) => writeApplication(tx, input, id),
  );
}

async function writeApplication(
  tx: PrismaTx,
  input: AdminApplicationInput,
  id?: number,
): Promise<SavedApplication> {
  const existing = id
    ? await tx.mealApplication.findUniqueOrThrow({
        where: { id },
        select: { academicYear: true },
      })
    : null;

  const mode = await rosterMode(tx);
  const academicYear = await resolveApplicationYear(
    tx,
    mode,
    input.academicYear ?? existing?.academicYear ?? null,
  );

  if (existing && existing.academicYear !== null && existing.academicYear !== academicYear) {
    const registrations = await tx.mealRegistration.count({ where: { applicationId: id } });
    if (registrations > 0) {
      throw new DomainError("YEAR_MISMATCH", "신청이 있는 공고의 학년도는 바꿀 수 없습니다.");
    }
  }

  // 학년도가 정해진 뒤에 다시 잰다. 입력이 학년도를 보내지 않는 경로(PREPARING과
  // 아직 학년도 칸이 없는 관리자 화면)에서는 zod가 이 판정을 할 수 없다.
  if (!isWithinAcademicYear(academicYear, input)) {
    throw new DomainError("INVALID_INPUT", YEAR_SPAN_MESSAGE);
  }

  const before = id ? await signatureOfStored(tx, id) : null;
  const after = signatureOfInput(input);

  const data = {
    title: buildAppTitle(input.startYear, input.startMonth, input.subject),
    description: input.description,
    startYear: input.startYear,
    startMonth: input.startMonth,
    monthCount: input.monthCount,
    applyStartAt: new Date(input.applyStartAt),
    applyEndAt: new Date(input.applyEndAt),
    academicYear,
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

  const eligibilityChanged = before === null || before !== after;
  if (id && eligibilityChanged) await resyncRegistrations(tx, app.id);

  return { id: app.id, academicYear, eligibilityChanged };
}

export async function resyncRegistrations(tx: PrismaTx, applicationId: number) {
  const application = await tx.mealApplication.findUniqueOrThrow({
    where: { id: applicationId },
    select: { academicYear: true },
  });
  const mode = await rosterMode(tx);
  const year = await resolveApplicationYear(tx, mode, application.academicYear);

  const meals = await tx.mealApplicationMeal.findMany({ where: { applicationId } });
  const openDates = await tx.mealApplicationMealDate.findMany({ where: { applicationId } });
  const regs = await tx.mealRegistration.findMany({
    where: { applicationId, status: "APPROVED" },
    include: { meals: true },
  });

  // 확정일을 하나라도 지우기 전에 모든 학생의 연도 학년을 확인한다. 도중에
  // 멈추면 이미 지운 사람만 신청이 비어 버린다.
  const profiles = await getAcademicProfiles(tx, regs.map((reg) => reg.userId), year);
  const gradeByUser = new Map<number, number>();
  for (const reg of regs) {
    const grade = await gradeFor(tx, mode, profiles.get(reg.userId), reg.userId);
    gradeByUser.set(reg.userId, grade ?? 0);
  }

  for (const reg of regs) {
    const grade = gradeByUser.get(reg.userId) ?? 0;
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
