import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient, User } from "@/generated/prisma/client";
import type { Client } from "pg";
import { TEMPLATE_FIXED_HEADERS } from "@/lib/meal-template-columns";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

type SessionUser = {
  dbUserId: number;
  role: string;
  adminLevel?: string;
  sessionVersion?: number;
};

const session = vi.hoisted(() => ({ current: null as SessionUser | null }));

vi.mock("@/auth", () => ({
  auth: async () => (session.current ? { user: session.current } : null),
}));

vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});

const MEAL_HEADERS = ["석식-9월 18일", "석식-9월 19일"];
const OPEN_DATE = "2026-09-18";
const DRAFT_YEAR = 2027;

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function emailSheet(...emails: string[]): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("일괄신청양식");
  [...TEMPLATE_FIXED_HEADERS, ...MEAL_HEADERS].forEach((h, i) => {
    sheet.getRow(1).getCell(i + 1).value = h;
  });
  sheet.getRow(2).getCell(1).value = "안내";
  emails.forEach((email, r) => {
    [email, 1, 1, 1, "대상", "O", ""].forEach((value, i) => {
      sheet.getRow(3 + r).getCell(i + 1).value = value;
    });
  });
  return new File([await workbook.xlsx.writeBuffer()], "import.xlsx");
}

function importRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api", { method: "POST", body: form });
}

