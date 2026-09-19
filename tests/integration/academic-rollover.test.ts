import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import { changeEmail } from "@/lib/academic-year/account-service";
import {
  createDraftYear,
  listRosterView,
  upsertRosterProfile,
} from "@/lib/academic-year/roster-service";
import {
  activateAcademicYear,
  reviewRollover,
  saveRolloverDecision,
  type RolloverReview,
} from "@/lib/academic-year/rollover-service";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const { failDeactivation } = vi.hoisted(() => ({ failDeactivation: { on: false } }));

vi.mock("@/lib/academic-year/account-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/academic-year/account-service")>();
  return {
    ...actual,
    deactivateUsers: async (...args: Parameters<typeof actual.deactivateUsers>) => {
      if (failDeactivation.on) throw new Error("forced mid-transaction failure");
      return actual.deactivateUsers(...args);
    },
  };
});

/** 확정 식사일이 모두 "오늘 이후"가 되도록 고정한다. 실제 오늘에 의존하지 않는다. */
const TODAY = "2026-09-18";
const SOURCE_YEAR = 2026;
const TARGET_YEAR = 2027;

describe("academic year rollover", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });

  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
  });

  beforeEach(async () => {
    failDeactivation.on = false;
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
  });

  async function controlVersion(): Promise<number> {
    return (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;
  }

  async function makeDraft(requestId = "draft-1"): Promise<void> {
    await createDraftYear(db, {
      actor: fx.main,
      requestId,
      kind: "DRAFT",
      payloadHash: requestId,
      expectedVersion: await controlVersion(),
      year: TARGET_YEAR,
      sourceYear: SOURCE_YEAR,
    });
  }

  function review(actor: Actor = fx.main): Promise<RolloverReview> {
    return reviewRollover(db, actor, TARGET_YEAR, { today: TODAY });
  }

  async function decide(
    userId: number,
    decision: "GRADUATED" | "TRANSFERRED" | "RETIRED" | "RESTORE",
    requestId = `decide-${userId}-${decision}`,
  ) {
    return saveRolloverDecision(db, {
      actor: fx.main,
      requestId,
      kind: "DECISION",
      payloadHash: requestId,
      expectedVersion: await controlVersion(),
      year: TARGET_YEAR,
      userId,
      decision,
    });
  }

  function activate(
    current: RolloverReview,
    overrides: Partial<{
      requestId: string;
      actor: Actor;
      kiosksPaused: boolean;
      warningsAcknowledged: boolean;
      expectedVersion: number;
      yearVersion: number;
      sourceVersion: number;
    }> = {},
  ) {
    const requestId = overrides.requestId ?? "rollover-1";
    return activateAcademicYear(db, {
      actor: overrides.actor ?? fx.main,
      requestId,
      kind: "ACTIVATE",
      payloadHash: "rollover-hash",
      expectedVersion: overrides.expectedVersion ?? current.version,
      year: TARGET_YEAR,
      yearVersion: overrides.yearVersion ?? current.yearVersion,
      sourceVersion: overrides.sourceVersion ?? current.sourceVersion,
      kiosksPaused: overrides.kiosksPaused ?? true,
      warningsAcknowledged: overrides.warningsAcknowledged ?? true,
      today: TODAY,
    });
  }

  async function excludeStudent(): Promise<void> {
    await db.rosterEntry.updateMany({
      where: { year: TARGET_YEAR, userId: fx.studentId },
      data: { included: false },
    });
  }

  /** Task 5의 실제 편집 경로. 그 학년도 version을 올리는 것이 검토 무효화의 근거다. */
  async function editRoster(
    year: number,
    requestId: string,
    overrides: { name?: string; email?: string } = {},
  ): Promise<void> {
    const rows = await listRosterView(db, year, undefined, { includeExcluded: true });
    const row = rows.find((candidate) => candidate.userId === fx.studentId);
    if (!row) throw new Error(`no roster row for the student in ${year}`);

    await upsertRosterProfile(db, {
      actor: fx.main,
      requestId,
      kind: "ROSTER_ROW",
      payloadHash: requestId,
      expectedRowVersion: row.version,
      year,
      userId: fx.studentId,
      entryId: row.entryId.length > 0 ? row.entryId : undefined,
      email: overrides.email ?? row.email,
      profile: { ...row.profile, name: overrides.name ?? row.profile.name },
    });
  }

  async function activeYearNumber(): Promise<number> {
    return (await db.academicYear.findFirstOrThrow({ where: { state: "ACTIVE" } })).year;
  }

  // -------------------------------------------------------------------------
  // Step 1 — 누락 미확인 전환 차단
  // -------------------------------------------------------------------------

  it("blocks activation while a missing person has no decision", async () => {
    await db.userAcademicRecord.update({
      where: { year_userId: { year: SOURCE_YEAR, userId: fx.studentId } },
      data: { grade: 3 },
    });
    await makeDraft("draft-review");
    await excludeStudent();

    const current = await review();
    expect(current.canActivate).toBe(false);
    expect(current.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: fx.studentId, suggested: "GRADUATED" }),
      ]),
    );
    expect(current.issues.some((issue) => issue.startsWith("MISSING_DECISION"))).toBe(true);

    await expect(activate(current)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
    expect(await db.rosterMutation.count({ where: { requestId: "rollover-1" } })).toBe(0);
  });

  it("counts the copied draft's unchanged grades and refuses unacknowledged warnings", async () => {
    await makeDraft();
    const current = await review();

    expect(current.warnings.studentsWithSameGrade).toBe(1);
    expect(current.warnings.remainingMealDatesInSourceYear).toBe(2);
    expect(current.warnings.futureMealDatesOfLeavers).toBe(0);
    expect(current.canActivate).toBe(true);

    await expect(activate(current, { warningsAcknowledged: false })).rejects.toMatchObject({
      code: "REVIEW_REQUIRED",
    });
    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
  });

  it("counts a leaver's future confirmed meal dates and leaves those rows untouched", async () => {
    await makeDraft();
    await excludeStudent();
    await decide(fx.studentId, "GRADUATED");

    const current = await review();
    expect(current.warnings.futureMealDatesOfLeavers).toBe(2);
    expect(current.canActivate).toBe(true);

    const before = await captureLegacyFingerprint(pgClient);
    await activate(current);

    expect(await activeYearNumber()).toBe(TARGET_YEAR);
    expect(await db.mealRegistrationMealDate.count()).toBe(2);

    const diff = compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient));
    expect(diff.differingTables).toEqual(["FaceProfile", "User"]);
  });

  it("deletes only the leaver's face profile and keeps the continuing student's id and face", async () => {
    await makeDraft();
    await db.rosterEntry.updateMany({
      where: { year: TARGET_YEAR, userId: fx.teacherId },
      data: { included: false },
    });
    await decide(fx.teacherId, "RETIRED");

    await activate(await review());

    expect(await db.faceProfile.count({ where: { userId: fx.teacherId } })).toBe(0);
    expect(await db.faceProfile.count({ where: { userId: fx.studentId } })).toBe(1);

    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(student.accessState).toBe("ACTIVE");
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    expect(teacher.accessState).toBe("INACTIVE");
    // adminLevel은 전환이 손대지 않는다.
    expect(teacher.adminLevel).toBe("ADMIN");

    const sourceRecord = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: SOURCE_YEAR, userId: fx.teacherId } },
    });
    expect(sourceRecord.memberState).toBe("RETIRED");
    expect(await db.rosterEntry.count({ where: { year: TARGET_YEAR, userId: fx.teacherId } })).toBe(0);
    expect(await db.eligibilityEvent.count({ where: { scope: "ROLLOVER" } })).toBe(1);
  });

  it("keeps the teacher's admin level and the student's id through a plain rollover", async () => {
    await makeDraft();
    await activate(await review());

    expect(await activeYearNumber()).toBe(TARGET_YEAR);
    expect((await db.academicYear.findUniqueOrThrow({ where: { year: SOURCE_YEAR } })).state).toBe(
      "ARCHIVED",
    );

    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    expect(teacher.adminLevel).toBe("ADMIN");
    expect(await db.userAcademicRecord.count({ where: { year: TARGET_YEAR } })).toBe(2);

    const entry = await db.rosterEntry.findFirstOrThrow({
      where: { year: TARGET_YEAR, userId: fx.studentId },
    });
    expect(entry.draftProfile).toBeNull();
    expect(entry.draftEmail).toBeNull();
    expect(await db.checkIn.count()).toBe(2);
  });

  it("creates the account of a brand new person only at activation", async () => {
    await makeDraft();
    await db.rosterEntry.create({
      data: {
        id: "new-person-entry",
        year: TARGET_YEAR,
        emailKey: "new.student@example.posan.kr",
        draftEmail: "new.student@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "신입생",
          grade: 2,
          classNum: 4,
          number: 7,
          gender: "FEMALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });

    expect(await db.user.count({ where: { emailKey: "new.student@example.posan.kr" } })).toBe(0);
    await activate(await review());

    const created = await db.user.findUniqueOrThrow({
      where: { emailKey: "new.student@example.posan.kr" },
    });
    expect(created.accessState).toBe("ACTIVE");
    expect(created.grade).toBe(2);
    expect(
      await db.userAccessEvent.count({ where: { userId: created.id, state: "ACTIVE" } }),
    ).toBe(1);

    const entry = await db.rosterEntry.findUniqueOrThrow({ where: { id: "new-person-entry" } });
    expect(entry.userId).toBe(created.id);
    expect(entry.draftProfile).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 차단 사유
  // -------------------------------------------------------------------------

  it("blocks an incomplete included draft row", async () => {
    await makeDraft();
    await db.rosterEntry.updateMany({
      where: { year: TARGET_YEAR, userId: fx.studentId },
      data: {
        draftProfile: {
          role: "STUDENT",
          name: "학생테스트",
          grade: 1,
          classNum: 1,
          number: null,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
      },
    });

    const current = await review();
    expect(current.issues).toContain("INCOMPLETE_ROWS:1");
    await expect(activate(current)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });

  it("blocks two included draft rows sharing a seat", async () => {
    await makeDraft();
    await db.rosterEntry.create({
      data: {
        id: "seat-clash",
        year: TARGET_YEAR,
        emailKey: "clash@example.posan.kr",
        draftEmail: "clash@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "좌석충돌",
          grade: 1,
          classNum: 1,
          number: 1,
          gender: "FEMALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });

    expect((await review()).issues).toContain("DUPLICATE_SEAT:1");
  });

  it("blocks two included draft rows whose emails normalize to the same address", async () => {
    await makeDraft();
    await db.rosterEntry.create({
      data: {
        id: "email-clash",
        year: TARGET_YEAR,
        emailKey: "STUDENT-TEST@Example.Posan.KR",
        draftEmail: "STUDENT-TEST@Example.Posan.KR",
        draftProfile: {
          role: "STUDENT",
          name: "이메일충돌",
          grade: 2,
          classNum: 2,
          number: 2,
          gender: "FEMALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });

    expect((await review()).issues).toContain("DUPLICATE_EMAIL:1");
  });

  it("blocks a draft row whose email belongs to an account of the other role", async () => {
    await makeDraft();
    await db.rosterEntry.updateMany({
      where: { year: TARGET_YEAR, userId: fx.teacherId },
      data: {
        draftProfile: {
          role: "STUDENT",
          name: "교사테스트",
          grade: 1,
          classNum: 2,
          number: 3,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
      },
    });

    expect((await review()).issues).toContain("ROLE_MISMATCH:1");
  });

  it("blocks a draft row linked to an account whose access was withdrawn", async () => {
    await makeDraft();
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });

    const current = await review();
    expect(current.issues).toContain("INACTIVE_ACCOUNT:1");
    await expect(activate(current)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });

  // -------------------------------------------------------------------------
  // 결정
  // -------------------------------------------------------------------------

  it("restores an excluded person and clears the blocker", async () => {
    await makeDraft();
    await excludeStudent();
    expect((await review()).canActivate).toBe(false);

    await decide(fx.studentId, "RESTORE");

    const entry = await db.rosterEntry.findFirstOrThrow({
      where: { year: TARGET_YEAR, userId: fx.studentId },
    });
    expect(entry.included).toBe(true);

    const current = await review();
    expect(current.missing).toEqual([]);
    expect(current.canActivate).toBe(true);
  });

  it("refuses a student retirement and a teacher graduation", async () => {
    await makeDraft();
    await excludeStudent();

    await expect(decide(fx.studentId, "RETIRED")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(decide(fx.teacherId, "GRADUATED")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  // -------------------------------------------------------------------------
  // 검토 무효화와 권한
  // -------------------------------------------------------------------------

  it("invalidates the review after a later draft edit, decision or source-year change", async () => {
    await makeDraft();
    const first = await review();

    await editRoster(TARGET_YEAR, "edit-draft", { name: "학생초안수정" });
    await expect(activate(first, { requestId: "stale-draft" })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });

    const second = await review();
    await editRoster(SOURCE_YEAR, "edit-source", { name: "학생원본수정" });
    await expect(activate(second, { requestId: "stale-source" })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });

    const third = await review();
    await excludeStudent();
    await decide(fx.studentId, "RESTORE");
    await expect(activate(third, { requestId: "stale-decision" })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });

    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
  });

  it("refuses a write admin, an unpaused kiosk fleet and a roster that is still PREPARING", async () => {
    await makeDraft();
    const current = await review();

    await expect(activate(current, { actor: fx.writer, requestId: "by-writer" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(activate(current, { kiosksPaused: false, requestId: "kiosk" })).rejects.toMatchObject(
      { code: "REVIEW_REQUIRED" },
    );

    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });
    await expect(review()).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(activate(current, { requestId: "preparing" })).rejects.toMatchObject({
      code: "NOT_READY",
    });
    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
  });

  it("lets exactly one of two concurrent activations win and replays the same receipt", async () => {
    await makeDraft();
    const current = await review();

    const results = await Promise.allSettled([
      activate(current, { requestId: "race-a" }),
      activate(current, { requestId: "race-b" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await activeYearNumber()).toBe(TARGET_YEAR);

    const winner = (fulfilled[0] as PromiseFulfilledResult<{ requestId: string; version: number }>)
      .value;
    const replay = await activate(current, { requestId: winner.requestId });
    expect(replay).toEqual(winner);
  });

  // -------------------------------------------------------------------------
  // 실패 = 아무것도 바뀌지 않음
  // -------------------------------------------------------------------------

  it("leaves everything exactly as it was when the transaction fails midway", async () => {
    await makeDraft();
    await excludeStudent();
    await decide(fx.studentId, "GRADUATED");
    const current = await review();

    const before = await captureLegacyFingerprint(pgClient);
    const entriesBefore = await db.rosterEntry.count();
    const recordsBefore = await db.userAcademicRecord.count();

    failDeactivation.on = true;
    await expect(activate(current, { requestId: "doomed" })).rejects.toThrow(
      "forced mid-transaction failure",
    );
    failDeactivation.on = false;

    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)).equal).toBe(
      true,
    );
    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
    expect(await db.rosterEntry.count()).toBe(entriesBefore);
    expect(await db.userAcademicRecord.count()).toBe(recordsBefore);
    expect(await db.rosterMutation.count({ where: { requestId: "doomed" } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 규모
  // -------------------------------------------------------------------------

  it("rolls a thousand people over inside the transaction budget", async () => {
    const people = 1000;
    const rows = Array.from({ length: people }, (_, i) => ({
      email: `bulk-${i}@example.posan.kr`,
      name: `대량${i}`,
      grade: (i % 3) + 1,
      classNum: Math.floor(i / 40) + 10,
      number: (i % 40) + 1,
    }));

    await db.user.createMany({
      data: rows.map((row) => ({
        email: row.email,
        emailKey: row.email,
        name: row.name,
        role: "STUDENT" as const,
        grade: row.grade,
        classNum: row.classNum,
        number: row.number,
        gender: "MALE" as const,
      })),
    });
    const bulk = await db.user.findMany({
      where: { emailKey: { startsWith: "bulk-" } },
      select: { id: true, emailKey: true, grade: true, classNum: true, number: true, name: true },
    });
    await db.userAcademicRecord.createMany({
      data: bulk.map((user) => ({
        year: SOURCE_YEAR,
        userId: user.id,
        role: "STUDENT" as const,
        name: user.name,
        grade: user.grade,
        classNum: user.classNum,
        number: user.number,
        gender: "MALE" as const,
        memberState: "ENROLLED",
      })),
    });
    await db.rosterEntry.createMany({
      data: bulk.map((user) => ({
        year: SOURCE_YEAR,
        userId: user.id,
        emailKey: user.emailKey as string,
        included: true,
      })),
    });

    await makeDraft();
    const current = await review();
    expect(current.canActivate).toBe(true);

    const startedAt = Date.now();
    await activate(current);
    const elapsedMs = Date.now() - startedAt;

    console.info(`[rollover] ${people + 2}명 전환 ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(60_000);
    expect(await activeYearNumber()).toBe(TARGET_YEAR);
    expect(await db.userAcademicRecord.count({ where: { year: TARGET_YEAR } })).toBe(people + 2);
  }, 180_000);

  // -------------------------------------------------------------------------
  // 이메일은 전환이 건드리지 않는다 (fix round 1)
  // -------------------------------------------------------------------------

  it("never reverts an email changed after the draft was copied", async () => {
    await makeDraft();
    await changeEmail(db, {
      actor: fx.main,
      requestId: "email-moved",
      expectedRowVersion: (await db.user.findUniqueOrThrow({ where: { id: fx.studentId } }))
        .profileVersion,
      kind: "EMAIL",
      payloadHash: "email-moved-hash",
      userId: fx.studentId,
      email: "moved.student@example.posan.kr",
    });

    const stale = await review();
    expect(stale.issues).toContain("STALE_ACCOUNT:1");
    expect(stale.canActivate).toBe(false);
    await expect(activate(stale)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });

    // 관리자가 그 행을 다시 저장하면 baseUserVersion이 현재 계정 값으로 다시 찍힌다.
    await editRoster(TARGET_YEAR, "re-save", { email: "moved.student@example.posan.kr" });

    const current = await review();
    expect(current.issues).toEqual([]);
    await activate(current, { requestId: "rollover-after-email" });

    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(student.email).toBe("moved.student@example.posan.kr");
    expect(student.emailKey).toBe("moved.student@example.posan.kr");
  });

  it("links a returning person's draft row to the account that already owns the email", async () => {
    await db.userAcademicRecord.update({
      where: { year_userId: { year: SOURCE_YEAR, userId: fx.studentId } },
      data: { memberState: "TRANSFERRED" },
    });
    await makeDraft();
    await db.rosterEntry.deleteMany({ where: { year: TARGET_YEAR, userId: fx.studentId } });
    await db.rosterEntry.create({
      data: {
        id: "returning-entry",
        year: TARGET_YEAR,
        emailKey: "student-test@example.posan.kr",
        draftEmail: "student-test@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "학생테스트",
          grade: 2,
          classNum: 3,
          number: 4,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });

    const current = await review();
    expect(current.issues).toEqual([]);
    await activate(current);

    const entry = await db.rosterEntry.findUniqueOrThrow({ where: { id: "returning-entry" } });
    expect(entry.userId).toBe(fx.studentId);
    expect(await db.user.count({ where: { emailKey: "student-test@example.posan.kr" } })).toBe(1);

    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: TARGET_YEAR, userId: fx.studentId } },
    });
    expect(record.grade).toBe(2);
    expect(await db.faceProfile.count({ where: { userId: fx.studentId } })).toBe(1);
  });

  it("blocks a userId-less draft row whose email belongs to the other role or an inactive account", async () => {
    await makeDraft();
    await db.rosterEntry.deleteMany({ where: { year: TARGET_YEAR, userId: fx.teacherId } });
    await db.rosterEntry.create({
      data: {
        id: "other-role-entry",
        year: TARGET_YEAR,
        emailKey: "teacher-test@example.posan.kr",
        draftEmail: "teacher-test@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "교사테스트",
          grade: 1,
          classNum: 5,
          number: 6,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });
    expect((await review()).issues).toContain("ROLE_MISMATCH:1");

    await db.user.update({ where: { id: fx.teacherId }, data: { accessState: "INACTIVE" } });
    await db.rosterEntry.update({
      where: { id: "other-role-entry" },
      data: {
        draftProfile: {
          role: "TEACHER",
          name: "교사테스트",
          grade: null,
          classNum: null,
          number: null,
          gender: null,
          subject: null,
          homeroom: "1-1",
          position: null,
        },
      },
    });
    expect((await review()).issues).toContain("INACTIVE_ACCOUNT:1");
  });

  it("links rather than duplicates when the email is claimed after the review", async () => {
    await makeDraft();
    await db.rosterEntry.create({
      data: {
        id: "racer-entry",
        year: TARGET_YEAR,
        emailKey: "racer@example.posan.kr",
        draftEmail: "racer@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "경합학생",
          grade: 3,
          classNum: 9,
          number: 9,
          gender: "FEMALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });
    const reviewed = await review();
    expect(reviewed.canActivate).toBe(true);

    // 검토 뒤 다른 경로가 그 주소로 계정을 만든다. 전환은 트랜잭션 안에서 다시 보고
    // 계정을 또 만드는 대신 그 계정에 잇는다.
    const claimed = await db.user.create({
      data: {
        email: "racer@example.posan.kr",
        emailKey: "racer@example.posan.kr",
        name: "먼저등록",
        role: "STUDENT",
        grade: 3,
        classNum: 9,
        number: 8,
        gender: "FEMALE",
      },
    });

    await activate(reviewed);
    expect(await db.user.count({ where: { emailKey: "racer@example.posan.kr" } })).toBe(1);
    expect((await db.rosterEntry.findUniqueOrThrow({ where: { id: "racer-entry" } })).userId).toBe(
      claimed.id,
    );
  });

  it("turns a residual email collision into an identity conflict, never a raw error", async () => {
    await makeDraft();
    await db.user.create({
      data: {
        email: "Held@Example.Posan.KR",
        // 정규화되지 않은 채 저장된 키. 대조는 정규화한 주소로 계정을 찾으므로 이 행을
        // 못 보고 지나가지만, INSERT는 초안 항목의 키를 그대로 써서 unique에 걸린다.
        emailKey: "Held@Example.Posan.KR",
        name: "보유자",
        role: "STUDENT",
        grade: 3,
        classNum: 7,
        number: 7,
        gender: "MALE",
      },
    });
    await db.rosterEntry.create({
      data: {
        id: "collision-entry",
        year: TARGET_YEAR,
        emailKey: "Held@Example.Posan.KR",
        draftEmail: "fresh@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "충돌학생",
          grade: 3,
          classNum: 7,
          number: 6,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: true,
      },
    });

    await expect(activate(await review())).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });
    expect(await activeYearNumber()).toBe(SOURCE_YEAR);
  });

  it("clears an excluded candidate that never became an account and frees its email slot", async () => {
    await makeDraft();
    await db.rosterEntry.create({
      data: {
        id: "abandoned-entry",
        year: TARGET_YEAR,
        emailKey: "abandoned@example.posan.kr",
        draftEmail: "abandoned@example.posan.kr",
        draftProfile: {
          role: "STUDENT",
          name: "취소학생",
          grade: 2,
          classNum: 8,
          number: 8,
          gender: "MALE",
          subject: null,
          homeroom: null,
          position: null,
        },
        included: false,
      },
    });

    await activate(await review());
    expect(await db.rosterEntry.count({ where: { id: "abandoned-entry" } })).toBe(0);

    // 자리가 풀렸으므로 같은 주소를 이제 ACTIVE가 된 학년도에 다시 넣을 수 있다.
    await db.rosterEntry.create({
      data: {
        year: TARGET_YEAR,
        emailKey: "abandoned@example.posan.kr",
        included: true,
      },
    });
  });

  it("ignores a confirmed meal date whose meal was never applied for", async () => {
    await db.mealRegistrationMeal.updateMany({
      where: { registrationId: fx.registrationId },
      data: { applied: false },
    });
    await makeDraft();

    const current = await review();
    expect(current.warnings.remainingMealDatesInSourceYear).toBe(0);
  });

  it("records no personal data in the activation receipt", async () => {
    await makeDraft();
    await activate(await review());

    const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId: "rollover-1" } });
    const text = JSON.stringify(stored.result);
    expect(text).not.toContain("student-test@example.posan.kr");
    expect(text).not.toContain("학생테스트");
  });
});
