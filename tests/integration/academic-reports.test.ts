import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient, User } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import {
  getReportProfiles,
  getReportProfilesByYear,
  MISSING_PROFILE_WARNING,
} from "@/lib/academic-year/report-profile";
import { getTeacherScope } from "@/lib/academic-year/teacher-scope";
import {
  createDraftYear,
  listRosterView,
  upsertRosterProfile,
} from "@/lib/academic-year/roster-service";
import {
  activateAcademicYear,
  reviewRollover,
  saveRolloverDecision,
} from "@/lib/academic-year/rollover-service";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const profileCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/academic-year/profile-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/academic-year/profile-service")>();
  return {
    ...actual,
    getAcademicProfiles: async (...args: Parameters<typeof actual.getAcademicProfiles>) => {
      profileCalls.count += 1;
      return actual.getAcademicProfiles(...args);
    },
  };
});

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

const SOURCE_YEAR = 2026;
const TARGET_YEAR = 2027;
const TODAY = "2026-09-18";

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(query: string): Request {
  return new Request(`http://localhost/api${query}`);
}

describe("academic year reports", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let admin: User;
  let routes: {
    adminCheckins: typeof import("@/app/api/admin/checkins/route");
    adminToggle: typeof import("@/app/api/admin/checkins/toggle/route");
    adminDashboard: typeof import("@/app/api/admin/dashboard/route");
    adminExport: typeof import("@/app/api/admin/export/route");
    adminRegistrations: typeof import("@/app/api/admin/applications/[id]/registrations/route");
    adminRegistration: typeof import("@/app/api/admin/applications/[id]/registrations/[regId]/route");
    adminAppExport: typeof import("@/app/api/admin/applications/[id]/export/route");
    teacherStudents: typeof import("@/app/api/teacher/students/route");
    teacherApplications: typeof import("@/app/api/teacher/applications/route");
    teacherRegistrations: typeof import("@/app/api/teacher/applications/[id]/registrations/route");
    myApplications: typeof import("@/app/api/applications/my/route");
    usersMe: typeof import("@/app/api/users/me/route");
  };

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    routes = {
      adminCheckins: await import("@/app/api/admin/checkins/route"),
      adminToggle: await import("@/app/api/admin/checkins/toggle/route"),
      adminDashboard: await import("@/app/api/admin/dashboard/route"),
      adminExport: await import("@/app/api/admin/export/route"),
      adminRegistrations: await import("@/app/api/admin/applications/[id]/registrations/route"),
      adminRegistration: await import(
        "@/app/api/admin/applications/[id]/registrations/[regId]/route"
      ),
      adminAppExport: await import("@/app/api/admin/applications/[id]/export/route"),
      teacherStudents: await import("@/app/api/teacher/students/route"),
      teacherApplications: await import("@/app/api/teacher/applications/route"),
      teacherRegistrations: await import("@/app/api/teacher/applications/[id]/registrations/route"),
      myApplications: await import("@/app/api/applications/my/route"),
      usersMe: await import("@/app/api/users/me/route"),
    };
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    profileCalls.count = 0;
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
    admin = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    asAdmin();
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

  function actorOf(user: User): Actor {
    return { kind: "USER", userId: user.id, sessionVersion: user.sessionVersion };
  }

  async function controlVersion(): Promise<number> {
    return (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;
  }

  /** 2026에 기록이 있는 두 번째 학생. 전환 뒤 3학년으로 올라간다. */
  async function seedSecondStudent(): Promise<User> {
    const user = await db.user.create({
      data: {
        email: "student2-test@example.posan.kr",
        emailKey: "student2-test@example.posan.kr",
        name: "학생둘",
        role: "STUDENT",
        grade: 2,
        classNum: 5,
        number: 7,
        gender: "FEMALE",
      },
    });
    await db.userAcademicRecord.create({
      data: {
        year: SOURCE_YEAR,
        userId: user.id,
        role: "STUDENT",
        name: "학생둘",
        grade: 2,
        classNum: 5,
        number: 7,
        gender: "FEMALE",
        memberState: "ENROLLED",
      },
    });
    await db.rosterEntry.create({
      data: {
        year: SOURCE_YEAR,
        userId: user.id,
        emailKey: user.email,
        included: true,
        baseUserVersion: user.profileVersion,
      },
    });
    return user;
  }

  async function editDraftRow(
    year: number,
    userId: number,
    changes: { grade?: number; classNum?: number; number?: number },
    requestId: string,
  ): Promise<void> {
    const rows = await listRosterView(db, year, undefined, { includeExcluded: true });
    const row = rows.find((candidate) => candidate.userId === userId);
    if (!row) throw new Error(`no roster row for ${userId} in ${year}`);
    await upsertRosterProfile(db, {
      actor: fx.main,
      requestId,
      kind: "ROSTER_ROW",
      payloadHash: requestId,
      expectedRowVersion: row.version,
      year,
      userId,
      entryId: row.entryId.length > 0 ? row.entryId : undefined,
      email: row.email,
      profile: { ...row.profile, ...changes },
    });
  }

  /**
   * 실제 전환. fx.student는 졸업, second는 3학년으로 진급한다.
   * 전환 뒤 `User`는 새 학년도 값을 갖는다.
   */
  async function runRollover(second: User): Promise<void> {
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-report",
      kind: "DRAFT",
      payloadHash: "draft-report",
      expectedVersion: await controlVersion(),
      year: TARGET_YEAR,
      sourceYear: SOURCE_YEAR,
    });

    await db.rosterEntry.updateMany({
      where: { year: TARGET_YEAR, userId: fx.studentId },
      data: { included: false },
    });
    await editDraftRow(TARGET_YEAR, second.id, { grade: 3, classNum: 2, number: 4 }, "edit-second");

    await saveRolloverDecision(db, {
      actor: fx.main,
      requestId: "decide-graduate",
      kind: "DECISION",
      payloadHash: "decide-graduate",
      expectedVersion: await controlVersion(),
      year: TARGET_YEAR,
      userId: fx.studentId,
      decision: "GRADUATED",
    });

    const review = await reviewRollover(db, fx.main, TARGET_YEAR, { today: TODAY });
    await activateAcademicYear(db, {
      actor: fx.main,
      requestId: "activate-report",
      kind: "ACTIVATE",
      payloadHash: "activate-report",
      expectedVersion: review.version,
      year: TARGET_YEAR,
      yearVersion: review.yearVersion,
      sourceVersion: review.sourceVersion,
      kiosksPaused: true,
      warningsAcknowledged: true,
      today: TODAY,
    });
  }

  /** 기록을 모두 지우고 준비 단계로 되돌린다. 기존 화면이 그대로 도는지 보기 위해서다. */
  async function backToPreparing(): Promise<void> {
    await db.rosterEntry.deleteMany({});
    await db.userAcademicRecord.deleteMany({});
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
  }

  const appParams = () => ({ params: Promise.resolve({ id: String(fx.applicationId) }) });

  // -------------------------------------------------------------------------
  // Step 1 — 명부 삭제 뒤 과거 표기
  // -------------------------------------------------------------------------

  it("명부 행을 지워도 그 해 기록으로 과거 학급을 보여 준다", async () => {
    await db.user.update({ where: { id: fx.studentId }, data: { grade: 2, classNum: 3 } });
    await db.rosterEntry.deleteMany({ where: { year: SOURCE_YEAR } });

    const profiles = await getReportProfiles(db, [fx.studentId], SOURCE_YEAR, false);
    expect(profiles.get(fx.studentId)?.historical?.grade).toBe(1);
    expect(profiles.get(fx.studentId)?.historical?.classNum).toBe(1);

    await db.userAcademicRecord.deleteMany({ where: { year: SOURCE_YEAR, userId: fx.studentId } });
    const missing = await getReportProfiles(db, [fx.studentId], SOURCE_YEAR, false);
    expect(missing.get(fx.studentId)?.historical).toBeNull();
    expect(missing.get(fx.studentId)?.warning).toBe(MISSING_PROFILE_WARNING);
  });

  it("졸업자의 현재 학급 칸에는 과거 학급을 복사하지 않는다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const profiles = await getReportProfiles(db, [fx.studentId], SOURCE_YEAR, true);
    const report = profiles.get(fx.studentId);
    expect(report?.historical?.classNum).toBe(1);
    expect(report?.current?.classNum ?? null).toBeNull();
    expect(report?.currentState).toBe("졸업");
  });

  it("두 학년도에 걸친 조회도 연도당 한 번만 명부를 읽는다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    profileCalls.count = 0;
    const byYear = await getReportProfilesByYear(
      db,
      new Map([
        [SOURCE_YEAR, [fx.studentId, second.id]],
        [TARGET_YEAR, [second.id]],
      ]),
      false,
    );
    expect(profileCalls.count).toBe(2);
    expect(byYear.get(SOURCE_YEAR)?.get(second.id)?.historical?.grade).toBe(2);
    expect(byYear.get(TARGET_YEAR)?.get(second.id)?.historical?.grade).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 담임 범위
  // -------------------------------------------------------------------------

  it("담임 문자열이 형식에 맞지 않으면 담당 범위가 없다", async () => {
    // 같은 교사 actor가 정상 표기에서는 범위를 갖는다는 것부터 확인한다.
    expect(await getTeacherScope(db, actorOf(admin))).toEqual({
      year: SOURCE_YEAR,
      grade: 1,
      classNum: 1,
    });

    await db.userAcademicRecord.update({
      where: { year_userId: { year: SOURCE_YEAR, userId: fx.teacherId } },
      data: { homeroom: "부담임" },
    });
    expect(await getTeacherScope(db, actorOf(admin))).toBeNull();

    const response = await routes.teacherStudents.GET(getRequest("?year=2026&month=9"));
    expect(response.status).toBe(403);
  });

  it("담임은 요청이 다른 연도·반을 지정해도 운영 연도 담당 학급만 본다", async () => {
    const second = await seedSecondStudent();

    const response = await routes.teacherStudents.GET(
      getRequest("?year=2026&month=9&grade=2&classNum=5&academicYear=2025"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.grade).toBe(1);
    expect(body.classNum).toBe(1);
    expect(body.students.map((s: { id: number }) => s.id)).toEqual([fx.studentId]);
    expect(body.students.map((s: { id: number }) => s.id)).not.toContain(second.id);
  });

  it("재직 교사는 전환 뒤에도 본인 과거 신청 내역을 볼 수 있다", async () => {
    const second = await seedSecondStudent();
    await db.mealRegistration.update({
      where: { id: fx.registrationId },
      data: { userId: fx.teacherId },
    });
    await runRollover(second);

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    asUser(refreshed);
    const response = await routes.myApplications.GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0].academicYear).toBe(SOURCE_YEAR);
  });

  it("조기 전환 뒤에도 확정된 오늘 식사는 그대로 남는다", async () => {
    const second = await seedSecondStudent();
    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    asUser(student);
    const before = await (await routes.usersMe.GET()).json();

    await runRollover(second);

    const graduated = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "ACTIVE" } });
    asUser({ ...graduated, accessState: "ACTIVE" });
    const after = await (await routes.usersMe.GET()).json();
    expect(after.user.todayMeals).toEqual(before.user.todayMeals);
  });

  // -------------------------------------------------------------------------
  // 관리자 월별 보기
  // -------------------------------------------------------------------------

  it("전환 뒤에도 2026년 9월 보기는 당시 학년·학급으로 분류한다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    expect((await db.user.findUniqueOrThrow({ where: { id: second.id } })).grade).toBe(3);

    const grade2 = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=2"))
    ).json();
    expect(grade2.academicYear).toBe(SOURCE_YEAR);
    const secondRow = grade2.users.find((u: { id: number }) => u.id === second.id);
    expect(secondRow).toMatchObject({ grade: 2, classNum: 5, number: 7 });

    const grade3 = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=3"))
    ).json();
    expect(grade3.users.map((u: { id: number }) => u.id)).not.toContain(second.id);

    // 졸업하고 이용이 중지된 사람도 그 달 자료에는 남는다.
    const grade1 = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=1"))
    ).json();
    const graduatedRow = grade1.users.find((u: { id: number }) => u.id === fx.studentId);
    expect(graduatedRow).toMatchObject({ grade: 1, classNum: 1 });
    expect(graduatedRow.checkIns.length).toBeGreaterThan(0);
  });

  it("월별 엑셀은 과거 학급으로, 현재 학급은 선택했을 때만 적는다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const plain = await routes.adminExport.GET(getRequest("?year=2026&month=9"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await plain.arrayBuffer());
    const sheet2 = book.getWorksheet("2학년")!;
    const labels: unknown[] = [];
    sheet2.eachRow((row) => labels.push(row.getCell(1).value));
    expect(labels).toContain("5-7 학생둘");
    expect(labels.some((l) => typeof l === "string" && l.includes("현재"))).toBe(false);

    const withCurrent = await routes.adminExport.GET(
      getRequest("?year=2026&month=9&includeCurrent=1"),
    );
    const book2 = new ExcelJS.Workbook();
    await book2.xlsx.load(await withCurrent.arrayBuffer());
    const sheet1 = book2.getWorksheet("1학년")!;
    const headerRow = sheet1.getRow(3);
    const headers: unknown[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell) => headers.push(cell.value));
    expect(headers).toContain("현재 학급");
  });

  it("일별 엑셀과 당일 현황도 그 날짜 학년도의 학급을 쓴다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const dashboard = await (
      await routes.adminDashboard.GET(getRequest("?date=2026-09-18"))
    ).json();
    expect(dashboard.academicYear).toBe(SOURCE_YEAR);
    const record = dashboard.records.find(
      (r: { userName: string }) => r.userName === "학생테스트",
    );
    expect(record).toMatchObject({ grade: 1, classNum: 1, number: 1 });

    const daily = await routes.adminExport.GET(getRequest("?date=2026-09-18"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await daily.arrayBuffer());
    const sheet = book.getWorksheet("2026-09-18")!;
    const dataRow = sheet.getRow(5);
    expect(dataRow.getCell(2).value).toBe(1);
    expect(dataRow.getCell(3).value).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 신청 기준 화면
  // -------------------------------------------------------------------------

  it("신청 명단과 일괄신청 양식은 공고 학년도의 학급을 쓴다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const list = await (await routes.adminRegistrations.GET(getRequest(""), appParams())).json();
    expect(list.academicYear).toBe(SOURCE_YEAR);
    expect(list.registrations[0].user).toMatchObject({ grade: 1, classNum: 1, number: 1 });

    const template = await routes.adminAppExport.GET(
      getRequest("?template=true"),
      appParams(),
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await template.arrayBuffer());
    const sheet = book.getWorksheet("일괄신청양식")!;
    const rows: Array<{ email: unknown; grade: unknown; classNum: unknown }> = [];
    sheet.eachRow((row, index) => {
      if (index < 3) return;
      rows.push({
        email: row.getCell(1).value,
        grade: row.getCell(2).value,
        classNum: row.getCell(3).value,
      });
    });
    const secondRow = rows.find((r) => r.email === "student2-test@example.posan.kr");
    expect(secondRow).toMatchObject({ grade: 2, classNum: 5 });
  });

  it("그 해 기록이 없어도 자료가 있으면 월별 보기·엑셀의 확인 필요 묶음에 남는다", async () => {
    await db.userAcademicRecord.deleteMany({
      where: { year: SOURCE_YEAR, userId: fx.studentId },
    });

    const unknown = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=unknown"))
    ).json();
    const row = unknown.users.find((u: { id: number }) => u.id === fx.studentId);
    expect(row).toMatchObject({
      name: "학생테스트",
      grade: null,
      classNum: null,
      number: null,
      profileWarning: "학년도 정보 확인 필요",
    });
    expect(row.checkIns.length).toBeGreaterThan(0);

    const grade1 = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=1"))
    ).json();
    expect(grade1.users.map((u: { id: number }) => u.id)).not.toContain(fx.studentId);

    // 네 분류 + 확인 필요 묶음의 체크인 수가 그 달 전체와 같아야 한다.
    const categories = ["teacher", "1", "2", "3", "unknown"];
    let counted = 0;
    for (const category of categories) {
      const body = await (
        await routes.adminCheckins.GET(getRequest(`?year=2026&month=9&category=${category}`))
      ).json();
      for (const user of body.users) counted += user.checkIns.length;
    }
    expect(counted).toBe(
      await db.checkIn.count({
        where: {
          date: {
            gte: new Date("2026-09-01T00:00:00.000Z"),
            lte: new Date("2026-09-30T00:00:00.000Z"),
          },
        },
      }),
    );

    const monthly = await routes.adminExport.GET(getRequest("?year=2026&month=9"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await monthly.arrayBuffer());
    const sheet = book.getWorksheet("확인 필요")!;
    expect(sheet).toBeTruthy();
    const names: unknown[] = [];
    sheet.eachRow((r) => names.push(r.getCell(1).value));
    expect(names).toContain("학생테스트");

    const daily = await routes.adminExport.GET(getRequest("?date=2026-09-18"));
    const dailyBook = new ExcelJS.Workbook();
    await dailyBook.xlsx.load(await daily.arrayBuffer());
    const dailySheet = dailyBook.getWorksheet("2026-09-18")!;
    const summary = String(dailySheet.getCell("A2").value);
    expect(summary).toContain("확인 필요 1");
    expect(summary).toContain("교사 근무 1");
    const categoriesInSheet: unknown[] = [];
    dailySheet.eachRow((r, i) => { if (i >= 5) categoriesInSheet.push(r.getCell(1).value); });
    expect(categoriesInSheet).toContain("확인 필요");
  });

  it("기록이 없어도 그 줄을 정정할 수 있다", async () => {
    await db.userAcademicRecord.deleteMany({
      where: { year: SOURCE_YEAR, userId: fx.studentId },
    });

    // 기존 체크인의 유형으로 학생 갈래를 정한다.
    const removed = await routes.adminToggle.POST(
      jsonRequest("POST", {
        userId: fx.studentId,
        date: "2026-09-18",
        mealKind: "DINNER",
        action: "toggle",
      }),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ state: "empty" });

    // 기록도 체크인도 없으면 계정 역할로 정한다.
    const added = await routes.adminToggle.POST(
      jsonRequest("POST", {
        userId: fx.studentId,
        date: "2026-09-18",
        mealKind: "DINNER",
        action: "toggle",
      }),
    );
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ state: "STUDENT" });
  });

  it("담임은 지난 학년도 공고를 목록에서도 상세에서도 볼 수 없다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);
    // 전환 뒤 담임 기록을 2027로 옮겨 재직 상태를 유지한다.
    await db.userAcademicRecord.update({
      where: { year_userId: { year: TARGET_YEAR, userId: fx.teacherId } },
      data: { homeroom: "3-2" },
    });
    const refreshed = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    asUser(refreshed);

    const list = await (await routes.teacherApplications.GET()).json();
    expect(list.applications.map((a: { id: number }) => a.id)).not.toContain(fx.applicationId);

    const detail = await routes.teacherRegistrations.GET(getRequest(""), appParams());
    expect(detail.status).toBe(403);
    const body = await detail.json();
    expect(JSON.stringify(body)).not.toContain("서명");

    // 없는 공고도 같은 답이라 존재 여부가 드러나지 않는다.
    const missing = await routes.teacherRegistrations.GET(getRequest(""), {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual(body);

    // 관리자는 계속 볼 수 있다.
    asAdmin();
    const adminView = await routes.adminRegistrations.GET(getRequest(""), appParams());
    expect(adminView.status).toBe(200);
  });

  it("담임 신청 명단은 담당 학급 학생만 담는다", async () => {
    const second = await seedSecondStudent();
    await db.mealRegistration.create({
      data: {
        applicationId: fx.applicationId,
        userId: second.id,
        signature: "서명",
        status: "APPROVED",
        meals: { create: [{ mealKind: "DINNER", applied: true, exempt: false }] },
      },
    });

    const body = await (
      await routes.teacherRegistrations.GET(getRequest(""), appParams())
    ).json();
    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0].user.name).toBe("학생테스트");
  });

  // -------------------------------------------------------------------------
  // 체크인 정정
  // -------------------------------------------------------------------------

  it("졸업자의 지난 날짜도 정정할 수 있고 읽기 관리자는 거절된다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const response = await routes.adminToggle.POST(
      jsonRequest("POST", {
        userId: fx.studentId,
        date: "2026-09-19",
        mealKind: "DINNER",
        action: "toggle",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, state: "STUDENT" });
    expect(
      await db.checkIn.count({ where: { userId: fx.studentId, source: "ADMIN_MANUAL" } }),
    ).toBe(1);

    await db.user.update({ where: { id: admin.id }, data: { adminLevel: "SUBADMIN" } });
    session.current = { ...session.current!, adminLevel: "SUBADMIN" };
    const refused = await routes.adminToggle.POST(
      jsonRequest("POST", {
        userId: fx.studentId,
        date: "2026-09-18",
        mealKind: "DINNER",
        action: "toggle",
      }),
    );
    expect(refused.status).toBe(403);
  });

  it("명부 잠금이 잡혀 있어도 체크인 정정은 끝난다", async () => {
    await pgClient.query("BEGIN");
    await pgClient.query('SELECT version FROM "RosterControl" WHERE id = 1 FOR UPDATE');
    try {
      const response = await routes.adminToggle.POST(
        jsonRequest("POST", {
          userId: fx.studentId,
          date: "2026-09-19",
          mealKind: "DINNER",
          action: "toggle",
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      await pgClient.query("ROLLBACK");
    }
  });

  // -------------------------------------------------------------------------
  // 준비 단계
  // -------------------------------------------------------------------------

  it("준비 단계에서는 기록이 없어도 기존과 같이 동작한다", async () => {
    await backToPreparing();

    const profiles = await getReportProfiles(db, [fx.studentId], SOURCE_YEAR, false);
    expect(profiles.get(fx.studentId)?.historical?.grade).toBe(1);
    expect(profiles.get(fx.studentId)?.warning).toBeNull();

    const checkins = await (
      await routes.adminCheckins.GET(getRequest("?year=2026&month=9&category=1"))
    ).json();
    expect(checkins.users.map((u: { id: number }) => u.id)).toContain(fx.studentId);
    expect(checkins.users.every((u: { profileWarning?: string }) => !u.profileWarning)).toBe(true);

    const students = await (
      await routes.teacherStudents.GET(getRequest("?year=2026&month=9"))
    ).json();
    expect(students.students.map((s: { id: number }) => s.id)).toEqual([fx.studentId]);

    const dashboard = await (
      await routes.adminDashboard.GET(getRequest("?date=2026-09-18"))
    ).json();
    expect(
      dashboard.records.every((r: { profileWarning?: string }) => !r.profileWarning),
    ).toBe(true);

    const apps = await routes.teacherApplications.GET();
    expect(apps.status).toBe(200);
  });

  it("공고 단건 조회도 공고 학년도의 학급을 쓴다", async () => {
    const second = await seedSecondStudent();
    await runRollover(second);

    const body = await (
      await routes.adminRegistration.GET(getRequest(""), {
        params: Promise.resolve({
          id: String(fx.applicationId),
          regId: String(fx.registrationId),
        }),
      })
    ).json();
    expect(body.registration.user).toMatchObject({ grade: 1, classNum: 1, number: 1 });
    expect(body.academicYear).toBe(SOURCE_YEAR);
  });
});
