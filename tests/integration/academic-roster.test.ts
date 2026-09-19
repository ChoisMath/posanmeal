import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Profile, RosterRow } from "@/lib/academic-year/contracts";
import { isDomainError } from "@/lib/academic-year/errors";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import {
  createDraftYear,
  listRoster,
  upsertRosterProfile,
  writeRosterProfiles,
} from "@/lib/academic-year/roster-service";
import {
  openAcademicTestDb,
  openAcademicTestPgClient,
  openCountingAcademicTestDb,
  resetAcademicTestDb,
  type CountingAcademicTestDb,
} from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";
import { seedLegacyFixture } from "./support/legacy-fixture";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: { current: null as unknown as PrismaClient },
}));

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
const NEXT_YEAR = 2027;

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function studentProfile(over: Partial<Profile> = {}): Profile {
  return {
    role: "STUDENT",
    name: "학생하나",
    grade: 1,
    classNum: 1,
    number: 1,
    gender: "MALE",
    subject: null,
    homeroom: null,
    position: null,
    ...over,
  };
}

function teacherProfile(over: Partial<Profile> = {}): Profile {
  return {
    role: "TEACHER",
    name: "교사하나",
    grade: null,
    classNum: null,
    number: null,
    gender: null,
    subject: null,
    homeroom: null,
    position: null,
    ...over,
  };
}

async function expectDomainCode(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(isDomainError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`${code} 로 거절되어야 하는 호출이 성공했습니다.`);
}