describe("registration route guards", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let admin: User;
  let routes: {
    studentRegister: typeof import("@/app/api/applications/[id]/register/route");
    adminRegistrations: typeof import("@/app/api/admin/applications/[id]/registrations/route");
    adminRegistration: typeof import("@/app/api/admin/applications/[id]/registrations/[regId]/route");
    adminImport: typeof import("@/app/api/admin/applications/[id]/import/route");
    adminClose: typeof import("@/app/api/admin/applications/[id]/close/route");
    studentApplications: typeof import("@/app/api/applications/route");
  };

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    routes = {
      studentRegister: await import("@/app/api/applications/[id]/register/route"),
      adminRegistrations: await import("@/app/api/admin/applications/[id]/registrations/route"),
      adminRegistration: await import(
        "@/app/api/admin/applications/[id]/registrations/[regId]/route"
      ),
      adminImport: await import("@/app/api/admin/applications/[id]/import/route"),
      adminClose: await import("@/app/api/admin/applications/[id]/close/route"),
      studentApplications: await import("@/app/api/applications/route"),
    };
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
    admin = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    session.current = {
      dbUserId: admin.id,
      role: "TEACHER",
      adminLevel: "ADMIN",
      sessionVersion: admin.sessionVersion,
    };
  });

  function asAdmin() {
    session.current = {
      dbUserId: admin.id,
      role: "TEACHER",
      adminLevel: "ADMIN",
      sessionVersion: admin.sessionVersion,
    };
  }

  function asUser(user: User) {
    session.current = {
      dbUserId: user.id,
      role: user.role,
      adminLevel: user.adminLevel,
      sessionVersion: user.sessionVersion,
    };
  }

  /** 초안 학년도에만 있는 사람. 운영 연도(2026) 기록이 없다. */
  async function makeDraftOnlyStudent(): Promise<User> {
    await db.academicYear.create({ data: { year: DRAFT_YEAR, state: "DRAFT", version: 0 } });
    const user = await db.user.create({
      data: {
        email: "draft-only@example.posan.kr",
        emailKey: "draft-only@example.posan.kr",
        name: "초안전용",
        role: "STUDENT",
        grade: 1,
        classNum: 1,
        number: 9,
      },
    });
    await db.userAcademicRecord.create({
      data: {
        year: DRAFT_YEAR,
        userId: user.id,
        role: "STUDENT",
        name: "초안전용",
        grade: 1,
        classNum: 1,
        number: 9,
        memberState: "ENROLLED",
      },
    });
    return user;
  }

  const appParams = () => ({ params: Promise.resolve({ id: String(fx.applicationId) }) });

  it("초안 학년도에만 있는 학생은 네 CREATE/RESTORE 경로 모두에서 거절된다", async () => {
    const draftOnly = await makeDraftOnlyStudent();

    asUser(draftOnly);
    const selfResponse = await routes.studentRegister.POST(
      jsonRequest("POST", {
        signature: "서명",
        meals: [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: [OPEN_DATE] }],
      }),
      appParams(),
    );
    expect(selfResponse.status).toBe(422);
    expect(await selfResponse.json()).toMatchObject({ error: { code: "MISSING_PROFILE" } });

    asAdmin();
    const proxyResponse = await routes.adminRegistrations.POST(
      jsonRequest("POST", {
        userId: draftOnly.id,
        meals: [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: [OPEN_DATE] }],
      }),
      appParams(),
    );
    expect(proxyResponse.status).toBe(422);

    const cancelled = await db.mealRegistration.create({
      data: {
        applicationId: fx.applicationId,
        userId: draftOnly.id,
        signature: "(관리자 등록)",
        status: "CANCELLED",
      },
    });
    const restoreResponse = await routes.adminRegistration.PATCH(
      jsonRequest("PATCH", { status: "APPROVED" }),
      {
        params: Promise.resolve({
          id: String(fx.applicationId),
          regId: String(cancelled.id),
        }),
      },
    );
    expect(restoreResponse.status).toBe(422);
    expect(
      (await db.mealRegistration.findUniqueOrThrow({ where: { id: cancelled.id } })).status,
    ).toBe("CANCELLED");

    const importResponse = await routes.adminImport.POST(
      importRequest(await emailSheet(draftOnly.email)),
      appParams(),
    );
    expect(importResponse.status).toBe(422);
    expect(await db.mealRegistrationMeal.count({ where: { registrationId: cancelled.id } })).toBe(0);
  });

  it("교사 관리자 계정의 일괄 등록: 아무도 맞지 않아도 200과 예전 요약을 돌려준다", async () => {
    await db.eligibilityEvent.deleteMany({});
    const response = await routes.adminImport.POST(
      importRequest(await emailSheet("없는사람@example.posan.kr")),
      appParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      added: 0,
      updated: 0,
      skippedNotFound: 1,
      total: 1,
    });
    expect(await db.eligibilityEvent.count()).toBe(0);
  });

  it("교사 관리자 계정의 일괄 등록: 맞는 사람이 있으면 그대로 등록된다", async () => {
    const response = await routes.adminImport.POST(
      importRequest(await emailSheet("student-test@example.posan.kr")),
      appParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1, total: 1 });
  });

  it("일괄 등록 실패는 개인정보 없이 문제가 된 시트 줄만 알린다", async () => {
    const draftOnly = await makeDraftOnlyStudent();
    const response = await routes.adminImport.POST(
      importRequest(await emailSheet("student-test@example.posan.kr", draftOnly.email)),
      appParams(),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; message: string; issues?: { row: number; code: string }[] };
    };
    expect(body.error.issues).toEqual([{ row: 4, code: "MISSING_PROFILE" }]);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(draftOnly.email);
    expect(serialised).not.toContain(draftOnly.name);
    // 전체 rollback: 맞는 사람도 바뀌지 않는다.
    expect(await db.mealRegistrationMealDate.count()).toBe(2);
  });

  it("학생 본인은 자기 신청을 그대로 할 수 있다", async () => {
    await db.mealRegistration.deleteMany({ where: { id: fx.registrationId } });
    const studentRow = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    asUser(studentRow);

    const response = await routes.studentRegister.POST(
      jsonRequest("POST", {
        signature: "서명",
        meals: [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: [OPEN_DATE] }],
      }),
      appParams(),
    );
    expect(response.status).toBe(201);
  });

  it("학생이 남의 id로 대리 신청하면 거절된다", async () => {
    const other = await db.user.create({
      data: { email: "other@example.posan.kr", name: "다른학생", role: "STUDENT", grade: 1 },
    });
    const studentRow = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    asUser(studentRow);

    const response = await routes.adminRegistrations.POST(
      jsonRequest("POST", {
        userId: other.id,
        meals: [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: [OPEN_DATE] }],
      }),
      appParams(),
    );
    expect(response.status).toBe(403);
  });

  it("라우트 진입 뒤 권한이 내려가면 공고 쓰기가 트랜잭션 안에서 막힌다", async () => {
    const { prisma } = await import("@/lib/prisma");
    const original = prisma.user.findUnique.bind(prisma.user);
    let armed = true;

    // requireActor가 읽은 직후 권한을 내린다. 트랜잭션 안의 재검사만이 이걸 잡는다.
    const spy = vi.spyOn(prisma.user, "findUnique").mockImplementation((async (args: never) => {
      const row = await original(args);
      if (armed) {
        armed = false;
        await db.user.update({ where: { id: admin.id }, data: { adminLevel: "NONE" } });
      }
      return row;
    }) as typeof prisma.user.findUnique);

    try {
      const response = await routes.adminClose.POST(new Request("http://localhost/api"), appParams());
      expect(response.status).toBe(403);
    } finally {
      spy.mockRestore();
    }

    expect(
      (await db.mealApplication.findUniqueOrThrow({ where: { id: fx.applicationId } })).status,
    ).toBe("OPEN");
  });

  it("PREPARING에서 초안 학년도가 있어도 학년도 없는 공고는 학생 목록에 남는다", async () => {
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    await db.academicYear.create({ data: { year: DRAFT_YEAR, state: "DRAFT", version: 0 } });
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: null, applyEndAt: new Date("2099-01-01T00:00:00.000Z") },
    });

    const studentRow = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    asUser(studentRow);

    const response = await routes.studentApplications.GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: { id: number }[] };
    expect(body.applications.map((a) => a.id)).toContain(fx.applicationId);
  });

  it("초안 학년도 공고는 학생 목록에서 빠진다", async () => {
    await db.academicYear.create({ data: { year: DRAFT_YEAR, state: "DRAFT", version: 0 } });
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: DRAFT_YEAR, applyEndAt: new Date("2099-01-01T00:00:00.000Z") },
    });

    const studentRow = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    asUser(studentRow);

    const response = await routes.studentApplications.GET();
    const body = (await response.json()) as { applications: { id: number }[] };
    expect(body.applications).toHaveLength(0);
  });
});
