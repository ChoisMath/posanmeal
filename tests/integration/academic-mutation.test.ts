import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import type { Actor } from "@/lib/academic-year/contracts";
import { withAcademicMutation, withUserMutation } from "@/lib/academic-year/mutation";
import { ACADEMIC_TEST_SEED_YEAR, openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { seedLegacyFixture, type LegacyFixtureIds } from "./support/legacy-fixture";

const MAIN: Actor = { kind: "MAIN", userId: null, sessionVersion: null };
const allow = async (): Promise<void> => {};

async function controlVersion(db: PrismaClient): Promise<number> {
  return (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;
}

describe("guarded mutations", () => {
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

  it("lets only one of two concurrent global mutations win on the same base version", async () => {
    const version = await controlVersion(db);
    const results = await Promise.allSettled(
      ["one", "two"].map((requestId) =>
        withAcademicMutation(
          db,
          { actor: MAIN, requestId, expectedVersion: version, kind: "TEST", payloadHash: requestId },
          allow,
          async () => ({ changed: 1, ids: [requestId] }),
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(await controlVersion(db)).toBe(version + 1);
    expect(await db.rosterMutation.count()).toBe(1);
  });

  it("returns the stored receipt when the same request is replayed", async () => {
    const version = await controlVersion(db);
    const input = {
      actor: MAIN,
      requestId: "replay",
      expectedVersion: version,
      kind: "TEST",
      payloadHash: "hash-1",
    };
    let writes = 0;
    const write = async () => {
      writes += 1;
      return { changed: 3, ids: [1, 2, 3] };
    };

    const first = await withAcademicMutation(db, input, allow, write);
    const second = await withAcademicMutation(db, input, allow, write);

    expect(writes).toBe(1);
    expect(second.receipt).toEqual(first.receipt);
    expect(second.result).toEqual({ changed: 3, ids: [1, 2, 3] });
    expect(await controlVersion(db)).toBe(version + 1);
  });

  it("rejects the same request key carrying a different payload or actor", async () => {
    const version = await controlVersion(db);
    const base = {
      actor: MAIN,
      requestId: "reuse",
      expectedVersion: version,
      kind: "TEST",
      payloadHash: "hash-1",
    };
    await withAcademicMutation(db, base, allow, async () => ({ changed: 1, ids: [1] }));

    await expect(
      withAcademicMutation(db, { ...base, payloadHash: "hash-2" }, allow, async () => ({
        changed: 1,
        ids: [1],
      })),
    ).rejects.toMatchObject({ code: "REQUEST_REUSED" });

    await expect(
      withAcademicMutation(db, { ...base, kind: "OTHER" }, allow, async () => ({ changed: 1, ids: [1] })),
    ).rejects.toMatchObject({ code: "REQUEST_REUSED" });
  });

  it("runs authorize before any replay or version check", async () => {
    const version = await controlVersion(db);
    const deny = async () => {
      throw new Error("forbidden");
    };

    await expect(
      withAcademicMutation(
        db,
        { actor: MAIN, requestId: "denied", expectedVersion: version, kind: "TEST", payloadHash: "h" },
        deny,
        async () => ({ changed: 1, ids: [1] }),
      ),
    ).rejects.toThrow("forbidden");

    expect(await controlVersion(db)).toBe(version);
    expect(await db.rosterMutation.count()).toBe(0);
  });

  it("lets row mutations on different users succeed in parallel", async () => {
    const results = await Promise.all(
      [fixture.studentId, fixture.teacherId].map((userId) =>
        withUserMutation(
          db,
          {
            actor: MAIN,
            requestId: `row-${userId}`,
            userId,
            expectedRowVersion: 0,
            kind: "EDIT",
            payloadHash: `hash-${userId}`,
          },
          allow,
          async () => ({ changed: 1, ids: [userId] }),
        ),
      ),
    );

    expect(results.map((entry) => entry.receipt.version)).toEqual([1, 1]);
    expect(await controlVersion(db)).toBe(0);

    const users = await db.user.findMany({
      where: { id: { in: [fixture.studentId, fixture.teacherId] } },
      select: { profileVersion: true },
    });
    expect(users.map((user) => user.profileVersion)).toEqual([1, 1]);
  });

  it("lets only one of two concurrent row mutations on the same user win", async () => {
    const results = await Promise.allSettled(
      ["a", "b"].map((requestId) =>
        withUserMutation(
          db,
          {
            actor: MAIN,
            requestId,
            userId: fixture.studentId,
            expectedRowVersion: 0,
            kind: "EDIT",
            payloadHash: requestId,
          },
          allow,
          async () => ({ changed: 1, ids: [fixture.studentId] }),
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "VERSION_CONFLICT" });

    const user = await db.user.findUniqueOrThrow({ where: { id: fixture.studentId } });
    expect(user.profileVersion).toBe(1);
  });

  it("bumps the academic year version from inside a row mutation write", async () => {
    const { receipt } = await withUserMutation(
      db,
      {
        actor: MAIN,
        requestId: "year-bump",
        userId: fixture.studentId,
        expectedRowVersion: 0,
        kind: "EDIT",
        payloadHash: "hash",
      },
      allow,
      async (tx) => {
        await tx.academicYear.update({
          where: { year: ACADEMIC_TEST_SEED_YEAR },
          data: { version: { increment: 1 } },
        });
        return { changed: 1, ids: [fixture.studentId] };
      },
    );

    expect(receipt.version).toBe(1);
    const year = await db.academicYear.findUniqueOrThrow({ where: { year: ACADEMIC_TEST_SEED_YEAR } });
    expect(year.version).toBe(1);
    const stored = await db.rosterMutation.findUniqueOrThrow({ where: { requestId: "year-bump" } });
    expect(stored.version).toBe(1);
  });

  it("collapses two concurrent row mutations sharing one request key into one receipt", async () => {
    const shared = {
      actor: MAIN,
      requestId: "shared-key",
      expectedRowVersion: 0,
      kind: "EDIT",
      payloadHash: "same-hash",
    };
    const outcomes = await Promise.all(
      [fixture.studentId, fixture.teacherId].map((userId) =>
        withUserMutation(db, { ...shared, userId }, allow, async () => ({ changed: 1, ids: [userId] })),
      ),
    );

    expect(outcomes[0]?.receipt).toEqual(outcomes[1]?.receipt);
    expect(await db.rosterMutation.count()).toBe(1);

    const users = await db.user.findMany({
      where: { id: { in: [fixture.studentId, fixture.teacherId] } },
      select: { profileVersion: true },
    });
    expect(users.filter((user) => user.profileVersion === 1)).toHaveLength(1);
  });

  it("rejects a shared request key carrying a different payload", async () => {
    await withUserMutation(
      db,
      {
        actor: MAIN,
        requestId: "row-reuse",
        userId: fixture.studentId,
        expectedRowVersion: 0,
        kind: "EDIT",
        payloadHash: "hash-1",
      },
      allow,
      async () => ({ changed: 1, ids: [fixture.studentId] }),
    );

    await expect(
      withUserMutation(
        db,
        {
          actor: MAIN,
          requestId: "row-reuse",
          userId: fixture.teacherId,
          expectedRowVersion: 0,
          kind: "EDIT",
          payloadHash: "hash-2",
        },
        allow,
        async () => ({ changed: 1, ids: [fixture.teacherId] }),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_REUSED" });
  });

  it("propagates an unrelated unique violation raised inside write", async () => {
    const decision = {
      year: ACADEMIC_TEST_SEED_YEAR,
      userId: fixture.studentId,
      decision: "RESTORE",
      sourceVersion: 0,
    };
    await db.rosterDecision.create({ data: decision });

    const input = {
      actor: MAIN,
      requestId: "write-conflict",
      userId: fixture.studentId,
      expectedRowVersion: 0,
      kind: "EDIT",
      payloadHash: "hash",
    };

    await expect(
      withUserMutation(db, input, allow, async (tx) => {
        await tx.rosterDecision.create({ data: decision });
        return { changed: 1, ids: [fixture.studentId] };
      }),
    ).rejects.toMatchObject({ code: "P2002", meta: { modelName: "RosterDecision" } });

    expect(await db.rosterMutation.count()).toBe(0);
    const user = await db.user.findUniqueOrThrow({ where: { id: fixture.studentId } });
    expect(user.profileVersion).toBe(0);
  });

  it("replays a successful request without running write again", async () => {
    const input = {
      actor: MAIN,
      requestId: "row-replay",
      userId: fixture.studentId,
      expectedRowVersion: 0,
      kind: "EDIT",
      payloadHash: "hash",
    };
    let writes = 0;
    const write = async () => {
      writes += 1;
      return { changed: 2, ids: [fixture.studentId] };
    };

    const first = await withUserMutation(db, input, allow, write);
    const second = await withUserMutation(db, input, allow, write);

    expect(writes).toBe(1);
    expect(second.receipt).toEqual(first.receipt);
    expect(await db.rosterMutation.count()).toBe(1);
  });

  it("re-checks authorization before returning a replayed receipt", async () => {
    const version = await controlVersion(db);
    const input = {
      actor: MAIN,
      requestId: "replay-denied",
      expectedVersion: version,
      kind: "TEST",
      payloadHash: "hash",
    };
    await withAcademicMutation(db, input, allow, async () => ({ changed: 1, ids: [1] }));

    const deny = async () => {
      throw new Error("forbidden");
    };
    await expect(
      withAcademicMutation(db, input, deny, async () => ({ changed: 1, ids: [1] })),
    ).rejects.toThrow("forbidden");

    const rowInput = {
      actor: MAIN,
      requestId: "row-replay-denied",
      userId: fixture.studentId,
      expectedRowVersion: 0,
      kind: "EDIT",
      payloadHash: "hash",
    };
    await withUserMutation(db, rowInput, allow, async () => ({ changed: 1, ids: [fixture.studentId] }));
    await expect(
      withUserMutation(db, rowInput, deny, async () => ({ changed: 1, ids: [fixture.studentId] })),
    ).rejects.toThrow("forbidden");
  });

  it("does not block check-in inserts or meal registration writes while the control row is locked", async () => {
    await pgClient.query("BEGIN");
    await pgClient.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');

    try {
      const started = Date.now();
      await Promise.all([
        db.checkIn.create({
          data: {
            userId: fixture.studentId,
            date: new Date("2026-09-19T00:00:00.000Z"),
            mealKind: "DINNER",
            type: "STUDENT",
            source: "QR",
          },
        }),
        db.mealRegistration.update({
          where: { id: fixture.registrationId },
          data: { signature: "잠금중-갱신" },
        }),
      ]);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await pgClient.query("ROLLBACK");
    }
  });
});
