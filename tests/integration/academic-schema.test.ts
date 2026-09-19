import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ACADEMIC_TEST_SEED_YEAR, openAcademicTestDb, resetAcademicTestDb } from "./support/db";

async function makeUser(db: PrismaClient, suffix: string): Promise<number> {
  const user = await db.user.create({
    data: {
      email: `schema-${suffix}@example.posan.kr`,
      emailKey: `schema-${suffix}@example.posan.kr`,
      name: `학생${suffix}`,
      role: "STUDENT",
    },
  });
  return user.id;
}

describe("academic year schema constraints", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = await openAcademicTestDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
  });

  it("seeds the singleton control row and the active year", async () => {
    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    expect(control).toMatchObject({ id: 1, mode: "PREPARING", version: 0 });

    const year = await db.academicYear.findUniqueOrThrow({ where: { year: ACADEMIC_TEST_SEED_YEAR } });
    expect(year.state).toBe("ACTIVE");
  });

  it("rejects a second RosterControl row", async () => {
    await expect(db.rosterControl.create({ data: { id: 2 } })).rejects.toThrow();
  });

  it("allows only one ACTIVE academic year", async () => {
    await expect(
      db.academicYear.create({ data: { year: ACADEMIC_TEST_SEED_YEAR + 1, state: "ACTIVE" } }),
    ).rejects.toThrow();

    const draft = await db.academicYear.create({
      data: { year: ACADEMIC_TEST_SEED_YEAR + 1, state: "DRAFT" },
    });
    expect(draft.state).toBe("DRAFT");
  });

  it("rejects an unknown year state", async () => {
    await expect(
      db.academicYear.create({ data: { year: ACADEMIC_TEST_SEED_YEAR + 2, state: "OPEN" } }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate academic record for the same user and year", async () => {
    const userId = await makeUser(db, "dup");
    const data = {
      year: ACADEMIC_TEST_SEED_YEAR,
      userId,
      role: "STUDENT" as const,
      name: "학생중복",
      grade: 1,
      classNum: 1,
      number: 1,
      memberState: "ENROLLED",
    };

    await db.userAcademicRecord.create({ data });
    await expect(db.userAcademicRecord.create({ data })).rejects.toThrow();
  });

  it("rejects two enrolled students sharing one seat but allows a review row there", async () => {
    const first = await makeUser(db, "seat-a");
    const second = await makeUser(db, "seat-b");
    const third = await makeUser(db, "seat-c");
    const seat = { year: ACADEMIC_TEST_SEED_YEAR, grade: 2, classNum: 3, number: 7 };

    await db.userAcademicRecord.create({
      data: { ...seat, userId: first, role: "STUDENT", name: "자리주인", memberState: "ENROLLED" },
    });

    await expect(
      db.userAcademicRecord.create({
        data: { ...seat, userId: second, role: "STUDENT", name: "자리충돌", memberState: "ENROLLED" },
      }),
    ).rejects.toThrow();

    const review = await db.userAcademicRecord.create({
      data: {
        ...seat,
        userId: second,
        role: "STUDENT",
        name: "보완필요",
        memberState: "ENROLLED",
        needsReview: true,
      },
    });
    expect(review.needsReview).toBe(true);

    const graduated = await db.userAcademicRecord.create({
      data: { ...seat, userId: third, role: "STUDENT", name: "졸업생", memberState: "GRADUATED" },
    });
    expect(graduated.memberState).toBe("GRADUATED");
  });

  it("rejects a duplicate roster entry for the same year and email key", async () => {
    const data = { year: ACADEMIC_TEST_SEED_YEAR, emailKey: "entry@example.posan.kr" };
    await db.rosterEntry.create({ data });
    await expect(db.rosterEntry.create({ data })).rejects.toThrow();
  });

  it("rejects a duplicate roster entry for the same year and user", async () => {
    const userId = await makeUser(db, "entry");
    await db.rosterEntry.create({
      data: { year: ACADEMIC_TEST_SEED_YEAR, emailKey: "one@example.posan.kr", userId },
    });
    await expect(
      db.rosterEntry.create({
        data: { year: ACADEMIC_TEST_SEED_YEAR, emailKey: "two@example.posan.kr", userId },
      }),
    ).rejects.toThrow();
  });

  it("keeps User.emailKey unique and accessState constrained", async () => {
    await makeUser(db, "unique");
    await expect(
      db.user.create({
        data: {
          email: "other@example.posan.kr",
          emailKey: "schema-unique@example.posan.kr",
          name: "중복키",
          role: "STUDENT",
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.user.create({
        data: {
          email: "state@example.posan.kr",
          name: "잘못된상태",
          role: "STUDENT",
          accessState: "GONE",
        },
      }),
    ).rejects.toThrow();
  });

  it("restricts deleting a user that an academic record still references", async () => {
    const userId = await makeUser(db, "restrict");
    await db.userAcademicRecord.create({
      data: {
        year: ACADEMIC_TEST_SEED_YEAR,
        userId,
        role: "STUDENT",
        name: "보존대상",
        memberState: "ENROLLED",
      },
    });

    await expect(db.user.delete({ where: { id: userId } })).rejects.toThrow();
  });

  it("constrains the remaining string state columns", async () => {
    await expect(
      db.rosterImport.create({
        data: {
          year: ACADEMIC_TEST_SEED_YEAR,
          scope: "ALL",
          controlVersion: 0,
          yearVersion: 0,
          state: "PREVIEW",
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.localCheckInReview.create({
        data: { clientKey: "k1", payloadHash: "h1", reason: "UNKNOWN_USER", state: "MAYBE" },
      }),
    ).rejects.toThrow();

    await expect(
      db.eligibilityEvent.create({ data: { scope: "SOMETHING", occurredAt: new Date() } }),
    ).rejects.toThrow();

    await expect(
      db.academicBackfill.create({
        data: { key: "academic-year-2026", state: "STARTED", sourceManifest: {} },
      }),
    ).rejects.toThrow();
    const backfill = await db.academicBackfill.create({
      data: { key: "academic-year-2026", state: "PENDING", sourceManifest: {} },
    });
    expect(backfill.state).toBe("PENDING");
  });

  it("accepts the control modes PREPARING and READY only", async () => {
    const ready = await db.rosterControl.update({ where: { id: 1 }, data: { mode: "READY" } });
    expect(ready.mode).toBe("READY");

    await expect(db.rosterControl.update({ where: { id: 1 }, data: { mode: "OPEN" } })).rejects.toThrow();
  });

  it("accepts the access states ACTIVE and INACTIVE only", async () => {
    const userId = await makeUser(db, "access");
    const inactive = await db.user.update({ where: { id: userId }, data: { accessState: "INACTIVE" } });
    expect(inactive.accessState).toBe("INACTIVE");

    await expect(
      db.user.update({ where: { id: userId }, data: { accessState: "SUSPENDED" } }),
    ).rejects.toThrow();

    const event = await db.userAccessEvent.create({
      data: { userId, state: "INACTIVE", reason: "졸업", effectiveAt: new Date() },
    });
    expect(event.state).toBe("INACTIVE");

    await expect(
      db.userAccessEvent.create({
        data: { userId, state: "LEFT", reason: "잘못된값", effectiveAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("constrains roster decisions to the known vocabulary", async () => {
    const userId = await makeUser(db, "decision");
    await expect(
      db.rosterDecision.create({
        data: { year: ACADEMIC_TEST_SEED_YEAR, userId, decision: "KEEP", sourceVersion: 0 },
      }),
    ).rejects.toThrow();

    const decision = await db.rosterDecision.create({
      data: { year: ACADEMIC_TEST_SEED_YEAR, userId, decision: "RESTORE", sourceVersion: 0 },
    });
    expect(decision.decision).toBe("RESTORE");
  });

  it("rejects a member state that does not belong to the role", async () => {
    const studentId = await makeUser(db, "role-a");
    const teacherId = await makeUser(db, "role-b");

    await expect(
      db.userAcademicRecord.create({
        data: {
          year: ACADEMIC_TEST_SEED_YEAR,
          userId: studentId,
          role: "STUDENT",
          name: "퇴직학생",
          memberState: "RETIRED",
        },
      }),
    ).rejects.toThrow();

    // 교사 TRANSFERRED(전출)는 허용된다.
    const transferred = await db.userAcademicRecord.create({
      data: {
        year: ACADEMIC_TEST_SEED_YEAR,
        userId: teacherId,
        role: "TEACHER",
        name: "전출교사",
        memberState: "TRANSFERRED",
      },
    });
    expect(transferred.memberState).toBe("TRANSFERRED");
  });
});
