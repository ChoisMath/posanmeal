import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { changeAccess } from "@/lib/academic-year/account-service";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import { issueKioskSnapshot } from "@/lib/academic-year/kiosk-snapshot";
import { processUploadedCheckIn, resolveCheckInReview, type UploadedCheckIn } from "@/lib/academic-year/upload-review";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => Reflect.get(holder.db, key) }),
}));

const ISSUED_AT = new Date("2026-09-19T00:00:00.000Z");
const MEAL_DATE = new Date("2026-09-19T00:00:00.000Z");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type QueryHook = (path: string, phase: "before" | "after", result?: unknown) => Promise<void>;

// 실제 SQL은 그대로 실행하고 선택한 경계에서만 멈춰 요청 순서를 재현한다.
function instrument(client: PrismaClient, hook: QueryHook): PrismaClient {
  const wrap = (target: object): object => new Proxy(target, {
    get(current, key) {
      const value = Reflect.get(current, key);
      if (key === "$transaction") {
        return async (run: (tx: object) => Promise<unknown>, options?: unknown) => {
          await hook("$transaction", "before");
          return Reflect.apply(value, current, [(tx: object) => run(wrap(tx)), options]);
        };
      }
      if (typeof value === "function") return value.bind(current);
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, {
        get(delegate, method) {
          const operation = Reflect.get(delegate, method);
          if (typeof operation !== "function") return operation;
          return async (...args: unknown[]) => {
            const path = `${String(key)}.${String(method)}`;
            await hook(path, "before");
            const result = await Reflect.apply(operation, delegate, args);
            await hook(path, "after", result);
            return result;
          };
        },
      });
    },
  });
  return wrap(client) as PrismaClient;
}

function studentItem(fx: AcademicFixture, snapshotId: string): UploadedCheckIn {
  return {
    deviceId: "kiosk-race", clientId: 1, userId: fx.studentId, date: "2026-09-19",
    mealKind: "DINNER", type: "STUDENT", checkedAt: "2026-09-19T09:00:00.000Z", snapshotId,
  };
}

