import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { invalidateRosterModeCache } from "@/lib/academic-year/roster-mode-cache";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

vi.hoisted(() => {
  process.env.QR_JWT_SECRET = "test-qr-secret";
  process.env.FACECHECK_KIOSK_KEY = "test-kiosk-key";
});

/**
 * 식당 줄이 지나는 경로가 보내는 Prisma 연산 수의 상한. 트랜잭션 안의 연산까지
 * 센다. 숫자가 늘면 시험이 먼저 알려 준다 — 이 경로는 사람이 줄을 선 채 기다린다.
 */
const BUDGET = {
  qrSuccess: 6,
  qrDuplicate: 3,
  faceMatch: 2,
  faceConfirm: 6,
} as const;

const EMBEDDING = Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0));

const holder = vi.hoisted(() => ({
  db: null as unknown as object,
  calls: 0,
}));

type AnyRecord = Record<string | symbol, unknown>;

/** 델리게이트 호출(`user.findUnique` 등)을 한 건씩 센다. */
function countingDelegate(delegate: object): object {
  return new Proxy(delegate, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        holder.calls += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function countingClient(client: object): object {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;

      // 트랜잭션 안에서 도는 연산도 같은 계수기로 센다.
      if (prop === "$transaction" && typeof value === "function") {
        return (run: (tx: object) => Promise<unknown>, options?: unknown) => {
          holder.calls += 1;
          return (value as (...a: unknown[]) => unknown).call(
            target,
            (tx: object) => run(countingClient(tx)),
            options,
          );
        };
      }

      if (typeof value === "function") {
        return (...args: unknown[]) => {
          holder.calls += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      if (value && typeof value === "object") return countingDelegate(value);
      return value;
    },
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({} as AnyRecord, {
    get: (_target, prop) => (countingClient(holder.db) as AnyRecord)[prop],
  }),
}));

vi.mock("@/auth", () => ({
  auth: async () => ({ user: { dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" } }),
}));

describe("체크인 경로의 Prisma 연산 수", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let fx: AcademicFixture;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    holder.db = db;
    pgClient = await openAcademicTestPgClient();
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
    await pgClient.end();
  });

  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fx = await prepareAcademicFixture(db, pgClient);

    // 시계와 무관하게 늘 열린 석식 창. 그렇지 않으면 실행 시각에 따라 경로가 달라진다.
    await db.systemSetting.createMany({
      data: [
        { key: "dinner_window_start", value: "00:00" },
        { key: "dinner_window_end", value: "23:59" },
      ],
    });

    invalidateRosterModeCache();
    const { invalidateSettingsCache } = await import("@/lib/settings-cache");
    const { invalidateFaceCache } = await import("@/lib/face-embedding-cache");
    invalidateSettingsCache();
    invalidateFaceCache();
    await db.faceProfile.deleteMany({});
  }, 60_000);

  async function setMode(mode: "PREPARING" | "READY") {
    await db.$executeRaw`UPDATE "RosterControl" SET "mode" = ${mode} WHERE id = 1`;
    invalidateRosterModeCache();
  }

  async function qrRequest() {
    const { signQRToken } = await import("@/lib/qr-token");
    const { POST } = await import("@/app/api/checkin/route");
    return POST(
      new Request("http://localhost/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: signQRToken({ userId: fx.teacherId, role: "TEACHER", type: "WORK", mealKind: "DINNER" }),
        }),
      }),
    );
  }

  async function faceRequest(confirm: boolean) {
    const { todayKST } = await import("@/lib/timezone");
    const { POST } = await import("@/app/api/facecheck/route");
    return POST(
      new Request("http://localhost/api/facecheck", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kiosk-key": "test-kiosk-key" },
        body: JSON.stringify({
          embedding: EMBEDDING,
          type: "WORK",
          ...(confirm
            ? { confirmation: { userId: fx.teacherId, mealKind: "DINNER", date: todayKST() } }
            : {}),
        }),
      }),
    );
  }

  async function measure(run: () => Promise<Response>): Promise<{ body: unknown; calls: number }> {
    holder.calls = 0;
    const response = await run();
    return { body: await response.json(), calls: holder.calls };
  }

  it.each(["PREPARING", "READY"] as const)("%s: QR 성공·중복이 상한 안에 든다", async (mode) => {
    await setMode(mode);
    await qrRequest(); // 설정·모드 캐시를 데운다 — 운영 중 정상 상태는 캐시 적중이다

    await db.checkIn.deleteMany({ where: { userId: fx.teacherId } });
    const success = await measure(qrRequest);
    expect(success.body).toMatchObject({ success: true });
    expect(success.calls).toBeLessThanOrEqual(BUDGET.qrSuccess);

    const duplicate = await measure(qrRequest);
    expect(duplicate.body).toMatchObject({ duplicate: true });
    expect(duplicate.calls).toBeLessThanOrEqual(BUDGET.qrDuplicate);

    console.info(`[checkin] ${mode} QR 성공 ${success.calls}연산 / 중복 ${duplicate.calls}연산`);
  }, 60_000);

  it.each(["PREPARING", "READY"] as const)("%s: 얼굴 매칭은 저장 없이 상한 안에 든다", async (mode) => {
    await setMode(mode);
    const { FACE_MODEL_VERSION } = await import("@/lib/face-constants");
    await db.faceProfile.create({
      data: {
        userId: fx.teacherId,
        embeddings: [EMBEDDING],
        modelVersion: FACE_MODEL_VERSION,
        consentAt: new Date("2026-09-01T00:00:00.000Z"),
        consentVersion: "v1",
      },
    });
    await db.checkIn.deleteMany({ where: { userId: fx.teacherId } });
    await faceRequest(false); // 설정·후보·모드 캐시를 데운다

    const match = await measure(() => faceRequest(false));
    expect(match.body).toMatchObject({ needConfirmation: true });
    expect(match.calls).toBeLessThanOrEqual(BUDGET.faceMatch);

    const { todayKST } = await import("@/lib/timezone");
    expect(
      await db.checkIn.count({
        where: { userId: fx.teacherId, date: new Date(`${todayKST()}T00:00:00.000Z`) },
      }),
    ).toBe(0);

    const confirm = await measure(() => faceRequest(true));
    expect(confirm.body).toMatchObject({ success: true });
    expect(confirm.calls).toBeLessThanOrEqual(BUDGET.faceConfirm);

    console.info(`[facecheck] ${mode} 매칭 ${match.calls}연산 / 확인 ${confirm.calls}연산`);
  }, 60_000);
});
