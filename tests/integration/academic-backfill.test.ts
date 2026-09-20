import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import {
  ACADEMIC_BACKFILL_KEY,
  INITIAL_ACADEMIC_YEAR,
  backfill2026,
  captureDateLessSurveySource,
  copyAcademicRecords,
  parseDateLessSurveyConfirmations,
  runPreflight,
  verifyBackfill,
} from "@/lib/academic-year/backfill";
import { enableAcademicMode, inspectAcademicMode, requireAcademicReady } from "@/lib/academic-year/readiness";
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

  it("preserves an explicitly confirmed dateless survey and its evidence through verify and rerun", async () => {
    await db.mealApplicationMealDate.deleteMany({ where: { applicationId: fixture.applicationId } });
    await db.mealRegistrationMealDate.deleteMany({ where: { registrationId: fixture.registrationId } });
    const before = await captureLegacyFingerprint(pgClient);
    const confirmation = {
      applicationId: fixture.applicationId,
      academicYear: 2026 as const,
      kind: "DATELESS_INTENT_SURVEY" as const,
      expectedApprovedRegistrationCount: 1,
      expectedTotalRegistrationCount: 1,
      expectedSourceRowHash: (await captureDateLessSurveySource(db, fixture.applicationId))!.sourceRowHash,
    };
    const result = await backfill2026(db, before, [confirmation]);
    expect(result.blockingIssues).toEqual([]);
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
    expect(await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } }))
      .toMatchObject({ academicYear: 2026 });
    const copied = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const resolutions = (copied.sourceManifest as Record<string, unknown>).dateLessSurveyResolutions;
    expect(resolutions).toEqual([expect.objectContaining({
      applicationId: fixture.applicationId,
      academicYear: 2026,
      kind: "DATELESS_INTENT_SURVEY",
      registrations: [{ id: fixture.registrationId, status: "APPROVED" }],
      sourceRowHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
    expect((await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient))).canEnable).toBe(true);
    await backfill2026(db, before);
    const rerun = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    expect((rerun.sourceManifest as Record<string, unknown>).dateLessSurveyResolutions).toEqual(resolutions);
    await enableAcademicMode(db, MAIN);
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("READY");
  });

  async function prepareSurveyConfirmation() {
    await db.mealApplicationMealDate.deleteMany({ where: { applicationId: fixture.applicationId } });
    await db.mealRegistrationMealDate.deleteMany({ where: { registrationId: fixture.registrationId } });
    return {
      applicationId: fixture.applicationId, academicYear: 2026 as const, kind: "DATELESS_INTENT_SURVEY" as const,
      expectedApprovedRegistrationCount: 1, expectedTotalRegistrationCount: 1,
      expectedSourceRowHash: (await captureDateLessSurveySource(db, fixture.applicationId))!.sourceRowHash,
    };
  }

  it("never exempts another dateless application or an application with only its year manually filled", async () => {
    const confirmation = await prepareSurveyConfirmation();
    const other = await db.mealApplication.create({ data: {
      title: "미확인 합성 공고", academicYear: 2026, applyStartAt: new Date("2026-05-01"),
      applyEndAt: new Date("2026-05-20"), startYear: 2026, startMonth: 5,
    } });
    await db.mealRegistration.create({ data: { applicationId: other.id, userId: fixture.studentId, signature: "합성 서명", status: "APPROVED" } });
    const before = await captureLegacyFingerprint(pgClient);
    const result = await backfill2026(db, before, [confirmation]);
    expect(result.blockingIssues).toEqual(["APPLICATION_YEAR_UNKNOWN:1", "REGISTRATION_WITHOUT_DATES:1"]);
    expect((await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient))).canEnable).toBe(false);
    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it.each(["missing-application", "approved-count", "total-count", "source-hash", "application-date", "cancelled-registration-date"])(
    "rejects a survey confirmation with %s before any copy is committed", async (mismatch) => {
      const confirmation = await prepareSurveyConfirmation();
      if (mismatch === "missing-application") confirmation.applicationId += 999;
      if (mismatch === "approved-count") confirmation.expectedApprovedRegistrationCount += 1;
      if (mismatch === "total-count") confirmation.expectedTotalRegistrationCount += 1;
      if (mismatch === "source-hash") confirmation.expectedSourceRowHash = "0".repeat(64);
      if (mismatch === "application-date") {
        await db.mealApplicationMealDate.create({ data: {
          applicationId: fixture.applicationId, mealKind: "DINNER", grade: 1, date: new Date("2026-05-01"),
        } });
      }
      if (mismatch === "cancelled-registration-date") {
        await db.mealRegistration.update({ where: { id: fixture.registrationId }, data: { status: "CANCELLED" } });
        await db.mealRegistrationMealDate.create({ data: {
          registrationId: fixture.registrationId, mealKind: "DINNER", date: new Date("2026-05-01"),
        } });
        confirmation.expectedApprovedRegistrationCount = 0;
        confirmation.expectedSourceRowHash = (await captureDateLessSurveySource(db, fixture.applicationId))!.sourceRowHash;
      }
      const before = await captureLegacyFingerprint(pgClient);
      await expect(backfill2026(db, before, [confirmation])).rejects.toMatchObject({ code: "NOT_READY" });
      expect(await db.userAcademicRecord.count()).toBe(0);
      expect(await db.academicBackfill.count()).toBe(0);
      expect((await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } })).academicYear).toBeNull();
      expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
    },
  );

  it.each(["signature", "status", "replacement-registration", "timestamp", "application-meal", "registration-meal", "application-date", "registration-date", "academic-year"])(
    "rechecks stored survey evidence after %s changes before verify or READY", async (change) => {
      const confirmation = await prepareSurveyConfirmation();
      const before = await captureLegacyFingerprint(pgClient);
      await backfill2026(db, before, [confirmation]);
      await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
      expect((await inspectAcademicMode(db)).canEnable).toBe(true);
      const original = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
      if (change === "signature") await db.$executeRaw`UPDATE "MealRegistration" SET signature = '변경 서명' WHERE id = ${fixture.registrationId}`;
      if (change === "status") await db.$executeRaw`UPDATE "MealRegistration" SET status = 'CANCELLED' WHERE id = ${fixture.registrationId}`;
      if (change === "timestamp") await db.$executeRaw`UPDATE "MealApplication" SET "updatedAt" = "updatedAt" + interval '1 millisecond' WHERE id = ${fixture.applicationId}`;
      if (change === "replacement-registration") {
        await db.mealRegistration.delete({ where: { id: fixture.registrationId } });
        await db.mealRegistration.create({ data: {
          applicationId: fixture.applicationId, userId: fixture.studentId, signature: "학생테스트-서명", status: "APPROVED",
        } });
      }
      if (change === "application-meal") await db.mealApplicationMeal.updateMany({ data: { price: 9999 } });
      if (change === "registration-meal") await db.mealRegistrationMeal.updateMany({ data: { exempt: true } });
      if (change === "application-date") await db.mealApplicationMealDate.create({ data: {
        applicationId: fixture.applicationId, mealKind: "DINNER", grade: 1, date: new Date("2026-05-01"),
      } });
      if (change === "registration-date") await db.mealRegistrationMealDate.create({ data: {
        registrationId: fixture.registrationId, mealKind: "DINNER", date: new Date("2026-05-01"),
      } });
      if (change === "academic-year") await db.$executeRaw`UPDATE "MealApplication" SET "academicYear" = NULL WHERE id = ${fixture.applicationId}`;
      expect((await inspectAcademicMode(db)).issues).toContain("DATELESS_SURVEY_EVIDENCE_INVALID:1");
      await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
      expect((await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient))).issues)
        .toContain("DATELESS_SURVEY_EVIDENCE_INVALID:1");
      const rerun = await backfill2026(db, before);
      expect(rerun.blockingIssues).toContain("DATELESS_SURVEY_EVIDENCE_INVALID:1");
      const changed = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
      expect((changed.sourceManifest as Record<string, unknown>).dateLessSurveyResolutions)
        .toEqual((original.sourceManifest as Record<string, unknown>).dateLessSurveyResolutions);
      expect(changed.state).toBe("COPIED");
      expect(changed.verifiedAt).toBeNull();
    },
  );

  it("does not silently replace stored survey evidence or discard malformed proof", async () => {
    const confirmation = await prepareSurveyConfirmation();
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before, [confirmation]);
    await expect(backfill2026(db, before, [confirmation])).rejects.toMatchObject({ code: "NOT_READY" });
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const malformed = { ...stamp.sourceManifest as Record<string, unknown>, dateLessSurveyResolutions: [{ applicationId: fixture.applicationId }] };
    await db.academicBackfill.update({ where: { key: ACADEMIC_BACKFILL_KEY }, data: { sourceManifest: JSON.parse(JSON.stringify(malformed)) } });
    expect((await runPreflight(db)).issues).toEqual([
      "APPLICATION_YEAR_UNKNOWN:1", "DATELESS_SURVEY_EVIDENCE_INVALID:1", "REGISTRATION_WITHOUT_DATES:1",
    ]);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    const result = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    expect((result.sourceManifest as Record<string, unknown>).dateLessSurveyResolutions).toEqual(malformed.dateLessSurveyResolutions);
  });

  it("produces the same survey proof in UTC and KST sessions", async () => {
    await prepareSurveyConfirmation();
    const utc = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return captureDateLessSurveySource(tx, fixture.applicationId);
    });
    const kst = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
      return captureDateLessSurveySource(tx, fixture.applicationId);
    });
    expect(kst).toEqual(utc);
  });

  it.each(["application-meal", "registration-meal"])(
    "waits for an in-flight %s write and rejects stale survey confirmation atomically", async (table) => {
      const confirmation = await prepareSurveyConfirmation();
      const before = await captureLegacyFingerprint(pgClient);
      await pgClient.query("BEGIN");
      if (table === "application-meal") {
        await pgClient.query('UPDATE "MealApplicationMeal" SET price = price + 1 WHERE "applicationId" = $1', [fixture.applicationId]);
      } else {
        await pgClient.query('UPDATE "MealRegistrationMeal" SET exempt = true WHERE "registrationId" = $1', [fixture.registrationId]);
      }
      const outcome = backfill2026(db, before, [confirmation])
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      try {
        await expect.poll(async () => {
          await pgClient.query("SELECT pg_stat_clear_snapshot()");
          const waiting = await pgClient.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE 'LOCK TABLE "MealApplication"%'
          `);
          return waiting.rows[0]?.count ?? 0;
        }, { timeout: 2000, interval: 10 }).toBeGreaterThan(0);
      } finally {
        await pgClient.query("COMMIT");
        await outcome;
      }
      expect(await outcome).toMatchObject({ error: { code: "NOT_READY" } });
      expect(await db.userAcademicRecord.count()).toBe(0);
      expect(await db.rosterEntry.count()).toBe(0);
      expect(await db.academicBackfill.count()).toBe(0);
      expect((await db.mealApplication.findUniqueOrThrow({ where: { id: fixture.applicationId } })).academicYear).toBeNull();
    },
  );

  it.each(["verify", "enable"])("%s waits for an in-flight application write and validates its committed state", async (operation) => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(pgClient);
    await verifyBackfill(db, before, after);
    await pgClient.query("BEGIN");
    await pgClient.query('UPDATE "MealApplication" SET "academicYear" = NULL WHERE id = $1', [fixture.applicationId]);
    const pending = operation === "verify"
      ? verifyBackfill(db, before, after)
      : enableAcademicMode(db, MAIN);
    const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await expect.poll(async () => {
        await pgClient.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await pgClient.query<{ count: number }>(`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'LOCK TABLE "MealApplication"%'
        `);
        return waiting.rows[0]?.count ?? 0;
      }, { timeout: 2000, interval: 10 }).toBeGreaterThan(0);
    } finally {
      await pgClient.query("COMMIT");
      await outcome;
    }

    if (operation === "verify") {
      expect(await outcome).toMatchObject({ value: { canEnable: false, issues: ["APPLICATION_YEAR_MISSING:1"] } });
      expect(await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } }))
        .toMatchObject({ state: "COPIED", verifiedAt: null });
    } else {
      expect(await outcome).toMatchObject({ error: { code: "NOT_READY" } });
    }
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");
    expect(await db.rosterMutation.count()).toBe(0);
  });

  it.each(["missing", "unsupported"])("READY rejects %s fingerprint proof format until explicitly reverified", async (format) => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    const after = await captureLegacyFingerprint(pgClient);
    await verifyBackfill(db, before, after);
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const manifest = JSON.parse(JSON.stringify(stamp.sourceManifest));
    if (format === "missing") {
      delete manifest.fingerprintFormat;
      delete manifest.fingerprintVersion;
    } else {
      manifest.fingerprintVersion = 1;
    }
    await db.academicBackfill.update({ where: { key: ACADEMIC_BACKFILL_KEY }, data: { sourceManifest: manifest } });

    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");
    expect(await db.rosterMutation.count()).toBe(0);
    expect((await verifyBackfill(db, before, after)).canEnable).toBe(true);
    await enableAcademicMode(db, MAIN);
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("READY");
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

  it("revokes a previous VERIFIED stamp when an explicit recheck fails", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    await db.systemSetting.update({ where: { key: "faceMatchThreshold" }, data: { value: "0.6" } });

    const result = await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    expect(result.canEnable).toBe(false);
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    expect(stamp.state).toBe("COPIED");
    expect(stamp.verifiedAt).toBeNull();
    expect(stamp.sourceManifest).toMatchObject({ issues: ["LEGACY_MODIFIED:SystemSetting"] });
    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("checks current record consistency before enabling even without another verification", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    const record = await db.userAcademicRecord.findFirstOrThrow();
    await db.userAcademicRecord.update({ where: { id: record.id }, data: { name: "불일치 합성 이름" } });

    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");
    expect(await db.rosterMutation.count()).toBe(0);
  });

  it("refuses READY if an application lost its year after verification", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    await db.mealApplication.updateMany({ data: { academicYear: null } });

    await expect(enableAcademicMode(db, MAIN)).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("does not freeze ordinary legacy writes between verification and READY", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    await db.systemSetting.update({ where: { key: "faceMatchThreshold" }, data: { value: "0.6" } });

    await expect(enableAcademicMode(db, MAIN)).resolves.toBeUndefined();
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

  it("rejects incomplete, duplicate and non-2026 survey approvals", () => {
    const valid = { applicationId: 3, academicYear: 2026, kind: "DATELESS_INTENT_SURVEY",
      expectedApprovedRegistrationCount: 1, expectedTotalRegistrationCount: 1, expectedSourceRowHash: "a".repeat(64) };
    expect(parseDateLessSurveyConfirmations([valid])).toEqual([valid]);
    for (const invalid of [[], [valid, valid], [{ ...valid, academicYear: 2027 }],
      [{ ...valid, kind: "ACTUAL_MEAL" }], [{ ...valid, expectedSourceRowHash: undefined }],
      [{ ...valid, expectedTotalRegistrationCount: -1 }], [{ ...valid, applicationId: 0 }]]) {
      expect(() => parseDateLessSurveyConfirmations(invalid)).toThrow();
    }
    expect(() => parseCliArgs([...applyArgs, "--survey-confirmations", "s.json"])).toThrow();
    expect(() => parseCliArgs(["--survey-confirmations", "s.json"], true)).toThrow();
    expect(parseCliArgs([...applyArgs, "--survey-confirmations", "s.json"], true).surveyConfirmationsPath).toBe("s.json");
  });

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
