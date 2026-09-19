import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { createDraftYear } from "@/lib/academic-year/roster-service";
import { TEMPLATE_FIXED_HEADERS } from "@/lib/meal-template-columns";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});

const MEAL_HEADERS = ["석식-9월 18일", "석식-9월 19일"];

async function buildSheet(
  headers: string[],
  rows: (string | number)[][],
): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("일괄신청양식");
  headers.forEach((h, i) => {
    sheet.getRow(1).getCell(i + 1).value = h;
  });
  sheet.getRow(2).getCell(1).value = "안내";
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      sheet.getRow(3 + r).getCell(c + 1).value = value;
    });
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], "import.xlsx");
}

function importRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/admin/applications/1/import", {
    method: "POST",
    body: form,
  });
}

describe("registration excel import", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let POST: typeof import("@/app/api/admin/applications/[id]/import/route").POST;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    ({ POST } = await import("@/app/api/admin/applications/[id]/import/route"));
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
  });

  function run(file: File) {
    return POST(importRequest(file), { params: Promise.resolve({ id: String(fx.applicationId) }) });
  }

  function confirmedDates() {
    return db.mealRegistrationMealDate.findMany({ orderBy: { date: "asc" } });
  }

  it("이메일 양식은 이메일로 학생을 찾아 신청을 갱신한다", async () => {
    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [["student-test@example.posan.kr", 1, 1, 1, "학생테스트", "O", ""]],
    );

    const response = await run(file);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 0, updated: 1, skippedNotFound: 0 });
    expect((await confirmedDates()).map((d) => d.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-18",
    ]);
  });

  it("옛 양식에서 같은 학번 후보가 둘이면 아무것도 쓰지 않고 거절한다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    await db.user.create({
      data: {
        email: "twin@example.posan.kr",
        name: "쌍둥이",
        role: "STUDENT",
        grade: 1,
        classNum: 1,
        number: 1,
      },
    });

    const before = await confirmedDates();
    const file = await buildSheet(
      ["학년", "반", "번호", "이름", ...MEAL_HEADERS],
      [[1, 1, 1, "학생테스트", "O", ""]],
    );

    const response = await run(file);
    expect(response.status).toBe(409);
    expect(await confirmedDates()).toEqual(before);
  });

  async function reuseTransferredStudentNumber() {
    await db.userAcademicRecord.update({
      where: { year_userId: { year: 2026, userId: fx.studentId } },
      data: { memberState: "TRANSFERRED" },
    });
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });
    return db.user.create({
      data: {
        email: "reused-number@example.posan.kr",
        emailKey: "reused-number@example.posan.kr",
        name: "새학생",
        role: "STUDENT",
        grade: 1,
        classNum: 1,
        number: 1,
        academicRecords: { create: {
          year: 2026,
          name: "새학생",
          role: "STUDENT",
          grade: 1,
          classNum: 1,
          number: 1,
          memberState: "ENROLLED",
        } },
      },
    });
  }

  it("READY에서 전출자와 재학생이 같은 학번이면 구양식의 오등록을 전체 차단한다", async () => {
    const newcomer = await reuseTransferredStudentNumber();
    const before = {
      registration: await db.mealRegistration.findUniqueOrThrow({
        where: { id: fx.registrationId }, include: { meals: true, mealDates: true },
      }),
      events: await db.eligibilityEvent.count(),
    };
    const response = await run(await buildSheet(
      ["학년", "반", "번호", "이름", ...MEAL_HEADERS],
      [[1, 1, 1, "학생테스트", "O", ""]],
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_CONFLICT" } });
    expect(await db.mealRegistration.count({ where: { userId: newcomer.id } })).toBe(0);
    expect(await db.mealRegistration.findUniqueOrThrow({
      where: { id: fx.registrationId }, include: { meals: true, mealDates: true },
    })).toEqual(before.registration);
    expect(await db.eligibilityEvent.count()).toBe(before.events);
  });

  it("학번이 재사용되어도 이메일 양식은 전출자의 기존 신청과 재학생을 각각 처리한다", async () => {
    const newcomer = await reuseTransferredStudentNumber();
    const response = await run(await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [
        ["student-test@example.posan.kr", 1, 1, 1, "학생테스트", "O", ""],
        [newcomer.email, 1, 1, 1, newcomer.name, "", "O"],
      ],
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 1, updated: 1, skippedNotFound: 0 });
    const registrations = await db.mealRegistration.findMany({
      where: { applicationId: fx.applicationId },
      include: { mealDates: { orderBy: { date: "asc" } } },
    });
    expect(registrations.find((r) => r.userId === fx.studentId)?.mealDates.map((d) => d.date.toISOString().slice(0, 10)))
      .toEqual(["2026-09-18"]);
    expect(registrations.find((r) => r.userId === newcomer.id)?.mealDates.map((d) => d.date.toISOString().slice(0, 10)))
      .toEqual(["2026-09-19"]);
  });

  it("아무도 등록되지 않으면 EligibilityEvent를 남기지 않는다", async () => {
    await db.eligibilityEvent.deleteMany({});
    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [["없는사람@example.posan.kr", 1, 1, 9, "없음", "O", ""]],
    );

    const response = await run(file);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      added: 0,
      updated: 0,
      skippedNotFound: 1,
      total: 1,
    });
    expect(await db.eligibilityEvent.count()).toBe(0);
  });

  it("바뀐 사람마다 EligibilityEvent를 한 건씩 남긴다", async () => {
    await db.eligibilityEvent.deleteMany({});
    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [["student-test@example.posan.kr", 1, 1, 1, "학생테스트", "O", ""]],
    );

    await run(file);
    const events = await db.eligibilityEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scope: "REGISTRATION",
      applicationId: fx.applicationId,
      userId: fx.studentId,
    });
  });

  it("total은 실제로 처리한 행과 찾지 못한 행만 센다", async () => {
    // 3학년 개설일이 없는 학생: 표시는 있으나 유효 날짜가 없어 처리되지 않는다.
    const noOpen = await db.user.create({
      data: {
        email: "no-open@example.posan.kr",
        emailKey: "no-open@example.posan.kr",
        name: "개설없음",
        role: "STUDENT",
        grade: 3,
        classNum: 1,
        number: 1,
      },
    });
    await db.userAcademicRecord.create({
      data: {
        year: 2026,
        userId: noOpen.id,
        role: "STUDENT",
        name: "개설없음",
        grade: 3,
        classNum: 1,
        number: 1,
        memberState: "ENROLLED",
      },
    });

    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [
        ["student-test@example.posan.kr", 1, 1, 1, "학생테스트", "O", ""],
        ["no-open@example.posan.kr", 3, 1, 1, "개설없음", "O", ""],
        ["없는사람@example.posan.kr", 1, 1, 9, "없음", "O", ""],
      ],
    );

    const body = (await (await run(file)).json()) as Record<string, number>;
    expect(body).toMatchObject({ added: 0, updated: 1, skippedNotFound: 1, skippedInvalid: 1 });
    expect(body.total).toBe(body.added + body.updated + body.skippedNotFound);
  });

  it("400명 일괄 등록이 트랜잭션 시간 안에 끝나고 왕복이 인원수에 비례하지 않는다", async () => {
    const students = await Promise.all(
      Array.from({ length: 400 }, (_, i) =>
        db.user.create({
          data: {
            email: `bulk-${i}@example.posan.kr`,
            emailKey: `bulk-${i}@example.posan.kr`,
            name: `학생${i}`,
            role: "STUDENT",
            grade: 1,
            classNum: Math.floor(i / 40) + 2,
            number: (i % 40) + 1,
          },
        }),
      ),
    );
    await db.userAcademicRecord.createMany({
      data: students.map((user) => ({
        year: 2026,
        userId: user.id,
        role: "STUDENT" as const,
        name: user.name,
        grade: 1,
        classNum: user.classNum,
        number: user.number,
        memberState: "ENROLLED",
      })),
    });

    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      students.map((user) => [user.email, 1, user.classNum ?? 0, user.number ?? 0, user.name, "O", ""]),
    );

    const startedAt = Date.now();
    const response = await run(file);
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: 400, updated: 0, total: 400 });
    expect(await db.eligibilityEvent.count({ where: { scope: "REGISTRATION" } })).toBe(400);
    expect(elapsedMs).toBeLessThan(30_000);
    console.info(`[import 400명] ${elapsedMs}ms`);
  }, 120_000);

  it("초안 학년도 공고는 일괄 등록을 거절한다", async () => {
    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-import",
      kind: "DRAFT",
      payloadHash: "draft-import",
      expectedVersion: control.version,
      year: 2027,
      sourceYear: 2026,
    });
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: 2027 },
    });

    const file = await buildSheet(
      [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS],
      [["student-test@example.posan.kr", 1, 1, 1, "학생테스트", "O", ""]],
    );

    const response = await run(file);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "YEAR_MISMATCH" } });
  });
});
