import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import {
  ACADEMIC_BACKFILL_KEY,
  INITIAL_ACADEMIC_YEAR,
  backfill2026,
  copyAcademicRecords,
  verifyBackfill,
} from "@/lib/academic-year/backfill";
import { enableAcademicMode, requireAcademicReady } from "@/lib/academic-year/readiness";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";
import {
  assertApplyAllowed,
  assertUrlMatchesTarget,
  parseCliArgs,
  parseMigrationTargetConfig,
  safeErrorKind,
} from "../../scripts/academic-year/db-target";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { seedLegacyFixture, type LegacyFixtureIds } from "./support/legacy-fixture";
import { prepareAcademicFixture } from "./support/academic-fixture";

const MAIN: Actor = { kind: "MAIN", userId: null, sessionVersion: null };

describe("2026 backfill", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fixture: LegacyFixtureIds;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fixture = await seedLegacyFixture(db);
  });

  it("leaves every legacy table untouched and never recreates a roster deleted after COPIED", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(pgClient);

    expect(compareLegacyFingerprints(before, after).equal).toBe(true);
    expect(await db.userAcademicRecord.count()).toBe(2);
    expect(await db.rosterEntry.count()).toBe(2);

    await db.rosterEntry.deleteMany({ where: { year: INITIAL_ACADEMIC_YEAR } });
    const rerun = await backfill2026(db, before);

    expect(rerun.inserted).toBe(0);
    expect(await db.rosterEntry.count()).toBe(0);
    expect(await db.checkIn.findUnique({ where: { id: fixture.checkInId } })).not.toBeNull();
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
  });

  it("fills the new columns without moving the legacy updatedAt values", async () => {
    const usersBefore = await db.user.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true } });
    const applicationBefore = await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } });

    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);

    const usersAfter = await db.user.findMany({
      orderBy: { id: "asc" },
      select: { id: true, updatedAt: true, emailKey: true },
    });
    const applicationAfter = await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } });

    expect(usersAfter.map((user) => user.updatedAt)).toEqual(usersBefore.map((user) => user.updatedAt));
    expect(usersAfter.map((user) => user.emailKey)).toEqual([
      "student-test@example.posan.kr",
      "teacher-test@example.posan.kr",
    ]);
    expect(applicationAfter.updatedAt).toEqual(applicationBefore.updatedAt);
    expect(applicationAfter.academicYear).toBe(INITIAL_ACADEMIC_YEAR);
  });

  it("copies a missing gender as-is and marks the record for review", async () => {
    const student = await db.user.create({
      data: { email: "no-gender@example.posan.kr", name: "성별없음", role: "STUDENT", grade: 2, classNum: 3, number: 4 },
    });

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: INITIAL_ACADEMIC_YEAR, userId: student.id } },
    });
    expect(record.gender).toBeNull();
    expect(record.needsReview).toBe(true);
    expect(result.blockingIssues).toEqual([]);
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
  });

  it("keeps both members of a duplicate student seat and flags them instead of picking a winner", async () => {
    const twins = await Promise.all(
      ["dup-a@example.posan.kr", "dup-b@example.posan.kr"].map((email) =>
        db.user.create({
          data: { email, name: "중복학번", role: "STUDENT", grade: 3, classNum: 2, number: 7, gender: "FEMALE" },
        }),
      ),
    );

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    const records = await db.userAcademicRecord.findMany({ where: { userId: { in: twins.map((user) => user.id) } } });
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.needsReview)).toBe(true);
    expect(result.blockingIssues).toContain("DUPLICATE_SEAT:1");
  });

  it("leaves emailKey null for a normalized-email collision group and reports it as blocking", async () => {
    const collided = await Promise.all(
      ["Case@Example.Posan.kr", "case@example.posan.kr"].map((email, index) =>
        db.user.create({
          data: { email, name: `대소문자${index}`, role: "TEACHER", subject: "국어" },
        }),
      ),
    );

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    const users = await db.user.findMany({ where: { id: { in: collided.map((user) => user.id) } } });
    expect(users.every((user) => user.emailKey === null)).toBe(true);
    expect(await db.rosterEntry.count({ where: { userId: { in: collided.map((user) => user.id) } } })).toBe(0);
    expect(result.blockingIssues).toContain("EMAIL_COLLISION:1");
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
  });

  it("refuses to stamp academicYear on an application whose confirmed date falls outside the year", async () => {
    const strayApplication = await db.mealApplication.create({
      data: {
        title: "범위 밖 신청",
        status: "CLOSED",
        startYear: 2027,
        startMonth: 3,
        monthCount: 1,
        mealDates: { create: [{ mealKind: "DINNER", grade: 1, date: new Date("2027-03-05T00:00:00.000Z") }] },
      },
    });

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    const stray = await db.mealApplication.findUniqueOrThrow({ where: { id: strayApplication.id } });
    expect(stray.academicYear).toBeNull();
    expect(result.blockingIssues).toContain("APPLICATION_OUT_OF_YEAR:1");

    const inRange = await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } });
    expect(inRange.academicYear).toBe(INITIAL_ACADEMIC_YEAR);
  });

  it("rolls the whole copy back when a write fails right before completion", async () => {
    // 복사의 마지막 문장(신청 학년도 채우기)에서만 터지는 오류를 심는다. 이 시점에는
    // 기록·명부가 이미 INSERT된 뒤라 롤백 범위를 제대로 볼 수 있다.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION academic_test_fail() RETURNS trigger AS $fn$
      BEGIN RAISE EXCEPTION 'injected failure'; END;
      $fn$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER academic_test_fail_trg BEFORE UPDATE ON "MealApplication"
      FOR EACH ROW EXECUTE FUNCTION academic_test_fail()
    `);

    const before = await captureLegacyFingerprint(pgClient);
    try {
      await expect(backfill2026(db, before)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER academic_test_fail_trg ON "MealApplication"`);
      await db.$executeRawUnsafe(`DROP FUNCTION academic_test_fail()`);
    }

    expect(await db.userAcademicRecord.count()).toBe(0);
    expect(await db.rosterEntry.count()).toBe(0);
    expect(await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } })).toBeNull();
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
  });

  it("finishes the copy when another row already holds a user's normalized email key", async () => {
    // 옛 정규화로 심긴 키가 남의 자리를 차지해도 복사를 멈추지 않는다. 키를 못 받은
    // 쪽은 비워 둘 뿐이다.
    await db.$executeRaw`
      UPDATE "User" SET "emailKey" = 'teacher-test@example.posan.kr' WHERE id = ${fixture.studentId}
    `;

    const result = await backfill2026(db, await captureLegacyFingerprint(pgClient));

    expect(result.inserted).toBe(2);
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fixture.teacherId } });
    expect(teacher.emailKey).toBeNull();
  });

  it("skips a record the compat path already wrote instead of overwriting it", async () => {
    await db.userAcademicRecord.create({
      data: {
        year: INITIAL_ACADEMIC_YEAR,
        userId: fixture.studentId,
        role: "STUDENT",
        name: "학생테스트",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "MALE",
        memberState: "ENROLLED",
        version: 7,
      },
    });

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: INITIAL_ACADEMIC_YEAR, userId: fixture.studentId } },
    });
    expect(record.version).toBe(7);
    expect(result.inserted).toBe(1);
    expect(result.blockingIssues).toEqual([]);
    expect(await db.userAcademicRecord.count()).toBe(2);
  });

  it("copies users the preflight never saw without a unique violation", async () => {
    // 사전 점검을 전혀 거치지 않고 복사 단계만 호출해, 문장 스스로 충돌 그룹을
    // 계산하는지 본다. 운영 중 사전 점검과 복사 사이에 들어온 행과 같은 상황이다.
    const seatTwin = await db.user.create({
      data: {
        email: "late-seat@example.posan.kr",
        name: "늦은학생",
        role: "STUDENT",
        grade: 1,
        classNum: 1,
        number: 1,
        gender: "FEMALE",
      },
    });
    const emailTwin = await db.user.create({
      data: {
        email: "STUDENT-TEST@example.posan.kr",
        name: "늦은중복",
        role: "STUDENT",
        grade: 2,
        classNum: 2,
        number: 2,
        gender: "MALE",
      },
    });

    const before = await captureLegacyFingerprint(pgClient);
    const inserted = await db.$transaction((tx) => copyAcademicRecords(tx, INITIAL_ACADEMIC_YEAR));

    expect(inserted).toBe(4);
    const records = await db.userAcademicRecord.findMany({ orderBy: { userId: "asc" } });
    const flagged = new Map(records.map((record) => [record.userId, record.needsReview]));
    expect(flagged.get(fixture.studentId)).toBe(true);
    expect(flagged.get(seatTwin.id)).toBe(true);
    expect(flagged.get(emailTwin.id)).toBe(true);
    expect(flagged.get(fixture.teacherId)).toBe(false);

    const users = await db.user.findMany({ orderBy: { id: "asc" }, select: { id: true, emailKey: true } });
    const keys = new Map(users.map((user) => [user.id, user.emailKey]));
    expect(keys.get(fixture.studentId)).toBeNull();
    expect(keys.get(emailTwin.id)).toBeNull();
    expect(keys.get(seatTwin.id)).toBe("late-seat@example.posan.kr");

    expect(await db.rosterEntry.count()).toBe(2);
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
  });

  it("reports an existing record that disagrees with the legacy source", async () => {
    await db.userAcademicRecord.create({
      data: {
        year: INITIAL_ACADEMIC_YEAR,
        userId: fixture.studentId,
        role: "STUDENT",
        name: "다른이름",
        grade: 5,
        classNum: 1,
        number: 1,
        gender: "MALE",
        memberState: "ENROLLED",
      },
    });

    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before);

    expect(result.blockingIssues).toContain("RECORD_MISMATCH:1");
  });
});

