import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Tx } from "@/lib/academic-year/db";
import { changeAccess } from "@/lib/academic-year/account-service";
import { upsertRosterProfile } from "@/lib/academic-year/roster-service";
import { sqlStateOf } from "@/lib/academic-year/mutation";
import { openAcademicTestDb, resetAcademicTestDb } from "./support/db";
import { prepareAcademicFixture, type AcademicFixture } from "./support/academic-fixture";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function observeRawQueries(db: PrismaClient, observe: (phase: "before" | "after", sql: string) => Promise<void>): PrismaClient {
  return new Proxy(db, {
    get(client, key) {
      if (key !== "$transaction") return Reflect.get(client, key, client);
      return (work: (tx: Tx) => Promise<unknown>, options: { maxWait: number; timeout: number }) =>
        client.$transaction((tx) => work(new Proxy(tx, {
          get(transaction, operation) {
            const original = Reflect.get(transaction, operation, transaction);
            if (operation !== "$queryRaw") return original;
            return async (...args: unknown[]) => {
              const first = args[0];
              const sql = Array.isArray(first) ? first.join("") : String((first as { sql?: string }).sql ?? "");
              await observe("before", sql);
              const result = await Reflect.apply(original, transaction, args);
              await observe("after", sql);
              return result;
            };
          },
        })), options);
    },
  });
}

describe("account and roster row lock order", () => {
  let db: PrismaClient;
  let fixture: AcademicFixture;
  beforeAll(async () => { db = await openAcademicTestDb(); });
  afterAll(async () => { await db.$disconnect(); });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    fixture = await prepareAcademicFixture(db);
  });

  it("concurrent access removal and roster editing finish without a User/Record deadlock", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: fixture.studentId } });
    const record = await db.userAcademicRecord.findUniqueOrThrow({
      where: { year_userId: { year: 2026, userId: fixture.studentId } },
    });
    const accessLocked = gate();
    const releaseAccess = gate();
    const rosterWaitingForUser = gate();
    let accessPaused = false;
    const accessDb = observeRawQueries(db, async (phase, sql) => {
      if (phase === "after" && sql.includes('FROM "User"') && sql.includes("FOR UPDATE") && !accessPaused) {
        accessPaused = true;
        accessLocked.release();
        await releaseAccess.promise;
      }
    });
    const rosterDb = observeRawQueries(db, async (phase, sql) => {
      if (phase === "before" && sql.includes('FROM "User"') && sql.includes("FOR UPDATE")) rosterWaitingForUser.release();
    });
    const access = changeAccess(accessDb, { actor: fixture.main, requestId: "concurrent-access", kind: "ACCESS",
      payloadHash: "access", expectedRowVersion: user.profileVersion, userId: user.id,
      state: "INACTIVE", reason: "TRANSFERRED", confirmPrivileges: false });
    const accessResult = access.then((value) => ({ value }), (error: unknown) => ({ error }));
    await accessLocked.promise;
    const roster = upsertRosterProfile(rosterDb, { actor: fixture.main, requestId: "concurrent-roster", kind: "ROSTER_ROW",
      payloadHash: "roster", expectedRowVersion: record.version, year: 2026, userId: user.id, email: user.email,
      profile: { role: "STUDENT", name: "수정 이름", grade: 1, classNum: 1, number: 1, gender: "MALE",
        subject: null, homeroom: null, position: null } });
    const rosterResult = roster.then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await rosterWaitingForUser.promise;
    } finally {
      releaseAccess.release();
    }
    const [accessOutcome, rosterOutcome] = await Promise.all([accessResult, rosterResult]);

    expect(accessOutcome).toHaveProperty("value");
    expect("error" in rosterOutcome ? sqlStateOf(rosterOutcome.error) : null).not.toBe("40P01");
    expect(rosterOutcome).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    expect(await db.user.findUnique({ where: { id: user.id }, select: { accessState: true, sessionVersion: true } }))
      .toEqual({ accessState: "INACTIVE", sessionVersion: user.sessionVersion + 1 });
    expect(await db.userAcademicRecord.findUnique({ where: { year_userId: { year: 2026, userId: user.id } },
      select: { name: true, memberState: true, version: true } }))
      .toEqual({ name: record.name, memberState: "TRANSFERRED", version: record.version + 1 });
    expect(await db.faceProfile.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.rosterMutation.count({ where: { requestId: { in: ["concurrent-access", "concurrent-roster"] } } })).toBe(1);
  }, 20_000);
});