describe("academic year roster services", () => {
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

  async function record(userId: number, year = YEAR) {
    return db.userAcademicRecord.findUniqueOrThrow({ where: { year_userId: { year, userId } } });
  }

  async function rowVersion(userId: number, year = YEAR): Promise<number> {
    return (await record(userId, year)).version;
  }

  async function addStudent(
    fx: AcademicFixture,
    email: string,
    profile: Profile,
  ): Promise<number> {
    await upsertRosterProfile(db, {
      actor: fx.main,
      requestId: `add-${email}`,
      expectedRowVersion: 0,
      kind: "ROSTER_ROW",
      payloadHash: `add-${email}`,
      year: YEAR,
      expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
      email,
      profile,
    });
    const created = await db.user.findFirstOrThrow({ where: { email } });
    return created.id;
  }

  describe("draft years stay isolated from the live roster", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("copies the source roster without touching User or creating records", async () => {
      const original = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });

      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-2027",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-2027-hash",
        year: NEXT_YEAR,
        sourceYear: YEAR,
      });

      const [copied] = await listRoster(db, NEXT_YEAR, "STUDENT");
      expect(copied!.userId).toBe(fx.studentId);
      expect(copied!.profile.grade).toBe(original.grade);
      expect(copied!.baseUserVersion).toBe(original.profileVersion);
      expect(await db.user.findUnique({ where: { id: fx.studentId } })).toEqual(original);
      expect(await db.userAcademicRecord.count({ where: { year: NEXT_YEAR } })).toBe(0);
    });

    it("does not auto promote the grade", async () => {
      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-no-promote",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-no-promote",
        year: NEXT_YEAR,
      });

      const [copied] = await listRoster(db, NEXT_YEAR, "STUDENT");
      expect(copied!.profile.grade).toBe(1);
    });

    it("refuses a year that already exists or is not the next one", async () => {
      const control = async () =>
        (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;

      await expectDomainCode(
        createDraftYear(db, {
          actor: fx.main,
          requestId: "draft-same",
          expectedVersion: await control(),
          kind: "DRAFT",
          payloadHash: "draft-same",
          year: YEAR,
        }),
        "YEAR_MISMATCH",
      );

      await expectDomainCode(
        createDraftYear(db, {
          actor: fx.main,
          requestId: "draft-far",
          expectedVersion: await control(),
          kind: "DRAFT",
          payloadHash: "draft-far",
          year: 2030,
        }),
        "YEAR_MISMATCH",
      );
    });

    it("adds a new draft person without creating a User", async () => {
      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-add",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-add",
        year: NEXT_YEAR,
      });

      const usersBefore = await db.user.count();
      const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "draft-new-row",
        expectedRowVersion: 0,
        expectedVersion: control.version,
        kind: "ROSTER_ROW",
        payloadHash: "draft-new-row",
        year: NEXT_YEAR,
        email: "Draft.New@example.posan.kr",
        profile: studentProfile({ name: "초안신입", grade: 2, classNum: 5, number: 9 }),
      });

      expect(await db.user.count()).toBe(usersBefore);
      expect(await db.user.count({ where: { email: "Draft.New@example.posan.kr" } })).toBe(0);

      const entry = await db.rosterEntry.findFirstOrThrow({
        where: { year: NEXT_YEAR, emailKey: "draft.new@example.posan.kr" },
      });
      expect(entry.userId).toBeNull();
      expect(entry.draftEmail).toBe("Draft.New@example.posan.kr");
      expect((entry.draftProfile as unknown as Profile).name).toBe("초안신입");
    });

    it("edits a copied draft row without moving the live record", async () => {
      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-edit",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-edit",
        year: NEXT_YEAR,
      });

      const [row] = await listRoster(db, NEXT_YEAR, "STUDENT");
      const entryBefore = await db.rosterEntry.findUniqueOrThrow({ where: { id: row!.entryId } });
      const liveBefore = await record(fx.studentId);

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "draft-edit-row",
        expectedRowVersion: entryBefore.version,
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "draft-edit-row",
        year: NEXT_YEAR,
        entryId: row!.entryId,
        userId: fx.studentId,
        email: row!.email,
        profile: { ...row!.profile, classNum: 8 },
      });

      const entryAfter = await db.rosterEntry.findUniqueOrThrow({ where: { id: row!.entryId } });
      expect((entryAfter.draftProfile as unknown as Profile).classNum).toBe(8);
      expect(entryAfter.version).toBe(entryBefore.version + 1);
      expect(await record(fx.studentId)).toEqual(liveBefore);
    });
  });

  describe("row edits on the active year", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("lets two different students' cells be edited in parallel", async () => {
      const otherId = await addStudent(
        fx,
        "seat-b@example.posan.kr",
        studentProfile({ name: "학생둘", number: 2 }),
      );

      const edit = (userId: number, name: string, number: number, version: number) =>
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: `par-${userId}`,
          expectedRowVersion: version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: `par-${userId}`,
          year: YEAR,
          userId,
          email: userId === otherId ? "seat-b@example.posan.kr" : "student-test@example.posan.kr",
          profile: studentProfile({ name, number }),
        });

      const [a, b] = [await rowVersion(fx.studentId), await rowVersion(otherId)];
      await Promise.all([edit(fx.studentId, "병렬가", 1, a), edit(otherId, "병렬나", 2, b)]);

      expect((await record(fx.studentId)).name).toBe("병렬가");
      expect((await record(otherId)).name).toBe("병렬나");
    });

    it("lets exactly one of two edits on the same row version win", async () => {
      const version = await rowVersion(fx.studentId);
      const edit = (tag: string, name: string) =>
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: `race-${tag}`,
          expectedRowVersion: version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: `race-${tag}`,
          year: YEAR,
          userId: fx.studentId,
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name }),
        });

      const settled = await Promise.allSettled([edit("a", "경합가"), edit("b", "경합나")]);
      const ok = settled.filter((r) => r.status === "fulfilled");
      const failed = settled.filter((r) => r.status === "rejected");

      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason.code).toBe("VERSION_CONFLICT");
    });

    it("replays the same request id instead of writing twice", async () => {
      const version = await rowVersion(fx.studentId);
      const input = {
        actor: fx.main,
        requestId: "replay-1",
        expectedRowVersion: version,
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "replay-1",
        year: YEAR,
        userId: fx.studentId,
        email: "student-test@example.posan.kr",
        profile: studentProfile({ name: "재전송" }),
      };

      const first = await upsertRosterProfile(db, input);
      const second = await upsertRosterProfile(db, input);

      expect(second).toEqual(first);
      expect(await rowVersion(fx.studentId)).toBe(version + 1);
    });

    it("bumps the row version only when a value actually changed", async () => {
      const before = await record(fx.studentId);
      const userBefore = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "noop-1",
        expectedRowVersion: before.version,
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "noop-1",
        year: YEAR,
        userId: fx.studentId,
        email: "student-test@example.posan.kr",
        profile: studentProfile({ name: before.name }),
      });

      expect((await record(fx.studentId)).version).toBe(before.version);
      expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).profileVersion).toBe(
        userBefore.profileVersion,
      );
    });

    it("keeps the record, the User row and the entry consistent", async () => {
      const version = await rowVersion(fx.studentId);

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "sync-1",
        expectedRowVersion: version,
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "sync-1",
        year: YEAR,
        userId: fx.studentId,
        email: "Moved.Student@example.posan.kr",
        profile: studentProfile({ name: "이사", grade: 2, classNum: 4, number: 11 }),
      });

      expect(await record(fx.studentId)).toMatchObject({ grade: 2, classNum: 4, number: 11, name: "이사" });
      const user = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(user).toMatchObject({ grade: 2, classNum: 4, number: 11, email: "Moved.Student@example.posan.kr" });
      expect(user.emailKey).toBe("moved.student@example.posan.kr");
      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
      });
      expect(entry.emailKey).toBe("moved.student@example.posan.kr");
      expect(entry.baseUserVersion).toBe(user.profileVersion);
    });

    it("preserves a teacher's stored gender when the input carries none", async () => {
      await db.userAcademicRecord.update({
        where: { year_userId: { year: YEAR, userId: fx.teacherId } },
        data: { gender: "FEMALE" },
      });
      await db.user.update({ where: { id: fx.teacherId }, data: { gender: "FEMALE" } });

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "teacher-gender",
        expectedRowVersion: await rowVersion(fx.teacherId),
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "teacher-gender",
        year: YEAR,
        userId: fx.teacherId,
        email: "teacher-test@example.posan.kr",
        profile: teacherProfile({ name: "교사테스트", homeroom: "1-1", subject: "국어" }),
      });

      expect((await record(fx.teacherId)).gender).toBe("FEMALE");
      expect((await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } })).gender).toBe("FEMALE");
    });

    it("refuses a seat that another enrolled student holds and writes nothing", async () => {
      const otherId = await addStudent(
        fx,
        "seat-c@example.posan.kr",
        studentProfile({ name: "좌석주인", number: 5 }),
      );
      const before = await record(fx.studentId);

      await expectDomainCode(
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "seat-clash",
          expectedRowVersion: before.version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: "seat-clash",
          year: YEAR,
          userId: fx.studentId,
          email: "student-test@example.posan.kr",
          profile: studentProfile({ number: 5 }),
        }),
        "IDENTITY_CONFLICT",
      );

      expect(await record(fx.studentId)).toEqual(before);
      expect((await record(otherId)).number).toBe(5);
      expect(await db.rosterMutation.count({ where: { requestId: "seat-clash" } })).toBe(0);
    });

    it("names the suspended holder when the seat is held by an inactive account", async () => {
      const otherId = await addStudent(
        fx,
        "seat-d@example.posan.kr",
        studentProfile({ name: "중지학생", number: 6 }),
      );
      await db.user.update({ where: { id: otherId }, data: { accessState: "INACTIVE" } });

      try {
        await upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "seat-inactive",
          expectedRowVersion: await rowVersion(fx.studentId),
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: "seat-inactive",
          year: YEAR,
          userId: fx.studentId,
          email: "student-test@example.posan.kr",
          profile: studentProfile({ number: 6 }),
        });
        throw new Error("좌석 충돌이 거절되지 않았습니다.");
      } catch (error) {
        expect(isDomainError(error)).toBe(true);
        expect((error as Error).message).toContain("이용이 중지된");
      }
    });

    it("refuses an email another user already holds", async () => {
      await addStudent(fx, "taken@example.posan.kr", studentProfile({ name: "선점", number: 3 }));

      await expectDomainCode(
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "email-clash",
          expectedRowVersion: await rowVersion(fx.studentId),
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: "email-clash",
          year: YEAR,
          userId: fx.studentId,
          email: "Taken@example.posan.kr",
          profile: studentProfile(),
        }),
        "IDENTITY_CONFLICT",
      );
    });
  });

  describe("bulk writes", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    async function rowsFor(year: number): Promise<RosterRow[]> {
      return listRoster(db, year, "STUDENT");
    }

    it("swaps two students' seats inside one call", async () => {
      const otherId = await addStudent(
        fx,
        "swap-b@example.posan.kr",
        studentProfile({ name: "맞바꿈나", number: 2 }),
      );

      const rows = await rowsFor(YEAR);
      const swapped = rows.map((row) => ({
        ...row,
        profile: { ...row.profile, number: row.userId === fx.studentId ? 2 : 1 },
      }));

      await db.$transaction(async (tx) => {
        await writeRosterProfiles(tx, YEAR, swapped);
      });

      expect(await record(fx.studentId)).toMatchObject({ number: 2, needsReview: false });
      expect(await record(otherId)).toMatchObject({ number: 1, needsReview: false });
    });

    it("writes a thousand rows with a query count that does not grow with the rows", async () => {
      let counting: CountingAcademicTestDb | null = null;
      try {
        counting = await openCountingAcademicTestDb();
        const seeded = await seedBulkStudents(db, 1000);

        const small = seeded.slice(0, 10);
        counting.reset();
        await counting.db.$transaction(async (tx) => {
          await writeRosterProfiles(tx, YEAR, renameRows(small, "소량"));
        });
        const smallCount = counting.count();

        counting.reset();
        const startedAt = Date.now();
        await counting.db.$transaction(
          async (tx) => {
            await writeRosterProfiles(tx, YEAR, renameRows(seeded, "대량"));
          },
          { maxWait: 10_000, timeout: 60_000 },
        );
        const bigCount = counting.count();
        const elapsedMs = Date.now() - startedAt;

        console.info(`[roster] 10행 ${smallCount}문 / 1000행 ${bigCount}문, ${elapsedMs}ms`);
        expect(bigCount).toBe(smallCount);
        expect(elapsedMs).toBeLessThan(20_000);
        expect(await db.userAcademicRecord.count({ where: { name: { startsWith: "대량" } } })).toBe(1000);
      } finally {
        await counting?.close();
      }
    }, 120_000);
  });

  describe("past years", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
      await db.academicYear.create({
        data: { year: 2025, state: "ARCHIVED", version: 0 },
      });
      await db.userAcademicRecord.create({
        data: {
          year: 2025,
          userId: fx.studentId,
          role: "STUDENT",
          name: "옛이름",
          grade: 1,
          classNum: 9,
          number: 9,
          gender: "MALE",
          memberState: "ENROLLED",
        },
      });
    });

    it("corrects an archived profile without touching the current User or the active record", async () => {
      const userBefore = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      const activeBefore = await record(fx.studentId);
      const archived = await record(fx.studentId, 2025);

      await upsertRosterProfile(db, {
        actor: fx.main,
        requestId: "archive-fix",
        expectedRowVersion: archived.version,
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: "archive-fix",
        year: 2025,
        userId: fx.studentId,
        email: "student-test@example.posan.kr",
        profile: studentProfile({ name: "정정이름", classNum: 9, number: 9 }),
      });

      expect((await record(fx.studentId, 2025)).name).toBe("정정이름");
      expect(await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).toEqual(userBefore);
      expect(await record(fx.studentId)).toEqual(activeBefore);
    });

    it("refuses a brand new person on an archived year", async () => {
      await expectDomainCode(
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "archive-new",
          expectedRowVersion: 0,
          expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
          kind: "ROSTER_ROW",
          payloadHash: "archive-new",
          year: 2025,
          email: "brand.new@example.posan.kr",
          profile: studentProfile({ name: "신규", classNum: 9, number: 20 }),
        }),
        "YEAR_MISMATCH",
      );
    });
  });

  describe("getAcademicProfiles", () => {
    it("never falls back to the current User values", async () => {
      const fx = await prepareAcademicFixture(db, pgClient);
      await db.userAcademicRecord.deleteMany({ where: { year: YEAR, userId: fx.teacherId } });

      const profiles = await getAcademicProfiles(db, [fx.studentId, fx.teacherId], YEAR);

      expect(profiles.get(fx.studentId)).toMatchObject({ name: "학생테스트", year: YEAR });
      expect(profiles.has(fx.teacherId)).toBe(false);
    });
  });

  describe("admin APIs", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    async function subadminSession() {
      const teacher = await db.user.update({
        where: { id: fx.teacherId },
        data: { adminLevel: "SUBADMIN" },
      });
      return {
        user: {
          dbUserId: teacher.id,
          role: "TEACHER",
          adminLevel: "SUBADMIN",
          sessionVersion: teacher.sessionVersion,
        },
      };
    }

    it("lists the active year roster with a row version through the legacy users API", async () => {
      const { GET } = await import("@/app/api/admin/users/route");
      const res = await GET(new Request("http://localhost/api/admin/users?role=STUDENT"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(1);
      expect(body.users[0]).toMatchObject({
        id: fx.studentId,
        name: "학생테스트",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "MALE",
      });
      expect(typeof body.users[0].version).toBe("number");
    });

    it("creates a user through the legacy POST and writes the year record in the same transaction", async () => {
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
      const createdId = (await res.json()).user.id as number;
      expect((await db.user.findUniqueOrThrow({ where: { id: createdId } })).emailKey).toBe(
        "new.student@example.posan.kr",
      );
      expect(await record(createdId)).toMatchObject({ name: "신규학생", grade: 2, classNum: 3, number: 7 });
      expect(
        await db.rosterEntry.count({ where: { year: YEAR, userId: createdId } }),
      ).toBe(1);
      expect(await db.userAccessEvent.count({ where: { userId: createdId } })).toBe(1);
    });

    it("refuses a duplicate seat through the legacy POST", async () => {
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

      expect(res.status).toBe(409);
      expect(await db.user.count({ where: { email: "twin@example.posan.kr" } })).toBe(0);
      expect((await record(fx.studentId)).needsReview).toBe(false);
    });

    it("applies a partial legacy PUT on top of the stored profile", async () => {
      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users", "PUT", { id: fx.studentId, classNum: 4 }),
      );

      expect(res.status).toBe(200);
      expect(await record(fx.studentId)).toMatchObject({ classNum: 4, name: "학생테스트", number: 1 });
      expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).classNum).toBe(4);
    });

    it("keeps refusing a hard delete without removing the User", async () => {
      const { DELETE } = await import("@/app/api/admin/users/route");
      const res = await DELETE(
        new Request(`http://localhost/api/admin/users?id=${fx.studentId}`, { method: "DELETE" }),
      );

      expect(res.status).toBe(409);
      expect(await db.user.count({ where: { id: fx.studentId } })).toBe(1);
      expect(await db.userAcademicRecord.count({ where: { userId: fx.studentId } })).toBe(1);
    });

    it("lets a read-only admin list the roster but not write it", async () => {
      mocks.auth.mockResolvedValue(await subadminSession());

      const roster = await import("@/app/api/admin/academic-years/[year]/roster/route");
      const listed = await roster.GET(
        new Request(`http://localhost/api/admin/academic-years/${YEAR}/roster`),
        { params: Promise.resolve({ year: String(YEAR) }) },
      );
      expect(listed.status).toBe(200);
      expect((await listed.json()).rows.length).toBeGreaterThan(0);

      const records = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      const written = await records.PUT(
        jsonRequest(`/api/admin/academic-years/${YEAR}/records/${fx.studentId}`, "PUT", {
          requestId: randomUUID(),
          expectedRowVersion: await rowVersion(fx.studentId),
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name: "권한없음" }),
        }),
        { params: Promise.resolve({ year: String(YEAR), userId: String(fx.studentId) }) },
      );
      expect(written.status).toBe(403);
      expect((await record(fx.studentId)).name).toBe("학생테스트");
    });

    it("creates a draft year through the API", async () => {
      const { POST } = await import("@/app/api/admin/academic-years/route");
      const res = await POST(
        jsonRequest("/api/admin/academic-years", "POST", {
          requestId: randomUUID(),
          expectedVersion: fx.version,
          year: NEXT_YEAR,
        }),
      );

      expect(res.status).toBe(201);
      expect((await db.academicYear.findUniqueOrThrow({ where: { year: NEXT_YEAR } })).state).toBe("DRAFT");
    });
  });

  describe("readiness gate", () => {
    it("blocks the new academic APIs while preparing but not the legacy users API", async () => {
      await seedLegacyFixture(db);
      expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");

      const years = await import("@/app/api/admin/academic-years/route");
      const blocked = await years.POST(
        jsonRequest("/api/admin/academic-years", "POST", {
          requestId: randomUUID(),
          expectedVersion: 0,
          year: NEXT_YEAR,
        }),
      );
      expect(blocked.status).toBe(503);

      const roster = await import("@/app/api/admin/academic-years/[year]/roster/route");
      const blockedRoster = await roster.GET(
        new Request(`http://localhost/api/admin/academic-years/${YEAR}/roster`),
        { params: Promise.resolve({ year: String(YEAR) }) },
      );
      expect(blockedRoster.status).toBe(503);

      const users = await import("@/app/api/admin/users/route");
      const allowed = await users.GET(new Request("http://localhost/api/admin/users"));
      expect(allowed.status).toBe(200);
    });
  });
});

