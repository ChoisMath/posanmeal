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
  });
});