describe("키오스크 원본과 발급 자료의 동시성", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
  });
  afterAll(async () => {
    await db.$disconnect();
    await pgClient.end();
  });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);
    holder.db = db;
  });
  afterEach(() => vi.useRealTimers());

  it("같은 기기 기록 번호의 다른 원본이 먼저 반영되면 늦은 요청은 별도 검토로 보존한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = studentItem(fx, snapshot.id);
    const entered = deferred();
    const release = deferred();
    let paused = false;
    const delayed = instrument(db, async (path, phase) => {
      if (path === "$transaction" && phase === "before" && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    });

    const late = processUploadedCheckIn(delayed, fx.main, item);
    await entered.promise;
    const other = { ...item, userId: fx.teacherId, type: "WORK" };
    try {
      expect(await processUploadedCheckIn(db, fx.main, other)).toMatchObject({ status: "ACCEPTED", final: true });
    } finally {
      release.resolve();
    }
    const result = await late;
    expect(result).toMatchObject({ status: "REVIEW", final: false });
    expect(await db.checkIn.count({ where: { date: MEAL_DATE } })).toBe(1);
    const reviews = await db.localCheckInReview.findMany({ orderBy: { createdAt: "asc" } });
    expect(reviews).toHaveLength(2);
    expect(reviews.find((review) => review.state === "PENDING")?.payload).toEqual(item);
    expect(reviews.find((review) => review.state === "ACCEPTED")?.payload).toEqual(other);
  });

  it("같은 원본을 동시에 재송신해도 체크인과 증거는 하나다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = studentItem(fx, snapshot.id);
    const results = await Promise.all([
      processUploadedCheckIn(db, fx.main, item),
      processUploadedCheckIn(db, fx.main, item),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["ACCEPTED", "DUPLICATE"]);
    expect(results.every((result) => result.final)).toBe(true);
    expect(await db.checkIn.count({ where: { date: MEAL_DATE } })).toBe(1);
    expect(await db.localCheckInReview.count()).toBe(1);
  });

  it("transaction 진입 전 권한이 회수되면 원본 선점이나 체크인을 쓰지 않는다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const entered = deferred();
    const release = deferred();
    const delayed = instrument(db, async (path, phase) => {
      if (path === "$transaction" && phase === "before") {
        entered.resolve();
        await release.promise;
      }
    });
    const pending = processUploadedCheckIn(delayed, fx.writer, studentItem(fx, snapshot.id));
    await entered.promise;
    try {
      await db.user.update({
        where: { id: fx.teacherId }, data: { adminLevel: "NONE", sessionVersion: { increment: 1 } },
      });
    } finally {
      release.resolve();
    }
    await expect(pending).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(await db.localCheckInReview.count()).toBe(0);
    expect(await db.checkIn.count({ where: { date: MEAL_DATE } })).toBe(0);
  });

  it.each([false, true])("다른 clientKey의 자연키 경쟁에서도 모든 원본을 남긴다 (다른 시각=%s)", async (differentTime) => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = studentItem(fx, snapshot.id);
    const release = deferred();
    let readers = 0;
    const racing = instrument(db, async (path, phase, result) => {
      if (path === "checkIn.findFirst" && phase === "after" && result === null) {
        readers++;
        if (readers === 2) release.resolve();
        await release.promise;
      }
    });
    const other = { ...item, clientId: 2, checkedAt: differentTime ? "2026-09-19T09:01:00.000Z" : item.checkedAt };
    const results = await Promise.all([
      processUploadedCheckIn(racing, fx.main, item),
      processUploadedCheckIn(racing, fx.main, other),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["ACCEPTED", differentTime ? "REVIEW" : "DUPLICATE"]);
    expect(await db.checkIn.count({ where: { date: MEAL_DATE } })).toBe(1);
    expect(await db.localCheckInReview.count()).toBe(2);
    const payloads = (await db.localCheckInReview.findMany()).map((row) => row.payload);
    expect(payloads).toEqual(expect.arrayContaining([item, other]));
  });

  it("충돌 원본의 동시 재전송은 같은 검토 한 건이며 관리자가 종결한 상태를 다시 돌려준다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const original = studentItem(fx, snapshot.id);
    await processUploadedCheckIn(db, fx.main, original);
    const conflict = { ...original, checkedAt: "2026-09-19T09:01:00.000Z" };
    const [a, b] = await Promise.all([
      processUploadedCheckIn(db, fx.main, conflict),
      processUploadedCheckIn(db, fx.main, conflict),
    ]);
    expect(a).toMatchObject({ status: "REVIEW", final: false });
    expect(b).toMatchObject({ status: "REVIEW", final: false, reviewId: a.reviewId });
    expect(await db.localCheckInReview.count()).toBe(2);
    await resolveCheckInReview(db, {
      actor: fx.main, requestId: "resolve-conflict", expectedVersion: 0, kind: "REVIEW", payloadHash: "resolve-conflict",
      reviewId: a.reviewId!, decision: "REJECT", reason: "별도 원본 확인 후 거절",
    });
    expect(await processUploadedCheckIn(db, fx.main, conflict)).toMatchObject({
      status: "REJECTED", final: true, reviewId: a.reviewId, reason: "별도 원본 확인 후 거절",
    });
    expect((await db.localCheckInReview.findUniqueOrThrow({ where: { id: a.reviewId } })).payload).toEqual(conflict);
    expect(await db.localCheckInReview.count()).toBe(2);
  });

  it("선점 뒤 실패한 transaction은 원본 슬롯까지 rollback하여 같은 키로 다시 시작한다", async () => {
    const snapshot = await issueKioskSnapshot(db, fx.main, ISSUED_AT);
    const item = studentItem(fx, snapshot.id);
    const broken = instrument(db, async (path, phase) => {
      if (path === "checkIn.create" && phase === "before") throw new Error("injected insert failure");
    });
    await expect(processUploadedCheckIn(broken, fx.main, item)).rejects.toThrow("injected insert failure");
    expect(await db.localCheckInReview.count()).toBe(0);
    expect(await db.checkIn.count({ where: { date: MEAL_DATE } })).toBe(0);
    expect(await processUploadedCheckIn(db, fx.main, item)).toMatchObject({ status: "ACCEPTED", final: true });
    expect(await db.localCheckInReview.count()).toBe(1);
  });

  it("다운로드 중 신청이 취소돼도 실제 내려준 확정일과 저장 근거는 같다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ISSUED_AT);
    const entered = deferred();
    const release = deferred();
    let paused = false;
    holder.db = instrument(db, async (path, phase) => {
      if (path === "mealRegistrationMealDate.findMany" && phase === "after" && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    });
    const { GET } = await import("@/app/api/sync/download/route");
    const pending = GET(new Request("http://localhost/api/sync/download"));
    await entered.promise;
    try {
      await withEligibilityMutation(db, fx.main, {
        scope: "REGISTRATION", applicationId: fx.applicationId, userId: fx.studentId,
      }, async (tx) => {
        await tx.mealRegistration.update({ where: { id: fx.registrationId }, data: { status: "CANCELLED" } });
      });
    } finally {
      release.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    const body = await response.json();
    const stored = await db.kioskSnapshot.findUniqueOrThrow({ where: { id: body.snapshot.id } });
    const payload = stored.payload as { eligible: Array<{ userId: number; date: string; mealKind: string }> };
    expect(body.eligibleEntries).toEqual(payload.eligible.map(({ userId, date, mealKind }) => ({ userId, date, mealKind })));
    expect(body.eligibleEntries).toContainEqual({ userId: fx.studentId, date: "2026-09-19", mealKind: "DINNER" });
    expect(body.eligibleUserIds).toEqual([fx.studentId]);
  });

  it("이용 중단과 겹친 다운로드의 사용자·얼굴·snapshot은 같은 시점의 명단이다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ISSUED_AT);
    await db.faceProfile.updateMany({ data: { modelVersion: FACE_MODEL_VERSION } });
    const entered = deferred();
    const release = deferred();
    let paused = false;
    holder.db = instrument(db, async (path, phase) => {
      if (path === "user.findMany" && phase === "after" && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
    });
    const { GET } = await import("@/app/api/sync/download/route");
    const pending = GET(new Request("http://localhost/api/sync/download?faces=1"));
    await entered.promise;
    try {
      const student = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
      await changeAccess(db, {
        actor: fx.main, userId: fx.studentId, requestId: "deactivate-during-download", kind: "ACCESS", payloadHash: "deactivate-during-download",
        expectedRowVersion: student.profileVersion, state: "INACTIVE", reason: "TRANSFERRED", confirmPrivileges: false,
      });
    } finally {
      release.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    const body = await response.json();
    const users = body.users.map((user: { id: number }) => user.id).sort();
    expect(body.snapshot.users.map((user: { userId: number }) => user.userId).sort()).toEqual(users);
    expect(body.faceProfiles.map((face: { userId: number }) => face.userId).sort()).toEqual(users);
    expect(users).toContain(fx.studentId);
    expect(await db.faceProfile.count({ where: { userId: fx.studentId } })).toBe(0);
    expect(JSON.stringify((await db.kioskSnapshot.findUniqueOrThrow({ where: { id: body.snapshot.id } })).payload)).not.toContain("embedding");
  });

  it("진행 중 전환 뒤 발급은 충돌을 재시도해 최신 버전으로 한 번만 저장한다", async () => {
    await pgClient.query("BEGIN");
    await pgClient.query('UPDATE "RosterControl" SET version = version + 1 WHERE id = 1');
    const pending = issueKioskSnapshot(db, fx.main, ISSUED_AT);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await pgClient.query("SELECT pg_stat_clear_snapshot()");
        const activity = await pgClient.query<{ waiting: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
            AND query LIKE '%RosterControl%' AND query LIKE '%FOR SHARE%') AS waiting`,
        );
        if (activity.rows[0]?.waiting) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await pgClient.query("COMMIT");
    } finally {
      await pgClient.query("ROLLBACK");
    }
    const snapshot = await pending;
    expect(snapshot.version).toBe(fx.version + 1);
    expect(await db.kioskSnapshot.count()).toBe(1);
  });
});
