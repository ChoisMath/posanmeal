import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  async function record(userId: number) {
    return db.userAcademicRecord.findUniqueOrThrow({ where: { year_userId: { year: YEAR, userId } } });
  }

  async function user(userId: number) {
    return db.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async function yearVersion(): Promise<number> {
    return (await db.academicYear.findUniqueOrThrow({ where: { year: YEAR } })).version;
  }

  // Release B에서 기존 관리 경로가 교체되어도 호환 쓰기의 원자성은 유지해야 한다.
  async function createUser(body: Record<string, unknown>): Promise<number> {
    return withCompatUserWrite(db, async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email as string,
          name: body.name as string,
          role: body.role as "STUDENT" | "TEACHER",
          grade: (body.grade as number | undefined) ?? null,
          classNum: (body.classNum as number | undefined) ?? null,
          number: (body.number as number | undefined) ?? null,
          subject: (body.subject as string | undefined) ?? null,
          homeroom: (body.homeroom as string | undefined) ?? null,
          position: (body.position as string | undefined) ?? null,
          gender: (body.gender as "MALE" | "FEMALE" | undefined) ?? null,
        },
      });
      return { value: created.id, userIds: [created.id] };
    });
  }

  async function editUser(body: Record<string, unknown>): Promise<void> {
    const { id, ...rest } = body;
    await withCompatUserWrite(db, async (tx) => {
      const updated = await tx.user.update({ where: { id: id as number }, data: rest });
      return { value: null, userIds: [updated.id] };
    });
  }

  describe("before the backfill has run", () => {
    let fx: LegacyFixtureIds;

    beforeEach(async () => {
      fx = await seedLegacyFixture(db);
    });

    it("creates the record from the current user row", async () => {
      const before = await user(fx.studentId);

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

    it("mirrors a legacy user create and fills the email key and roster entry", async () => {
      const createdId = await createUser({
        email: "New.Student@example.posan.kr",
        name: "신규학생",
        role: "STUDENT",
        grade: 2,
        classNum: 3,
        number: 7,
        gender: "FEMALE",
      });

      expect((await user(createdId)).emailKey).toBe("new.student@example.posan.kr");
      expect(await record(createdId)).toMatchObject({
        name: "신규학생", grade: 2, classNum: 3, number: 7, needsReview: false,
      });

      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: createdId } },
      });
      expect(entry.emailKey).toBe("new.student@example.posan.kr");
    });

    it("mirrors a legacy user update", async () => {
      await editUser({
        id: fx.teacherId,
        email: "teacher-test@example.posan.kr",
        name: "교사변경",
        subject: "수학",
        homeroom: "2-2",
        position: "부장",
      });

      expect(await record(fx.teacherId)).toMatchObject({
        name: "교사변경", subject: "수학", homeroom: "2-2", position: "부장", memberState: "EMPLOYED",
      });
    });

  });

  describe("after the backfill has run", () => {
    let fx: LegacyFixtureIds;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("rolls back users, mirrored records, entries and versions when a later row fails", async () => {
      const before = {
        users: await db.user.findMany({ orderBy: { id: "asc" } }),
        records: await db.userAcademicRecord.findMany({ orderBy: { userId: "asc" } }),
        entries: await db.rosterEntry.findMany({ orderBy: { id: "asc" } }),
        year: await db.academicYear.findUniqueOrThrow({ where: { year: YEAR } }),
      };

      await expect(withCompatUserWrite(db, async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { name: "원자성변경", classNum: 4 } });
        const created = await tx.user.create({
          data: {
            email: "rollback-new@example.posan.kr", name: "원자성신규", role: "STUDENT",
            grade: 2, classNum: 2, number: 2, gender: "FEMALE",
          },
        });
        await mirrorUsersToActiveYear(tx, [fx.studentId, created.id]);

        expect(await tx.userAcademicRecord.findUniqueOrThrow({
          where: { year_userId: { year: YEAR, userId: fx.studentId } },
        })).toMatchObject({ name: "원자성변경", classNum: 4 });
        expect(await tx.rosterEntry.count({ where: { year: YEAR, userId: created.id } })).toBe(1);

        await tx.user.create({ data: { email: created.email, name: "중복실패", role: "TEACHER" } });
        return { value: null, userIds: [fx.studentId, created.id] };
      })).rejects.toMatchObject({ code: "P2002" });

      expect(await db.user.findMany({ orderBy: { id: "asc" } })).toEqual(before.users);
      expect(await db.userAcademicRecord.findMany({ orderBy: { userId: "asc" } })).toEqual(before.records);
      expect(await db.rosterEntry.findMany({ orderBy: { id: "asc" } })).toEqual(before.entries);
      expect(await db.academicYear.findUniqueOrThrow({ where: { year: YEAR } })).toEqual(before.year);
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
      const before = await user(fx.studentId);
      const yearBefore = await yearVersion();
      const entryBefore = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
      });

      await withCompatUserWrite(db, async () => ({ value: null, userIds: [fx.studentId] }));

      expect((await record(fx.studentId)).version).toBe(existing.version);
      expect((await user(fx.studentId)).profileVersion).toBe(before.profileVersion);
      expect(await yearVersion()).toBe(yearBefore);
      expect(
        await db.rosterEntry.findUniqueOrThrow({ where: { year_userId: { year: YEAR, userId: fx.studentId } } }),
      ).toMatchObject({ version: entryBefore.version, baseUserVersion: entryBefore.baseUserVersion });
    });

    it("bumps profileVersion only for the users whose record actually changed", async () => {
      const studentBefore = await user(fx.studentId);
      const teacherBefore = await user(fx.teacherId);

      await withCompatUserWrite(db, async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { name: "이름변경" } });
        return { value: null, userIds: [fx.studentId, fx.teacherId] };
      });

      expect((await user(fx.studentId)).profileVersion).toBe(studentBefore.profileVersion + 1);
      expect((await user(fx.teacherId)).profileVersion).toBe(teacherBefore.profileVersion);

      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
      });
      expect(entry.baseUserVersion).toBe(studentBefore.profileVersion + 1);
    });

    it("leaves another user's roster entry alone even after their profileVersion moved", async () => {
      // 계정 API(이메일·이용 상태·권한)는 미러를 거치지 않고 profileVersion만 올린다.
      // 그 사용자의 기준선을 남의 편집이 지나가며 새로 찍으면 안 된다.
      await db.$executeRaw`UPDATE "User" SET "profileVersion" = "profileVersion" + 1 WHERE id = ${fx.teacherId}`;
      const untouched = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.teacherId } },
      });

      await editUser({
        id: fx.studentId, email: "student-test@example.posan.kr", name: "다른사람편집",
        grade: 1, classNum: 1, number: 1,
      });

      const after = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.teacherId } },
      });
      expect(after.baseUserVersion).toBe(untouched.baseUserVersion);
      expect(after.version).toBe(untouched.version);
    });

    it("marks every member of a seat collision for review instead of raising 23505", async () => {
      const twinId = await createUser({
        email: "twin@example.posan.kr", name: "좌석충돌", role: "STUDENT",
        grade: 1, classNum: 1, number: 1, gender: "FEMALE",
      });

      expect((await record(twinId)).needsReview).toBe(true);
      expect((await record(fx.studentId)).needsReview).toBe(true);
    });

    it("flags both sides when a user moves onto an occupied seat and clears both when it moves away", async () => {
      const moverId = await createUser({
        email: "mover@example.posan.kr", name: "이동학생", role: "STUDENT",
        grade: 1, classNum: 2, number: 1, gender: "FEMALE",
      });
      expect((await record(moverId)).needsReview).toBe(false);
      expect((await record(fx.studentId)).needsReview).toBe(false);

      await editUser({ id: moverId, email: "mover@example.posan.kr", name: "이동학생", grade: 1, classNum: 1, number: 1 });
      expect((await record(moverId)).needsReview).toBe(true);
      expect((await record(fx.studentId)).needsReview).toBe(true);

      await editUser({ id: moverId, email: "mover@example.posan.kr", name: "이동학생", grade: 1, classNum: 2, number: 1 });
      expect((await record(moverId)).needsReview).toBe(false);
      expect((await record(fx.studentId)).needsReview).toBe(false);
    });

    it("swaps two seats inside one batch without violating the seat index", async () => {
      const otherId = await createUser({
        email: "seat-b@example.posan.kr", name: "좌석B", role: "STUDENT",
        grade: 1, classNum: 1, number: 2, gender: "FEMALE",
      });

      await withCompatUserWrite(db, async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { number: 2 } });
        await tx.user.update({ where: { id: otherId }, data: { number: 1 } });
        return { value: null, userIds: [fx.studentId, otherId] };
      });

      expect(await record(fx.studentId)).toMatchObject({ number: 2, needsReview: false });
      expect(await record(otherId)).toMatchObject({ number: 1, needsReview: false });
    });

    it("flags both sides of an email collision, keeps the existing entry, and recovers when it is resolved", async () => {
      const twinId = await createUser({
        email: "Student-Test@example.posan.kr", name: "이메일충돌", role: "STUDENT",
        grade: 3, classNum: 3, number: 3, gender: "MALE",
      });

      expect((await user(twinId)).emailKey).toBeNull();
      expect((await user(fx.studentId)).emailKey).toBeNull();
      expect((await record(twinId)).needsReview).toBe(true);
      expect((await record(fx.studentId)).needsReview).toBe(true);
      expect(await db.rosterEntry.count({ where: { year: YEAR, userId: twinId } })).toBe(0);
      // 이미 있던 항목은 지우지 않는다.
      expect(await db.rosterEntry.count({ where: { year: YEAR, userId: fx.studentId } })).toBe(1);

      await editUser({
        id: twinId, email: "resolved@example.posan.kr", name: "이메일충돌",
        grade: 3, classNum: 3, number: 3,
      });

      expect((await user(twinId)).emailKey).toBe("resolved@example.posan.kr");
      expect((await user(fx.studentId)).emailKey).toBe("student-test@example.posan.kr");
      expect((await record(twinId)).needsReview).toBe(false);
      expect((await record(fx.studentId)).needsReview).toBe(false);
      expect(await db.rosterEntry.count({ where: { year: YEAR, userId: twinId } })).toBe(1);
    });

    it("does not fail the legacy write when another row holds a stale email key", async () => {
      await db.$executeRaw`
        UPDATE "User" SET "emailKey" = 'stale@example.posan.kr' WHERE id = ${fx.teacherId}
      `;

      const createdId = await createUser({
        email: "stale@example.posan.kr", name: "묵은키", role: "STUDENT",
        grade: 2, classNum: 5, number: 5, gender: "MALE",
      });

      expect((await user(createdId)).emailKey).toBe("stale@example.posan.kr");
      expect((await user(fx.teacherId)).emailKey).toBe("teacher-test@example.posan.kr");
    });

    it("keeps a stored memberState across an unrelated edit and resets it on a role flip", async () => {
      await db.userAcademicRecord.update({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
        data: { memberState: "GRADUATED" },
      });

      await editUser({
        id: fx.studentId, email: "student-test@example.posan.kr", name: "졸업생",
        grade: 1, classNum: 1, number: 1,
      });
      expect((await record(fx.studentId)).memberState).toBe("GRADUATED");

      await withCompatUserWrite(db, async (tx) => {
        await tx.user.update({ where: { id: fx.studentId }, data: { role: "TEACHER", subject: "과학" } });
        return { value: null, userIds: [fx.studentId] };
      });

      expect(await record(fx.studentId)).toMatchObject({
        role: "TEACHER", memberState: "EMPLOYED", subject: "과학",
        grade: null, classNum: null, number: null, gender: null,
      });
    });

    it("refuses a hard delete and writes nothing", async () => {
      const { DELETE } = await import("@/app/api/admin/users/route");
      const res = await DELETE(
        new Request(`http://localhost/api/admin/users?id=${fx.studentId}`, { method: "DELETE" }),
      );

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
        expect((await user(fx.studentId)).classNum).toBe(1);

        await holder.query("COMMIT");
        await pending;
      } finally {
        await holder.end();
      }

      expect(settled).toBe(true);
      expect((await record(fx.studentId)).classNum).toBe(6);
    });
  });

});
