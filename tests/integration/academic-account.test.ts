import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import { assertActor } from "@/lib/academic-year/access";
import { changeAccess, changeEmail, changePermissions } from "@/lib/academic-year/account-service";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

describe("account access and mutations", () => {
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
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
  });

  async function rowVersion(userId: number): Promise<number> {
    return (await db.user.findUniqueOrThrow({ where: { id: userId } })).profileVersion;
  }

  it("kills the existing session and the face registration when access is withdrawn", async () => {
    const stale: Actor = { kind: "USER", userId: fx.teacherId, sessionVersion: 0 };
    const before = await captureLegacyFingerprint(pgClient);

    const receipt = await changeAccess(db, {
      actor: fx.main,
      requestId: "retire-1",
      expectedRowVersion: await rowVersion(fx.teacherId),
      kind: "ACCESS",
      payloadHash: "retire-hash",
      userId: fx.teacherId,
      state: "INACTIVE",
      reason: "RETIRED",
      confirmPrivileges: false,
    });

    expect(receipt.changed).toBe(1);
    await expect(assertActor(db, stale, "SIGNED_IN")).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });

    expect(await db.checkIn.count({ where: { userId: fx.teacherId } })).toBe(1);
    expect(await db.faceProfile.count({ where: { userId: fx.teacherId } })).toBe(0);
    expect(await db.faceProfile.count({ where: { userId: fx.studentId } })).toBe(1);

    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(student.photoUrl).toBe(`/api/uploads/${fx.studentId}.webp?t=1758153600000`);
    expect(await db.mealRegistration.count()).toBe(1);

    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    expect(teacher.accessState).toBe("INACTIVE");
    expect(teacher.sessionVersion).toBe(1);
    expect(await db.userAccessEvent.count({ where: { userId: fx.teacherId, state: "INACTIVE" } })).toBe(1);
    expect(await db.eligibilityEvent.count({ where: { userId: fx.teacherId, scope: "ACCOUNT" } })).toBe(1);

    // 이용 중단은 얼굴 등록과 계정 행만 건드린다. 체크인·신청·사진 경로는 그대로다.
    const diff = compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient));
    expect(diff.differingTables.sort()).toEqual(["FaceProfile", "User"]);
  });

  it("records no PII in the mutation log", async () => {
    await changeAccess(db, {
      actor: fx.main,
      requestId: "retire-2",
      expectedRowVersion: await rowVersion(fx.teacherId),
      kind: "ACCESS",
      payloadHash: "retire-hash",
      userId: fx.teacherId,
      state: "INACTIVE",
      reason: "RETIRED",
      confirmPrivileges: false,
    });

    const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId: "retire-2" } });
    expect(JSON.stringify(stored.result)).not.toContain("teacher-test@example.posan.kr");
    expect(JSON.stringify(stored.result)).not.toContain("교사테스트");
  });

  it("refuses a stale expectedRowVersion", async () => {
    await expect(
      changeAccess(db, {
        actor: fx.main,
        requestId: "retire-stale",
        expectedRowVersion: (await rowVersion(fx.teacherId)) + 5,
        kind: "ACCESS",
        payloadHash: "retire-hash",
        userId: fx.teacherId,
        state: "INACTIVE",
        reason: "RETIRED",
        confirmPrivileges: false,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("requires the main admin and an explicit confirmation to reactivate, and never restores the face", async () => {
    await changeAccess(db, {
      actor: fx.main,
      requestId: "retire-3",
      expectedRowVersion: await rowVersion(fx.teacherId),
      kind: "ACCESS",
      payloadHash: "retire-hash",
      userId: fx.teacherId,
      state: "INACTIVE",
      reason: "RETIRED",
      confirmPrivileges: false,
    });

    const base = {
      requestId: "revive-1",
      expectedRowVersion: await rowVersion(fx.teacherId),
      kind: "ACCESS",
      payloadHash: "revive-hash",
      userId: fx.teacherId,
      state: "ACTIVE" as const,
      reason: "REHIRED",
    };

    await expect(
      changeAccess(db, { ...base, actor: fx.main, confirmPrivileges: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await changeAccess(db, { ...base, actor: fx.main, confirmPrivileges: true });

    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    expect(teacher.accessState).toBe("ACTIVE");
    expect(await db.faceProfile.count({ where: { userId: fx.teacherId } })).toBe(0);
    expect(await db.userAccessEvent.count({ where: { userId: fx.teacherId, state: "ACTIVE" } })).toBe(2);
  });

  it("refuses reactivation by a teacher who is only an ADMIN-level user", async () => {
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    const teacherActor: Actor = { kind: "USER", userId: teacher.id, sessionVersion: teacher.sessionVersion };

    await expect(
      changeAccess(db, {
        actor: teacherActor,
        requestId: "revive-teacher",
        expectedRowVersion: (await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).profileVersion,
        kind: "ACCESS",
        payloadHash: "revive-hash",
        userId: fx.studentId,
        state: "ACTIVE",
        reason: "REHIRED",
        confirmPrivileges: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the main admin grant permissions but refuses a teacher with ADMIN level", async () => {
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    const teacherActor: Actor = { kind: "USER", userId: teacher.id, sessionVersion: teacher.sessionVersion };

    await expect(
      changePermissions(db, {
        actor: teacherActor,
        requestId: "grant-by-teacher",
        expectedRowVersion: await rowVersion(fx.teacherId),
        kind: "PERMISSIONS",
        payloadHash: "grant-hash",
        userId: fx.teacherId,
        level: "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.rosterMutation.count({ where: { requestId: "grant-by-teacher" } })).toBe(0);

    await changePermissions(db, {
      actor: fx.main,
      requestId: "revoke-by-main",
      expectedRowVersion: await rowVersion(fx.teacherId),
      kind: "PERMISSIONS",
      payloadHash: "revoke-hash",
      userId: fx.teacherId,
      level: "SUBADMIN",
    });

    const updated = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    expect(updated.adminLevel).toBe("SUBADMIN");
    expect(updated.sessionVersion).toBe(teacher.sessionVersion + 1);

    const revoked: Actor = { kind: "USER", userId: teacher.id, sessionVersion: teacher.sessionVersion };
    await expect(assertActor(db, revoked, "SIGNED_IN")).rejects.toMatchObject({ code: "STALE_SESSION" });
    await expect(
      assertActor(db, { kind: "USER", userId: teacher.id, sessionVersion: updated.sessionVersion }, "WRITE_ADMIN"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never gives a student admin rights", async () => {
    await expect(
      changePermissions(db, {
        actor: fx.main,
        requestId: "grant-student",
        expectedRowVersion: (await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).profileVersion,
        kind: "PERMISSIONS",
        payloadHash: "grant-hash",
        userId: fx.studentId,
        level: "SUBADMIN",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(student.adminLevel).toBe("NONE");
  });

  it("changes an email, its key and the roster entry, and invalidates the old session", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });

    const receipt = await changeEmail(db, {
      actor: fx.main,
      requestId: "email-1",
      expectedRowVersion: before.profileVersion,
      kind: "EMAIL",
      payloadHash: "email-hash",
      userId: fx.studentId,
      email: "  New.Student@Example.Posan.KR ",
    });

    const after = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(after.email).toBe("New.Student@Example.Posan.KR");
    expect(after.emailKey).toBe("new.student@example.posan.kr");
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(receipt.version).toBe(before.profileVersion + 1);
    expect(after.profileVersion).toBe(before.profileVersion + 1);

    const entry = await db.rosterEntry.findFirst({ where: { userId: fx.studentId } });
    expect(entry?.emailKey).toBe("new.student@example.posan.kr");

    await expect(
      assertActor(db, { kind: "USER", userId: fx.studentId, sessionVersion: before.sessionVersion }, "SIGNED_IN"),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
  });

  it("refuses an email that already belongs to somebody else", async () => {
    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });

    await expect(
      changeEmail(db, {
        actor: fx.main,
        requestId: "email-conflict",
        expectedRowVersion: student.profileVersion,
        kind: "EMAIL",
        payloadHash: "email-hash",
        userId: fx.studentId,
        email: teacher.email.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });

    const unchanged = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    expect(unchanged.email).toBe(student.email);
    expect(unchanged.sessionVersion).toBe(student.sessionVersion);
    expect(unchanged.profileVersion).toBe(student.profileVersion);
  });
});
