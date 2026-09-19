import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { saveApplication } from "@/lib/meal-plan-server";
import type { AdminApplicationInput } from "@/lib/schemas/meal-plan";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import {
  applicationInputFromFixture,
  prepareAcademicFixture,
  type AcademicFixture,
} from "./support/academic-fixture";

vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});

const dateOrder = [{ registrationId: "asc" }, { mealKind: "asc" }, { date: "asc" }] as const;
const ACTIVE_YEAR = 2026;

describe("academic year resync", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let input: AdminApplicationInput;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
    input = applicationInputFromFixture(
      await db.mealApplication.findUniqueOrThrow({
        where: { id: fx.applicationId },
        include: { meals: true, mealDates: true },
      }),
    );
  });

  function confirmedDates() {
    return db.mealRegistrationMealDate.findMany({ orderBy: [...dateOrder] });
  }

  function events() {
    return db.eligibilityEvent.count({ where: { scope: "APPLICATION" } });
  }

  it("공고 학년도가 초기 이전으로 채워져 있다", () => {
    expect(input.academicYear).toBe(ACTIVE_YEAR);
  });

  it("제목만 고치면 확정일이 한 행도 바뀌지 않고 증거도 남기지 않는다", async () => {
    const before = await confirmedDates();
    await db.eligibilityEvent.deleteMany({});

    await saveApplication(fx.main, { ...input, subject: "제목만 정정" }, fx.applicationId);

    expect(await confirmedDates()).toEqual(before);
    expect(await events()).toBe(0);
  });

  it("금액·안내문·접수 기간만 고쳐도 재계산하지 않는다", async () => {
    const before = await confirmedDates();
    await db.eligibilityEvent.deleteMany({});

    await saveApplication(
      fx.main,
      {
        ...input,
        description: "안내문 수정",
        applyEndAt: "2026-10-31T23:59:00+09:00",
        meals: input.meals.map((meal) => ({ ...meal, price: meal.price + 1000 })),
      },
      fx.applicationId,
    );

    expect(await confirmedDates()).toEqual(before);
    expect(await events()).toBe(0);
  });

  it("개설일을 고치면 재계산하고 증거를 남긴다", async () => {
    await db.eligibilityEvent.deleteMany({});

    await saveApplication(
      fx.main,
      {
        ...input,
        meals: input.meals.map((meal) => ({
          ...meal,
          dates: meal.dates.filter((d) => d.date !== "2026-09-19"),
        })),
      },
      fx.applicationId,
    );

    expect((await confirmedDates()).map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-18",
    ]);
    expect(await events()).toBe(1);
  });

  it("진급 뒤에도 지난 공고는 그 해(2026) 학년으로 재계산한다", async () => {
    // 학생은 2027학년도에 2학년이 되고 현재 User 행도 그 값으로 바뀐다.
    await db.academicYear.create({ data: { year: 2027, state: "DRAFT", version: 0 } });
    await db.userAcademicRecord.create({
      data: {
        year: 2027,
        userId: fx.studentId,
        role: "STUDENT",
        name: "학생테스트",
        grade: 2,
        classNum: 1,
        number: 1,
        memberState: "ENROLLED",
      },
    });
    await db.user.update({ where: { id: fx.studentId }, data: { grade: 2 } });

    await saveApplication(
      fx.main,
      {
        ...input,
        meals: input.meals.map((meal) => ({
          ...meal,
          dates: [...meal.dates, { grade: 2, date: "2026-09-25" }],
        })),
      },
      fx.applicationId,
    );

    expect((await confirmedDates()).map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-18",
      "2026-09-19",
    ]);
  });

  it("연도 기록이 없으면 확정일을 지우기 전에 되돌린다", async () => {
    const before = await confirmedDates();
    await db.userAcademicRecord.deleteMany({ where: { userId: fx.studentId } });

    await expect(
      saveApplication(
        fx.main,
        {
          ...input,
          meals: input.meals.map((meal) => ({
            ...meal,
            dates: meal.dates.filter((d) => d.date !== "2026-09-19"),
          })),
        },
        fx.applicationId,
      ),
    ).rejects.toMatchObject({ code: "MISSING_PROFILE" });

    expect(await confirmedDates()).toEqual(before);
  });

  it("신청이 있는 공고의 학년도는 바꿀 수 없다", async () => {
    await db.academicYear.create({ data: { year: 2027, state: "DRAFT", version: 0 } });
    await expect(
      saveApplication(fx.main, { ...input, academicYear: 2027 }, fx.applicationId),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });

  it("PREPARING에서는 학년도 없는 입력이 운영 연도로 채워진다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    const saved = await saveApplication(fx.main, {
      ...input,
      academicYear: undefined,
      subject: "새 공고",
    });
    expect(saved.academicYear).toBe(ACTIVE_YEAR);
  });

  it("PREPARING에서 학년도를 보내지 않아도 2월→3월 경계 공고는 거절한다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    await expect(
      saveApplication(fx.main, {
        ...input,
        academicYear: undefined,
        subject: "경계 공고",
        startYear: 2027,
        startMonth: 2,
        monthCount: 2,
        meals: input.meals.map((meal) => ({
          ...meal,
          dates: [{ grade: 1, date: "2027-02-10" }],
        })),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("READY에서는 학년도 없는 새 공고를 거절한다", async () => {
    await expect(
      saveApplication(fx.main, { ...input, academicYear: undefined, subject: "새 공고" }),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });
});
