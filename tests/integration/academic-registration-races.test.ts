import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const session = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: session.current }) }));
vi.mock("@/lib/prisma", async () => {
  const { openAcademicTestDb: open } = await import("./support/db");
  return { prisma: await open() };
});

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api", {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

const meals = [{ mealKind: "DINNER", applied: true, exempt: false, selectedDates: ["2026-09-18"] }];

describe("registration writes recheck state after the application lock", () => {
  let db: PrismaClient;
  let blocker: Client;
  let fx: AcademicFixture;
  let studentRoute: typeof import("@/app/api/applications/[id]/register/route");
  let adminRoute: typeof import("@/app/api/admin/applications/[id]/registrations/[regId]/route");

  beforeAll(async () => {
    db = await openAcademicTestDb();
    blocker = await openAcademicTestPgClient();
    studentRoute = await import("@/app/api/applications/[id]/register/route");
    adminRoute = await import("@/app/api/admin/applications/[id]/registrations/[regId]/route");
  });
  afterAll(async () => {
    await (await import("@/lib/prisma")).prisma.$disconnect();
    await blocker.end();
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, blocker);
    const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
    session.current = { dbUserId: student.id, role: student.role, sessionVersion: student.sessionVersion };
    await db.mealApplication.update({ where: { id: fx.applicationId }, data: {
      applyStartAt: new Date("2000-01-01Z"), applyEndAt: new Date("2099-01-01Z"),
    } });
  });

  const params = () => ({ params: Promise.resolve({ id: String(fx.applicationId), regId: String(fx.registrationId) }) });
  async function registrationState() {
    return {
      registration: await db.mealRegistration.findUnique({ where: { id: fx.registrationId }, include: { meals: true, mealDates: true } }),
      events: await db.eligibilityEvent.count(),
    };
  }

  async function whileWaiting(start: () => Promise<Response>, concurrentWrite: () => Promise<unknown>) {
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "MealApplication" WHERE id = $1 FOR UPDATE', [fx.applicationId]);
    const pending = start();
    try {
      await vi.waitFor(async () => {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await blocker.query<{ count: number }>(`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
        `);
        expect(waiting.rows[0].count).toBeGreaterThan(0);
      }, { timeout: 4000, interval: 20 });
      await concurrentWrite();
      await blocker.query("COMMIT");
      return await pending;
    } finally {
      await blocker.query("ROLLBACK");
      await pending;
    }
  }

  it.each(["POST", "DELETE"] as const)("학생 %s 대기 중 공고가 닫히면 신청과 확정일을 보존한다", async (method) => {
    const before = await registrationState();
    const response = await whileWaiting(
      () => studentRoute[method](request(method, method === "POST" ? { signature: "변경", meals } : undefined), params()),
      () => blocker.query('UPDATE "MealApplication" SET status = \'CLOSED\' WHERE id = $1', [fx.applicationId]),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: method === "POST" ? "신청 기간이 아닙니다." : "신청 취소 기간이 아닙니다." });
    expect(await registrationState()).toEqual(before);
  });

  it.each(["POST", "DELETE"] as const)("학생 %s 대기 중 접수 마감이 바뀌면 신청과 확정일을 보존한다", async (method) => {
    const before = await registrationState();
    const response = await whileWaiting(
      () => studentRoute[method](request(method, method === "POST" ? { signature: "변경", meals } : undefined), params()),
      () => blocker.query('UPDATE "MealApplication" SET "applyEndAt" = $1 WHERE id = $2', [new Date("2001-01-01Z"), fx.applicationId]),
    );
    expect(response.status).toBe(400);
    expect(await registrationState()).toEqual(before);
  });

  it.each(["ARCHIVED", "INACTIVE"] as const)("관리자 수정 대기 중 취소된 %s 신청을 복원하지 않는다", async (condition) => {
    const admin = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    session.current = { dbUserId: admin.id, role: admin.role, adminLevel: admin.adminLevel, sessionVersion: admin.sessionVersion };
    if (condition === "ARCHIVED") {
      await db.academicYear.create({ data: { year: 2025, state: "ARCHIVED" } });
      await db.userAcademicRecord.create({ data: {
        year: 2025, userId: fx.studentId, role: "STUDENT", name: "학생테스트", grade: 1, classNum: 1, number: 1,
        memberState: "ENROLLED",
      } });
      await db.mealApplication.update({ where: { id: fx.applicationId }, data: { academicYear: 2025 } });
    } else {
      await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });
    }
    const before = await registrationState();
    const response = await whileWaiting(
      () => adminRoute.PATCH(request("PATCH", { meals }), params()),
      () => blocker.query('UPDATE "MealRegistration" SET status = \'CANCELLED\' WHERE id = $1', [fx.registrationId]),
    );
    expect(response.status).toBe(condition === "ARCHIVED" ? 422 : 403);
    expect(await response.json()).toMatchObject({ error: { code: condition === "ARCHIVED" ? "YEAR_MISMATCH" : "ACCOUNT_INACTIVE" } });
    expect(await registrationState()).toEqual({ ...before, registration: { ...before.registration, status: "CANCELLED" } });
  });

  it.each(["PATCH", "DELETE"] as const)("다른 공고 경로의 %s는 신청을 수정하지 않는다", async (method) => {
    const admin = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
    session.current = { dbUserId: admin.id, role: admin.role, adminLevel: admin.adminLevel, sessionVersion: admin.sessionVersion };
    const before = await registrationState();
    const response = await adminRoute[method](request(method, method === "PATCH" ? { meals } : undefined), {
      params: Promise.resolve({ id: String(fx.applicationId + 100), regId: String(fx.registrationId) }),
    });
    expect(response.status).toBe(404);
    expect(await registrationState()).toEqual(before);
  });
});
