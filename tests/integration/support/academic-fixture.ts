import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/lib/academic-year/contracts";
import { adminApplicationSchema, type AdminApplicationInput } from "@/lib/schemas/meal-plan";
import { backfill2026, verifyBackfill } from "@/lib/academic-year/backfill";
import { enableAcademicMode } from "@/lib/academic-year/readiness";
import type { Client } from "pg";
import { captureLegacyFingerprint } from "../../../scripts/academic-year/fingerprint";
import { openAcademicTestPgClient } from "./db";
import { seedLegacyFixture, type LegacyFixtureIds } from "./legacy-fixture";

/** 합성 AccessEvent의 고정 시각. 실제 backfill의 확인 시각을 소급하지 않는다. */
const SYNTHETIC_ACCESS_EVENT_AT = new Date("2026-09-18T00:00:00.000Z");

export interface AcademicFixture extends LegacyFixtureIds {
  version: number;
  main: Actor;
  writer: Actor;
}

/**
 * Task 5 이후 테스트가 쓰는 준비 상태. 기준 데이터를 심고 초기 이전과 원본
 * 검증을 거친 뒤 테스트에서만 READY로 올린다.
 */
export async function prepareAcademicFixture(db: PrismaClient, pgClient?: Client): Promise<AcademicFixture> {
  const ownsClient = pgClient === undefined;
  const client = pgClient ?? (await openAcademicTestPgClient());

  try {
    const ids = await seedLegacyFixture(db);

    const before = await captureLegacyFingerprint(client);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(client);

    const verified = await verifyBackfill(db, before, after);
    if (!verified.canEnable) {
      throw new Error(`fixture 초기 이전 검증 실패: ${verified.issues.join(", ")}`);
    }

    const main: Actor = { kind: "MAIN", userId: null, sessionVersion: null };
    await enableAcademicMode(db, main);

    const teacher = await db.user.findUniqueOrThrow({ where: { id: ids.teacherId } });
    await db.userAccessEvent.create({
      data: {
        userId: teacher.id,
        state: "ACTIVE",
        reason: "FIXTURE",
        effectiveAt: SYNTHETIC_ACCESS_EVENT_AT,
      },
    });

    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });

    return {
      ...ids,
      version: control.version,
      main,
      writer: { kind: "USER", userId: teacher.id, sessionVersion: teacher.sessionVersion },
    };
  } finally {
    if (ownsClient) await client.end();
  }
}

export type FixtureApplication = Prisma.MealApplicationGetPayload<{
  include: { meals: true; mealDates: true };
}>;

/** 저장된 공고를 그대로 다시 저장할 수 있는 입력으로 되돌린다. */
export function applicationInputFromFixture(app: FixtureApplication): AdminApplicationInput {
  return adminApplicationSchema.parse({
    academicYear: app.academicYear,
    subject: app.title,
    description: app.description ?? "",
    startYear: app.startYear,
    startMonth: app.startMonth,
    monthCount: app.monthCount,
    applyStartAt: app.applyStartAt?.toISOString(),
    applyEndAt: app.applyEndAt?.toISOString(),
    meals: app.meals.map((meal) => ({
      mealKind: meal.mealKind,
      price: meal.price,
      exemptionSelectable: meal.exemptionSelectable,
      method: meal.method,
      dates: app.mealDates
        .filter((day) => day.mealKind === meal.mealKind)
        .map((day) => ({ grade: day.grade, date: day.date.toISOString().slice(0, 10) })),
    })),
  });
}