function renameRows(rows: RosterRow[], prefix: string): RosterRow[] {
  return rows.map((row, index) => ({
    ...row,
    profile: { ...row.profile, name: `${prefix}${index}` },
  }));
}

/** 1,000행 쓰기 측정을 위한 대량 학생. 좌석은 모두 서로 다르다. */
async function seedBulkStudents(db: PrismaClient, count: number): Promise<RosterRow[]> {
  const users = Array.from({ length: count }, (_, i) => ({
    email: `bulk-${i}@example.posan.kr`,
    emailKey: `bulk-${i}@example.posan.kr`,
    name: `대상${i}`,
    role: "STUDENT" as const,
    grade: Math.floor(i / 400) + 1,
    classNum: Math.floor((i % 400) / 40) + 11,
    number: (i % 40) + 1,
    gender: (i % 2 === 0 ? "MALE" : "FEMALE") as "MALE" | "FEMALE",
  }));
  await db.user.createMany({ data: users });

  const created = await db.user.findMany({
    where: { email: { startsWith: "bulk-" } },
    orderBy: { id: "asc" },
  });
  await db.userAcademicRecord.createMany({
    data: created.map((user) => ({
      year: YEAR,
      userId: user.id,
      role: user.role,
      name: user.name,
      grade: user.grade,
      classNum: user.classNum,
      number: user.number,
      gender: user.gender,
      memberState: "ENROLLED",
    })),
  });
  const entryIds = new Map(created.map((user) => [user.id, randomUUID()]));
  await db.rosterEntry.createMany({
    data: created.map((user) => ({
      id: entryIds.get(user.id)!,
      year: YEAR,
      userId: user.id,
      emailKey: user.emailKey!,
      baseUserVersion: user.profileVersion,
    })),
  });

  return created.map((user) => ({
    entryId: entryIds.get(user.id)!,
    userId: user.id,
    email: user.email,
    emailKey: user.emailKey!,
    baseUserVersion: user.profileVersion,
    included: true,
    profile: {
      role: "STUDENT" as const,
      name: user.name,
      grade: user.grade,
      classNum: user.classNum,
      number: user.number,
      gender: user.gender,
      subject: null,
      homeroom: null,
      position: null,
    },
  }));
}