describe("backfill verification and readiness", () => {
  let db: PrismaClient;
  let pgClient: Client;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    await seedLegacyFixture(db);
  });

  it("verifies a clean copy and only then lets the main admin enable the new mode", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(pgClient);

    await expect(requireAcademicReady(db)).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });

    const verified = await verifyBackfill(db, before, after);
    expect(verified).toEqual({ canEnable: true, issues: [] });
    expect((await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).state).toBe(
      "VERIFIED",
    );

    await enableAcademicMode(db, MAIN);
    await expect(requireAcademicReady(db)).resolves.toBeUndefined();
  });

  it("refuses to verify when a legacy table changed between the two fingerprints", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await db.systemSetting.update({ where: { key: "faceMatchThreshold" }, data: { value: "0.6" } });
    const after = await captureLegacyFingerprint(pgClient);

    const verified = await verifyBackfill(db, before, after);
    expect(verified.canEnable).toBe(false);
    expect(verified.issues).toContain("LEGACY_MODIFIED:SystemSetting");
    expect((await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).state).toBe(
      "COPIED",
    );
  });

  it("refuses to verify while a blocking issue remains", async () => {
    await db.user.create({
      data: { email: "Dup@Example.posan.kr", name: "충돌", role: "TEACHER" },
    });
    await db.user.create({
      data: { email: "dup@example.posan.kr", name: "충돌2", role: "TEACHER" },
    });

    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(pgClient);

    const verified = await verifyBackfill(db, before, after);
    expect(verified.canEnable).toBe(false);
    expect(verified.issues).toContain("EMAIL_COLLISION:1");
    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("refuses to enable for anyone but the main admin", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));

    const teacher = await db.user.findFirstOrThrow({ where: { role: "TEACHER" } });
    await expect(
      enableAcademicMode(db, { kind: "USER", userId: teacher.id, sessionVersion: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");
  });
});

