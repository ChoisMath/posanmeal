import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Profile, RosterRow } from "@/lib/academic-year/contracts";
import { changeEmail } from "@/lib/academic-year/account-service";
import { isDomainError } from "@/lib/academic-year/errors";
import { getAcademicProfiles } from "@/lib/academic-year/profile-service";
import {
  createDraftYear,
  listRoster,
  listRosterView,
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
        email: "student-test@example.posan.kr",
        profile: studentProfile({ name: "이사", grade: 2, classNum: 4, number: 11 }),
      });

      expect(await record(fx.studentId)).toMatchObject({ grade: 2, classNum: 4, number: 11, name: "이사" });
      const user = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(user).toMatchObject({ grade: 2, classNum: 4, number: 11, email: "student-test@example.posan.kr" });
      expect(user.emailKey).toBe("student-test@example.posan.kr");
      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
      });
      expect(entry.emailKey).toBe("student-test@example.posan.kr");
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
      expect(typeof body.users[0].rowVersion).toBe("number");
      expect(body.users[0].missingAcademicRecord).toBe(false);
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

  describe("roster edits cannot change account email", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    async function changeStudentEmail() {
      const user = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      return changeEmail(db, {
        actor: fx.main, requestId: "dedicated-email-change", kind: "EMAIL",
        expectedRowVersion: user.profileVersion, payloadHash: "dedicated-email-change",
        userId: fx.studentId, email: "moved.student@example.posan.kr",
      });
    }

    async function writeRecord(email: string, version: number) {
      const { PUT } = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      return PUT(jsonRequest(`/api/admin/academic-years/${YEAR}/records/${fx.studentId}`, "PUT", {
        requestId: "record-profile-write", expectedRowVersion: version,
        email, profile: studentProfile({ name: "이름수정" }),
      }), { params: Promise.resolve({ year: String(YEAR), userId: String(fx.studentId) }) });
    }

    it.each(["record", "legacy-email", "legacy-mixed"])(
      "%s 경로는 이메일 변경을 섞은 프로필 수정을 거절하고 모두 보존한다",
      async (route) => {
        const userBefore = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
        const recordBefore = await record(fx.studentId);
        const entryBefore = await db.rosterEntry.findMany({ where: { userId: fx.studentId } });
        const mutationCount = await db.rosterMutation.count();
        let response: Response;
        if (route === "record") {
          response = await writeRecord("bypass@example.posan.kr", recordBefore.version);
        } else {
          const { PUT } = await import("@/app/api/admin/users/route");
          response = await PUT(jsonRequest("/api/admin/users", "PUT", {
            id: fx.studentId, expectedRowVersion: recordBefore.version,
            email: "bypass@example.posan.kr", ...(route === "legacy-mixed" ? { name: "이름수정" } : {}),
          }));
        }
        expect(response.status).toBe(409);
        expect(JSON.stringify(await response.json())).toContain("이메일 변경");
        expect(await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).toEqual(userBefore);
        expect(await record(fx.studentId)).toEqual(recordBefore);
        expect(await db.rosterEntry.findMany({ where: { userId: fx.studentId } })).toEqual(entryBefore);
        expect(await db.rosterMutation.count()).toBe(mutationCount);
      },
    );

    it("다른 관리자의 이메일 변경 후 예전 화면에서 이름을 저장해도 주소를 되돌리지 않는다", async () => {
      const oldVersion = await rowVersion(fx.studentId);
      await changeStudentEmail();
      expect(await rowVersion(fx.studentId)).toBe(oldVersion);
      const changedAccount = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      const response = await writeRecord("student-test@example.posan.kr", oldVersion);
      expect(response.status).toBe(409);
      expect(await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).toEqual(changedAccount);
      expect((await record(fx.studentId)).name).toBe("학생테스트");
      expect((await db.rosterEntry.findFirstOrThrow({ where: { userId: fx.studentId } })).emailKey)
        .toBe("moved.student@example.posan.kr");
    });

    it("같은 주소의 공백·대소문자 차이는 프로필만 저장하고 계정 표기를 유지한다", async () => {
      const response = await writeRecord("  Student-Test@Example.Posan.KR  ", await rowVersion(fx.studentId));
      expect(response.status).toBe(200);
      const user = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(user).toMatchObject({ name: "이름수정", email: "student-test@example.posan.kr", sessionVersion: 0 });
    });

    it("초안의 기존 계정 이메일은 일반 프로필 편집으로 변경할 수 없다", async () => {
      await createDraftYear(db, { actor: fx.main, requestId: "email-guard-draft", expectedVersion: fx.version,
        kind: "YEAR_CREATE", payloadHash: "email-guard-draft", year: NEXT_YEAR });
      const entry = await db.rosterEntry.findUniqueOrThrow({
        where: { year_userId: { year: NEXT_YEAR, userId: fx.studentId } },
      });
      await expectDomainCode(upsertRosterProfile(db, {
        actor: fx.main, requestId: "draft-email-bypass", kind: "ROSTER_ROW", payloadHash: "draft-email-bypass",
        expectedRowVersion: entry.version, year: NEXT_YEAR, entryId: entry.id, userId: fx.studentId,
        email: "bypass@example.posan.kr", profile: studentProfile({ name: "초안수정" }),
      }), "IDENTITY_CONFLICT");
      expect(await db.rosterEntry.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(entry);
    });

    it("진행 중인 이메일 변경 뒤에 잠금을 얻은 예전 프로필 저장은 거절하고 최신 명부 키를 유지한다", async () => {
      let changed!: () => void;
      let release!: () => void;
      const emailWritten = new Promise<void>((resolve) => { changed = resolve; });
      const resumed = new Promise<void>((resolve) => { release = resolve; });
      const emailClient = db.$extends({ query: { rosterEntry: {
        async updateMany({ args, query }) {
          const result = await query(args);
          changed();
          await resumed;
          return result;
        },
      } } }) as unknown as PrismaClient;
      const account = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      const emailChange = changeEmail(emailClient, {
        actor: fx.main, requestId: "pending-email-change", kind: "EMAIL", payloadHash: "pending-email-change",
        expectedRowVersion: account.profileVersion, userId: fx.studentId, email: "moved.student@example.posan.kr",
      });
      await emailWritten;
      const profileWrite = upsertRosterProfile(db, {
        actor: fx.main, requestId: "no-op-email-race", kind: "ROSTER_ROW", payloadHash: "no-op-email-race",
        expectedRowVersion: await rowVersion(fx.studentId), year: YEAR, userId: fx.studentId,
        email: account.email, profile: studentProfile({ name: account.name }),
      });
      const profileResult = profileWrite.then(() => null, (error: unknown) => error);
      try {
        await vi.waitFor(async () => {
          const waiting = await pgClient.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%"User"%'
          `);
          expect(waiting.rows[0]?.count).toBeGreaterThan(0);
        }, { timeout: 2_000, interval: 10 });
      } finally {
        release();
        await Promise.all([emailChange, profileResult]);
      }
      expect(await profileResult).toMatchObject({ code: "IDENTITY_CONFLICT" });
      expect(await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).toMatchObject({
        email: "moved.student@example.posan.kr", emailKey: "moved.student@example.posan.kr", sessionVersion: 1,
      });
      expect((await db.rosterEntry.findFirstOrThrow({ where: { userId: fx.studentId } })).emailKey)
        .toBe("moved.student@example.posan.kr");
    });

    it("프로필 저장이 잡은 계정 잠금 뒤의 이메일 변경은 최신 버전으로 재시도하고 이름을 보존한다", async () => {
      let read!: () => void;
      let release!: () => void;
      const readFinished = new Promise<void>((resolve) => { read = resolve; });
      const resumed = new Promise<void>((resolve) => { release = resolve; });
      let paused = false;
      const client = db.$extends({ query: { user: {
        async findUnique({ args, query }) {
          const account = await query(args);
          if (args.where.id === fx.studentId && args.select?.email && !paused) {
            paused = true;
            read();
            await resumed;
          }
          return account;
        },
      } } }) as unknown as PrismaClient;
      const pending = upsertRosterProfile(client, {
        actor: fx.main, requestId: "email-race-profile", kind: "ROSTER_ROW", payloadHash: "email-race-profile",
        expectedRowVersion: await rowVersion(fx.studentId), year: YEAR, userId: fx.studentId,
        email: "student-test@example.posan.kr", profile: studentProfile({ name: "동시이름수정" }),
      });
      await readFinished;
      const emailChange = changeStudentEmail().then(() => null, (error: unknown) => error);
      try {
        await vi.waitFor(async () => {
          const waiting = await pgClient.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%"User"%'
          `);
          expect(waiting.rows[0]?.count).toBeGreaterThan(0);
        }, { timeout: 2_000, interval: 10 });
      } finally {
        release();
        await Promise.all([pending, emailChange]);
      }
      expect(await emailChange).toMatchObject({ code: "VERSION_CONFLICT" });
      await changeStudentEmail();
      const user = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      expect(user).toMatchObject({ name: "동시이름수정", email: "moved.student@example.posan.kr",
        emailKey: "moved.student@example.posan.kr", sessionVersion: 1 });
      expect((await db.rosterEntry.findFirstOrThrow({ where: { userId: fx.studentId } })).emailKey)
        .toBe("moved.student@example.posan.kr");
    });
  });

  describe("exclusion and listing", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    async function excludeStudent(): Promise<void> {
      await db.rosterEntry.update({
        where: { year_userId: { year: YEAR, userId: fx.studentId } },
        data: { included: false },
      });
    }

    it("keeps an excluded row excluded when an unrelated cell is edited", async () => {
      await excludeStudent();

      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(jsonRequest("/api/admin/users", "PUT", { id: fx.studentId, name: "이름만수정" }));

      expect(res.status).toBe(200);
      expect((await record(fx.studentId)).name).toBe("이름만수정");
      expect(
        (await db.rosterEntry.findUniqueOrThrow({ where: { year_userId: { year: YEAR, userId: fx.studentId } } }))
          .included,
      ).toBe(false);
    });

    it("keeps an excluded row excluded through the record route too", async () => {
      await excludeStudent();

      const records = await import("@/app/api/admin/academic-years/[year]/records/[userId]/route");
      const res = await records.PUT(
        jsonRequest(`/api/admin/academic-years/${YEAR}/records/${fx.studentId}`, "PUT", {
          requestId: randomUUID(),
          expectedRowVersion: await rowVersion(fx.studentId),
          email: "student-test@example.posan.kr",
          profile: studentProfile({ name: "행경로수정" }),
        }),
        { params: Promise.resolve({ year: String(YEAR), userId: String(fx.studentId) }) },
      );

      expect(res.status).toBe(200);
      expect(
        (await db.rosterEntry.findUniqueOrThrow({ where: { year_userId: { year: YEAR, userId: fx.studentId } } }))
          .included,
      ).toBe(false);
    });

    it("hides excluded rows from the ordinary roster and shows them only on request", async () => {
      await excludeStudent();

      expect(await listRoster(db, YEAR, "STUDENT")).toHaveLength(0);
      const all = await listRoster(db, YEAR, "STUDENT", { includeExcluded: true });
      expect(all).toHaveLength(1);
      expect(all[0]!.included).toBe(false);
    });
  });

  describe("legacy admin API without a year record", () => {
    beforeEach(async () => {
      await seedLegacyFixture(db);
    });

    it("lists every user while preparing and marks the missing record", async () => {
      const { GET } = await import("@/app/api/admin/users/route");
      const res = await GET(new Request("http://localhost/api/admin/users"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.users).toHaveLength(2);
      for (const user of body.users) {
        expect(user.missingAcademicRecord).toBe(true);
        expect(user.rowVersion).toBeNull();
      }
      expect(body.users.map((u: { name: string }) => u.name)).toContain("학생테스트");
    });

    it("creates the active year record on a partial edit of a user that has none", async () => {
      const student = await db.user.findFirstOrThrow({ where: { role: "STUDENT" } });

      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(jsonRequest("/api/admin/users", "PUT", { id: student.id, classNum: 4 }));

      expect(res.status).toBe(200);
      expect(await record(student.id)).toMatchObject({
        classNum: 4,
        grade: 1,
        number: 1,
        name: "학생테스트",
        memberState: "ENROLLED",
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).classNum).toBe(4);
      expect(await db.rosterEntry.count({ where: { year: YEAR, userId: student.id } })).toBe(1);
    });

    it("refuses to create a record on a past year", async () => {
      const student = await db.user.findFirstOrThrow({ where: { role: "STUDENT" } });
      await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED", version: 0 } });

      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users?academicYear=2025", "PUT", { id: student.id, classNum: 4 }),
      );

      expect(res.status).toBe(422);
      expect(await db.userAcademicRecord.count({ where: { year: 2025 } })).toBe(0);
    });
  });

  describe("adminLevel on the legacy PUT", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("lets the main admin change a teacher's level", async () => {
      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users", "PUT", { id: fx.teacherId, adminLevel: "SUBADMIN" }),
      );

      expect(res.status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } })).adminLevel).toBe("SUBADMIN");
    });

    it("refuses a write admin and writes nothing at all", async () => {
      const other = await db.user.create({
        data: { email: "other-teacher@example.posan.kr", name: "다른교사", role: "TEACHER", adminLevel: "NONE" },
      });
      const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
      mocks.auth.mockResolvedValue({
        user: {
          dbUserId: teacher.id,
          role: "TEACHER",
          adminLevel: "ADMIN",
          sessionVersion: teacher.sessionVersion,
        },
      });

      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users", "PUT", { id: other.id, adminLevel: "ADMIN", name: "이름도같이" }),
      );

      expect(res.status).toBe(403);
      expect(await db.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({
        adminLevel: "NONE",
        name: "다른교사",
      });
    });

    it("ignores an unchanged adminLevel sent by a write admin", async () => {
      const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
      mocks.auth.mockResolvedValue({
        user: {
          dbUserId: teacher.id,
          role: "TEACHER",
          adminLevel: "ADMIN",
          sessionVersion: teacher.sessionVersion,
        },
      });

      const { PUT } = await import("@/app/api/admin/users/route");
      const res = await PUT(
        jsonRequest("/api/admin/users", "PUT", { id: fx.studentId, adminLevel: "NONE", name: "학생수정" }),
      );

      expect(res.status).toBe(200);
      expect((await record(fx.studentId)).name).toBe("학생수정");
    });
  });

  describe("draft rows that are not yet valid", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-lenient",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-lenient",
        year: NEXT_YEAR,
      });
    });

    it("lists an incomplete draft row instead of failing the whole year", async () => {
      const [row] = await listRosterView(db, NEXT_YEAR);
      await db.rosterEntry.update({
        where: { id: row!.entryId },
        data: { draftProfile: { role: "STUDENT", name: "미완성", grade: null, classNum: 2 } },
      });

      const rows = await listRosterView(db, NEXT_YEAR);
      const broken = rows.find((entry) => entry.entryId === row!.entryId);
      expect(broken).toBeDefined();
      expect(broken!.incomplete).toBe(true);
      expect(broken!.profile).toMatchObject({ name: "미완성", grade: null, classNum: 2, number: null });
      expect(broken!.issues.map((issue) => issue.field)).toEqual(
        expect.arrayContaining(["grade", "number", "gender"]),
      );
    });

    it("still refuses to write an incomplete profile", async () => {
      const [row] = await listRosterView(db, NEXT_YEAR);
      await expectDomainCode(
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "draft-invalid-write",
          expectedRowVersion: row!.version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: "draft-invalid-write",
          year: NEXT_YEAR,
          entryId: row!.entryId,
          userId: row!.userId ?? undefined,
          email: row!.email,
          profile: { ...row!.profile, grade: null },
        }),
        "MISSING_PROFILE",
      );
    });
  });

  describe("bulk writer guards", () => {
    let fx: AcademicFixture;

    beforeEach(async () => {
      fx = await prepareAcademicFixture(db, pgClient);
    });

    it("refuses the same user twice in one batch", async () => {
      const rows = await listRoster(db, YEAR, "STUDENT");
      await expectDomainCode(
        db.$transaction(async (tx) => {
          await writeRosterProfiles(tx, YEAR, [
            { ...rows[0]!, email: "a@example.posan.kr", emailKey: "a@example.posan.kr" },
            { ...rows[0]!, email: "b@example.posan.kr", emailKey: "b@example.posan.kr" },
          ]);
        }),
        "IDENTITY_CONFLICT",
      );
    });

    it("rotates three seats in one call", async () => {
      const b = await addStudent(fx, "cycle-b@example.posan.kr", studentProfile({ name: "순환나", number: 2 }));
      const c = await addStudent(fx, "cycle-c@example.posan.kr", studentProfile({ name: "순환다", number: 3 }));
      const next = new Map([[fx.studentId, 2], [b, 3], [c, 1]]);

      const rows = await listRoster(db, YEAR, "STUDENT");
      await db.$transaction(async (tx) => {
        await writeRosterProfiles(
          tx,
          YEAR,
          rows.map((row) => ({
            ...row,
            profile: { ...row.profile, number: next.get(row.userId!)! },
          })),
        );
      });

      expect((await record(fx.studentId)).number).toBe(2);
      expect((await record(b)).number).toBe(3);
      expect((await record(c)).number).toBe(1);
      expect(await db.userAcademicRecord.count({ where: { year: YEAR, needsReview: true } })).toBe(0);
    });

    it("moves a student onto a seat vacated in the same call", async () => {
      const mover = await addStudent(fx, "mover@example.posan.kr", studentProfile({ name: "이동", number: 9 }));

      const rows = await listRoster(db, YEAR, "STUDENT");
      await db.$transaction(async (tx) => {
        await writeRosterProfiles(
          tx,
          YEAR,
          rows.map((row) => ({
            ...row,
            profile: {
              ...row.profile,
              number: row.userId === fx.studentId ? 5 : row.userId === mover ? 1 : row.profile.number,
            },
          })),
        );
      });

      expect((await record(fx.studentId)).number).toBe(5);
      expect((await record(mover)).number).toBe(1);
    });

    it("ends a race for one free seat as a conflict, never as an unhandled error", async () => {
      const b = await addStudent(fx, "race-b@example.posan.kr", studentProfile({ name: "경합나", number: 2 }));

      const move = (userId: number, email: string, name: string, version: number) =>
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: `seat-race-${userId}`,
          expectedRowVersion: version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: `seat-race-${userId}`,
          year: YEAR,
          userId,
          email,
          profile: studentProfile({ name, number: 7 }),
        });

      const settled = await Promise.allSettled([
        move(fx.studentId, "student-test@example.posan.kr", "경합가", await rowVersion(fx.studentId)),
        move(b, "race-b@example.posan.kr", "경합나", await rowVersion(b)),
      ]);

      expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = settled.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(isDomainError(rejected.reason)).toBe(true);
      expect(rejected.reason.code).toBe("IDENTITY_CONFLICT");
    });

    it("refuses to create a missing record on an archived year", async () => {
      await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED", version: 0 } });

      await expectDomainCode(
        upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "archived-create",
          expectedRowVersion: 0,
          expectedVersion: (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version,
          kind: "ROSTER_ROW",
          payloadHash: "archived-create",
          year: 2025,
          userId: fx.studentId,
          email: "student-test@example.posan.kr",
          profile: studentProfile(),
        }),
        "YEAR_MISMATCH",
      );
      expect(await db.userAcademicRecord.count({ where: { year: 2025 } })).toBe(0);
    });

    it("refuses the edit when the year state changed after the target was chosen", async () => {
      await createDraftYear(db, {
        actor: fx.main,
        requestId: "draft-flip",
        expectedVersion: fx.version,
        kind: "DRAFT",
        payloadHash: "draft-flip",
        year: NEXT_YEAR,
      });
      const [row] = await listRosterView(db, NEXT_YEAR, "STUDENT");

      const holder = await openAcademicTestPgClient();
      try {
        await holder.query("BEGIN");
        await holder.query('SELECT id FROM "RosterEntry" WHERE id = $1 FOR UPDATE', [row!.entryId]);

        const pending = upsertRosterProfile(db, {
          actor: fx.main,
          requestId: "draft-flip-edit",
          expectedRowVersion: row!.version,
          expectedVersion: 0,
          kind: "ROSTER_ROW",
          payloadHash: "draft-flip-edit",
          year: NEXT_YEAR,
          entryId: row!.entryId,
          userId: row!.userId ?? undefined,
          email: row!.email,
          profile: { ...row!.profile, classNum: 7 },
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        await holder.query(`UPDATE "AcademicYear" SET state = 'ARCHIVED' WHERE year = $1`, [NEXT_YEAR]);
        await holder.query("COMMIT");

        await expectDomainCode(pending, "VERSION_CONFLICT");
      } finally {
        await holder.end();
      }
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
