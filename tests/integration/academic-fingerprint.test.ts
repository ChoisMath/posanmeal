import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { seedLegacyFixture, type LegacyFixtureIds } from "./support/legacy-fixture";
import { captureLegacyFingerprint, compareLegacyFingerprints } from "../../scripts/academic-year/fingerprint";

describe("legacy fingerprint", () => {
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

  it("produces a stable fingerprint for an unchanged database", async () => {
    const first = await captureLegacyFingerprint(pgClient);
    const second = await captureLegacyFingerprint(pgClient);

    expect(compareLegacyFingerprints(first, second)).toEqual({ equal: true, differingTables: [] });
    expect(first.tables.User?.count).toBe(2);
    expect(first.tables.FaceProfile?.count).toBe(2);
  });

  it("detects a same-row-count change in a single table", async () => {
    const before = await captureLegacyFingerprint(pgClient);
    await pgClient.query('UPDATE "MealRegistration" SET signature = $1 WHERE id = $2', [
      "changed",
      fixture.registrationId,
    ]);
    const after = await captureLegacyFingerprint(pgClient);

    expect(compareLegacyFingerprints(before, after)).toEqual({
      equal: false,
      differingTables: ["MealRegistration"],
    });
  });
});
