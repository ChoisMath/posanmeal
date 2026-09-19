import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { mirrorUsersToActiveYear, withCompatUserWrite } from "@/lib/academic-year/compat-write";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture } from "./support/academic-fixture";
import { seedLegacyFixture, type LegacyFixtureIds } from "./support/legacy-fixture";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: { current: null as unknown as PrismaClient },
}));

// 라우트가 부르는 prisma를 검증된 테스트 DB 클라이언트로 돌린다. 메서드는 원본에
// 묶어 두어야 $transaction이 자기 클라이언트를 잃지 않는다.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key) {
        const holder = mocks.client.current as unknown as Record<string | symbol, unknown>;
        const value = holder[key];
        return typeof value === "function" ? value.bind(holder) : value;
      },
    },
  ),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));

const MAIN_SESSION = { user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } };
const YEAR = 2026;

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("compat writes mirror legacy user writes into the active year", () => {
  let db: PrismaClient;
  let pgClient: Client;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    mocks.client.current = db;
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(MAIN_SESSION);
    await resetAcademicTestDb(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function record(userId: number) {
    return db.userAcademicRecord.findUniqueOrThrow({ where: { year_userId: { year: YEAR, userId } } });
  }

  async function yearVersion(): Promise<number> {
    return (await db.academicYear.findUniqueOrThrow({ where: { year: YEAR } })).version;
  }

  describe("before the backfill has run", () => {
    let fx: LegacyFixtureIds;

    beforeEach(async () => {
      fx = await seedLegacyFixture(db);
    });

    it("creates the record from the current user row", async () => {
      const before = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });

      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { classNum: 4 } });
        await mirrorUsersToActiveYear(tx, [fx.studentId]);
      });

      const mirrored = await record(fx.studentId);
      expect(mirrored.classNum).toBe(4);
      expect(mirrored.grade).toBe(before.grade);
      expect(mirrored.memberState).toBe("ENROLLED");
      expect(mirrored.needsReview).toBe(false);
    });

    it("mirrors an admin POST and fills the email key and roster entry", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const res = await POST(
        jsonRequest("/api/admin/users", "POST", {
          email: "New.Student@example.posan.kr",
          name: "신규학생",
          role: "STUDENT",
          grade: 2,
          classNum: 3,
          number: 7,
          gender: "FEMALE",
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.user.email).toBe("New.Student@example.posan.kr");

      const created = await db.user.findUniqueOrThrow({ where: { id: body.user.id } });
      expect(created.emailKey).toBe("new.student@example.posan.kr");

      const mirrored = await record(created.id);
      expect(mirrored).toMatchObject({ name: "신규학생", grade: 2, classNum: 3, number: 7, needsReview: false });

      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: created.id } },
      });
      expect(entry.emailKey).toBe("new.student@example.posan.kr");
    });

    it("mirrors an admin PUT", async () => {
      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users", "PUT", {
          id: fx.teacherId,
          email: "teacher-test@example.posan.kr",
          name: "교사변경",
          subject: "수학",
          homeroom: "2-2",
          position: "부장",
        }),
      );

      expect(res.status).toBe(200);
      expect((await res.json()).user.name).toBe("교사변경");

      const mirrored = await record(fx.teacherId);
      expect(mirrored).toMatchObject({
        name: "교사변경",
        subject: "수학",
        homeroom: "2-2",
        position: "부장",
        memberState: "EMPLOYED",
      });
    });
  });

  describe("after the backfill has run", () => {
    let fx: LegacyFixtureIds;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("updates the existing record instead of skipping it and bumps both versions", async () => {
      const existing = await record(fx.studentId);
      const yearBefore = await yearVersion();

      await withCompatUserWrite(db, async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { classNum: 4, number: 9 } });
        return { value: null, userIds: [fx.studentId] };
      });

      const mirrored = await record(fx.studentId);
      expect(mirrored.classNum).toBe(4);
      expect(mirrored.number).toBe(9);
      expect(mirrored.version).toBe(existing.version + 1);
      expect(await yearVersion()).toBe(yearBefore + 1);
    });

    it("does not bump versions when nothing actually changed", async () => {
      const existing = await record(fx.studentId);
      const yearBefore = await yearVersion();

      await withCompatUserWrite(db, async () => ({ value: null, userIds: [fx.studentId] }));

      expect((await record(fx.studentId)).version).toBe(existing.version);
      expect(await yearVersion()).toBe(yearBefore);
    });

    it("marks every member of a seat collision for review instead of raising 23505", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const res = await POST(
        jsonRequest("/api/admin/users", "POST", {
          email: "twin@example.posan.kr",
          name: "좌석충돌",
          role: "STUDENT",
          grade: 1,
          classNum: 1,
          number: 1,
          gender: "FEMALE",
        }),
      );

      expect(res.status).toBe(201);
      const twinId = (await res.json()).user.id as number;

      expect((await record(twinId)).needsReview).toBe(true);
      expect((await record(fx.studentId)).needsReview).toBe(true);
    });

    it("keeps the email key null and skips the roster entry on an email collision", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const res = await POST(
        jsonRequest("/api/admin/users", "POST", {
          email: "Student-Test@example.posan.kr",
          name: "이메일충돌",
          role: "STUDENT",
          grade: 3,
          classNum: 3,
          number: 3,
          gender: "MALE",
        }),
      );

      expect(res.status).toBe(201);
      const twinId = (await res.json()).user.id as number;

      expect((await db.user.findUniqueOrThrow({ where: { id: twinId } })).emailKey).toBeNull();
      expect((await record(twinId)).needsReview).toBe(true);
      expect(await db.rosterEntry.count({ where: { year: YEAR, userId: twinId } })).toBe(0);
    });

    it("clears needsReview once the colliding seat is moved away", async () => {
      const { POST, PUT } = await import("@/app/api/admin/users/route");
      const created = await POST(
        jsonRequest("/api/admin/users", "POST", {
          email: "twin@example.posan.kr",
          name: "좌석충돌",
          role: "STUDENT",
          grade: 1,
          classNum: 1,
          number: 1,
          gender: "FEMALE",
        }),
      );
      const twinId = (await created.json()).user.id as number;

      await PUT(
        jsonRequest("/api/admin/users", "PUT", {
          id: twinId,
          email: "twin@example.posan.kr",
          name: "좌석충돌",
          grade: 1,
          classNum: 1,
          number: 2,
        }),
      );

      expect((await record(twinId)).needsReview).toBe(false);
    });

    it("refuses a hard delete and writes nothing", async () => {
      const { DELETE } = await import("@/app/api/admin/users/route");
      const res = await DELETE();

      expect(res.status).toBe(409);
      expect((await res.json()).reason).toContain("이용 중단");
      expect(await db.user.count({ where: { id: fx.studentId } })).toBe(1);
      expect(await db.userAcademicRecord.count({ where: { userId: fx.studentId } })).toBe(1);
    });

    it("queues behind a backfill that holds the control row", async () => {
      const holder = await openAcademicTestPgClient();
      let settled = false;

      try {
        await holder.query("BEGIN");
        await holder.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');

        const pending = withCompatUserWrite(db, async (tx) => {
          await tx.user.update({ where: { id: fx.studentId }, data: { classNum: 6 } });
          return { value: null, userIds: [fx.studentId] };
        }).then(() => {
          settled = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled).toBe(false);
        expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).classNum).toBe(1);

        await holder.query("COMMIT");
        await pending;
      } finally {
        await holder.end();
      }

      expect(settled).toBe(true);
      expect((await record(fx.studentId)).classNum).toBe(6);
    });
  });

  describe("spreadsheet import", () => {
    beforeEach(async () => {
      await prepareAcademicFixture(db, pgClient);
    });

    function stubSheets(studentCsv: string, teacherCsv: string): void {
      vi.stubGlobal("fetch", async (input: string | URL) => {
        const url = String(input);
        const csv = url.includes("gid=1") ? teacherCsv : studentCsv;
        return new Response(csv, { status: 200 });
      });
    }

    const STUDENT_SHEET = "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0";
    const TEACHER_SHEET = "https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=1";

    it("mirrors every imported row in one batch", async () => {
      stubSheets(
        ["email,grade,classNum,number,name,gender", "import-a@example.posan.kr,2,1,1,가져오기A,남", "import-b@example.posan.kr,2,1,2,가져오기B,여"].join("\n"),
        ["email,subject,homeroom,position,name", "import-t@example.posan.kr,국어,2-1,교사,가져오기교사"].join("\n"),
      );

      const { POST } = await import("@/app/api/admin/import/route");
      const res = await POST(
        jsonRequest("/api/admin/import", "POST", {
          studentSheetUrl: STUDENT_SHEET,
          teacherSheetUrl: TEACHER_SHEET,
        }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.studentCount).toBe(2);
      expect(body.teacherCount).toBe(1);

      const imported = await db.user.findMany({ where: { email: { startsWith: "import-" } } });
      expect(imported).toHaveLength(3);
      for (const user of imported) {
        expect((await record(user.id)).name).toBe(user.name);
      }
    });

    it("rolls back the users and the records when one row fails", async () => {
      stubSheets(
        ["email,grade,classNum,number,name,gender", "import-a@example.posan.kr,2,1,1,가져오기A,남"].join("\n"),
        ["email,subject,homeroom,position,name", "import-bad@example.posan.kr,국어,2-1,교사,나쁜 이름"].join("\n"),
      );

      const { POST } = await import("@/app/api/admin/import/route");
      const res = await POST(
        jsonRequest("/api/admin/import", "POST", {
          studentSheetUrl: STUDENT_SHEET,
          teacherSheetUrl: TEACHER_SHEET,
        }),
      );

      expect(res.status).toBe(500);
      expect(await db.user.count({ where: { email: { startsWith: "import-" } } })).toBe(0);
      expect(await db.userAcademicRecord.count({ where: { name: { startsWith: "가져오기" } } })).toBe(0);
    });
  });
});
