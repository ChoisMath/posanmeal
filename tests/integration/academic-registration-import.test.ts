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

  // 확정 연도 기록에는 좌석 unique가 걸려 있어 후보가 둘일 수 없다. 후보가 겹칠 수
  // 있는 자리는 좌석 제약이 없는 PREPARING의 User 표뿐이다.
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