describe("test fixture", () => {
  let db: PrismaClient;
  let pgClient: Client;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
  });

  it("hands later tasks a READY control, a main actor and a teacher writer", async () => {
    const fx = await prepareAcademicFixture(db, pgClient);

    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    expect(control.mode).toBe("READY");
    expect(fx.version).toBe(control.version);
    expect(fx.main).toEqual({ kind: "MAIN", userId: null, sessionVersion: null });
    expect(fx.writer).toEqual({ kind: "USER", userId: fx.teacherId, sessionVersion: 0 });

    const event = await db.userAccessEvent.findFirstOrThrow({ where: { userId: fx.teacherId } });
    expect(event.effectiveAt.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(await db.userAcademicRecord.count()).toBe(2);
  });
});

describe("migration CLI guards", () => {
  const config = {
    environment: "test",
    host: "127.0.0.1",
    port: 55439,
    database: "posanmeal_academic_year_test",
    username: "academic_year_test",
    markerScope: "test",
    marker: "posanmeal-academic-tests-v1",
    restoreReportId: "restore-2026-09-19",
  };

  const applyArgs = ["--mode", "apply", "--target-config", "t.json", "--report-dir", "r"];

  it("refuses an apply against a target without a restore report id", () => {
    const parsed = parseMigrationTargetConfig({ ...config, restoreReportId: null });
    expect(parsed.restoreReportId).toBeNull();
    expect(() => assertApplyAllowed(parseCliArgs(applyArgs), parsed)).toThrow();
    expect(() => assertApplyAllowed(parseCliArgs([]), parsed)).not.toThrow();
  });

  it("defaults to inspect and requires both paths before an apply", () => {
    const parsed = parseMigrationTargetConfig(config);
    expect(parseCliArgs([]).mode).toBe("inspect");
    expect(() => parseCliArgs(["--mode", "apply", "--target-config", "t.json"])).toThrow();
    expect(parseCliArgs(applyArgs).mode).toBe("apply");
    expect(() => assertApplyAllowed(parseCliArgs(applyArgs), parsed)).not.toThrow();
  });

  it("refuses a URL that does not match the approved target before connecting", () => {
    const parsed = parseMigrationTargetConfig(config);
    expect(() =>
      assertUrlMatchesTarget("postgresql://academic_year_test@10.0.0.1:55439/posanmeal_academic_year_test", parsed),
    ).toThrow();
    expect(() => assertUrlMatchesTarget("postgresql://someone_else@127.0.0.1:55439/prod", parsed)).toThrow();
    expect(
      assertUrlMatchesTarget(
        "postgresql://academic_year_test:local-only@127.0.0.1:55439/posanmeal_academic_year_test",
        parsed,
      ).hostname,
    ).toBe("127.0.0.1");
  });

  it("reduces an error to a kind and never leaks the violating value", () => {
    const pgError = Object.assign(new Error('duplicate key value: Key ("emailKey")=(leak@example.kr) already exists'), {
      code: "23505",
      constraint: "User_emailKey_key",
    });
    expect(safeErrorKind(pgError)).toBe("Postgres:23505:User_emailKey_key");
    expect(safeErrorKind(pgError)).not.toContain("leak@example.kr");

    const prismaError = Object.assign(new Error("Unique constraint failed on leak@example.kr"), { code: "P2002" });
    expect(safeErrorKind(prismaError)).toBe("Prisma:P2002");

    const domainError = Object.assign(new Error("leak@example.kr"), { name: "DomainError", code: "NOT_READY" });
    expect(safeErrorKind(domainError)).toBe("DomainError:NOT_READY");
    expect(safeErrorKind(new Error("leak@example.kr"))).toBe("Error:UNKNOWN");
  });

  it("rejects a config whose marker scope is not one of the two known targets", () => {
    expect(() => parseMigrationTargetConfig({ ...config, markerScope: "public" })).toThrow();
    expect(() => parseMigrationTargetConfig({ ...config, marker: "" })).toThrow();
  });
});
