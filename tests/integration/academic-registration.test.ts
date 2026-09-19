import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { getRegistrationContext } from "@/lib/academic-year/registration-context";
import { createDraftYear } from "@/lib/academic-year/roster-service";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const ACTIVE_YEAR = 2026;
const DRAFT_YEAR = 2027;
const OPEN_DATE = "2026-09-18";

describe("academic year registration", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;
  let student: Actor;

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
    const row = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    student = { kind: "USER", userId: row.id, sessionVersion: row.sessionVersion };
  });

  async function makeDraft(): Promise<void> {
    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    await createDraftYear(db, {
      actor: fx.main,
      requestId: "draft-for-meals",
      kind: "DRAFT",
      payloadHash: "draft-for-meals",
      expectedVersion: control.version,
      year: DRAFT_YEAR,
      sourceYear: ACTIVE_YEAR,
    });
  }

  /** 학생 신청 경로가 하는 일을 그대로: 공통 자격 검사 → 선택 계산 → 쓰기. */
  async function register(actor: Actor, userId: number, applicationId = fx.applicationId) {
    return withEligibilityMutation(
      db,
      actor,
      { scope: "REGISTRATION", applicationId, userId },
      async (tx) => {
        const context = await getRegistrationContext(tx, actor, applicationId, userId, "CREATE");
        const resolved = await resolveRegistrationSelections(
          applicationId,
          context.profile.grade ?? 0,
          [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: [OPEN_DATE] }],
          context.resolveContext,
        );
        if (!resolved.ok) throw new Error(resolved.error);
        return writeRegistration(tx, applicationId, userId, "서명", resolved.resolved);
      },
    );
  }

  it("초안 학년도 공고에는 신청할 수 없다", async () => {
    await makeDraft();
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: DRAFT_YEAR },
    });

    for (const intent of ["CREATE", "RESTORE"] as const) {
      await expect(
        getRegistrationContext(db, fx.main, fx.applicationId, fx.studentId, intent),
      ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
    }
  });

  it("CREATE·RESTORE 경로가 모두 같은 자격 검사를 쓴다", () => {
    const routes = [
      "src/app/api/applications/[id]/register/route.ts",
      "src/app/api/admin/applications/[id]/registrations/route.ts",
      "src/app/api/admin/applications/[id]/registrations/[regId]/route.ts",
      "src/app/api/admin/applications/[id]/import/route.ts",
    ];
    for (const route of routes) {
      expect(readFileSync(route, "utf8")).toContain("getRegistrationContext");
    }
  });

  it("학생은 다른 학생의 신청을 건드릴 수 없다", async () => {
    const other = await db.user.create({
      data: { email: "other@example.posan.kr", name: "다른학생", role: "STUDENT", grade: 1 },
    });
    await expect(
      getRegistrationContext(db, student, fx.applicationId, other.id, "CREATE"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("명부 전역 배타 잠금 중에도 학생 신청이 대기 없이 끝난다", async () => {
    await db.mealRegistration.deleteMany({ where: { id: fx.registrationId } });

    await pgClient.query("BEGIN");
    await pgClient.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');
    try {
      const startedAt = Date.now();
      const result = await register(student, fx.studentId);
      expect(result.created).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await pgClient.query("ROLLBACK");
    }
  });

  it("같은 공고에 대한 50건 병렬 신청이 모두 성공한다", async () => {
    const students = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        db.user.create({
          data: {
            email: `bulk-${i}@example.posan.kr`,
            name: `학생${i}`,
            role: "STUDENT",
            grade: 1,
            classNum: 9,
            number: i + 1,
          },
        }),
      ),
    );
    await db.userAcademicRecord.createMany({
      data: students.map((user) => ({
        year: ACTIVE_YEAR,
        userId: user.id,
        role: "STUDENT" as const,
        name: user.name,
        grade: 1,
        classNum: 9,
        number: user.number,
        memberState: "ENROLLED",
      })),
    });

    await db.eligibilityEvent.deleteMany({});
    const results = await Promise.all(
      students.map((user) =>
        register({ kind: "USER", userId: user.id, sessionVersion: user.sessionVersion }, user.id),
      ),
    );

    expect(results.every((r) => r.created)).toBe(true);
    expect(await db.eligibilityEvent.count({ where: { scope: "REGISTRATION" } })).toBe(50);
  });

  it("READY에서는 연도 기록이 없으면 현재 User.grade로 대체하지 않는다", async () => {
    await db.userAcademicRecord.deleteMany({ where: { userId: fx.studentId } });
    await expect(
      getRegistrationContext(db, student, fx.applicationId, fx.studentId, "CREATE"),
    ).rejects.toMatchObject({ code: "MISSING_PROFILE" });
  });

  it("PREPARING에서는 학년도 기록이 없어도 기존 신청 흐름이 그대로 동작한다", async () => {
    await db.mealRegistration.deleteMany({ where: { id: fx.registrationId } });
    await db.userAcademicRecord.deleteMany({});
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: null },
    });
    await db.rosterControl.update({ where: { id: 1 }, data: { mode: "PREPARING" } });

    const context = await getRegistrationContext(
      db,
      student,
      fx.applicationId,
      fx.studentId,
      "CREATE",
    );
    expect(context.year).toBe(ACTIVE_YEAR);
    expect(context.profile.grade).toBe(1);

    const result = await register(student, fx.studentId);
    expect(result.created).toBe(true);
  });

  it("졸업(이용 중지)한 학생의 지난 학년도 신청은 관리자가 그 해 Profile로 취소한다", async () => {
    await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED", version: 0 } });
    await db.mealApplication.update({
      where: { id: fx.applicationId },
      data: { academicYear: 2025 },
    });
    await db.userAcademicRecord.create({
      data: {
        year: 2025,
        userId: fx.studentId,
        role: "STUDENT",
        name: "학생테스트",
        grade: 3,
        classNum: 1,
        number: 1,
        memberState: "GRADUATED",
      },
    });
    await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });

    const context = await getRegistrationContext(
      db,
      fx.main,
      fx.applicationId,
      fx.studentId,
      "CANCEL",
    );
    expect(context.year).toBe(2025);
    expect(context.profile.grade).toBe(3);

    await expect(
      getRegistrationContext(db, fx.main, fx.applicationId, fx.studentId, "CREATE"),
    ).rejects.toMatchObject({ code: "YEAR_MISMATCH" });
  });
});
