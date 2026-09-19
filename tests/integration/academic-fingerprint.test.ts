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

  it("SQL NULL과 기존 NULL 표식과 같은 실제 문자열을 구분한다", async () => {
    await pgClient.query('UPDATE "User" SET subject = NULL WHERE id = $1', [fixture.studentId]);
    const before = await captureLegacyFingerprint(pgClient);
    await pgClient.query('UPDATE "User" SET subject = $1 WHERE id = $2', [
      "\u0002__NULL__\u0002", fixture.studentId,
    ]);
    const after = await captureLegacyFingerprint(pgClient);

    expect(after.tables.User.pkHash).toBe(before.tables.User.pkHash);
    expect(compareLegacyFingerprints(before, after)).toEqual({ equal: false, differingTables: ["User"] });
  });

  it("인접한 텍스트 열 사이로 제어문자가 이동해도 원본 변경을 검출한다", async () => {
    await pgClient.query('UPDATE "MealApplication" SET title = $1, description = $2 WHERE id = $3', [
      "a\u0001b", "c", fixture.applicationId,
    ]);
    const before = await captureLegacyFingerprint(pgClient);
    await pgClient.query('UPDATE "MealApplication" SET title = $1, description = $2 WHERE id = $3', [
      "a", "b\u0001c", fixture.applicationId,
    ]);
    const after = await captureLegacyFingerprint(pgClient);

    expect(after.tables.MealApplication.pkHash).toBe(before.tables.MealApplication.pkHash);
    expect(compareLegacyFingerprints(before, after)).toEqual({ equal: false, differingTables: ["MealApplication"] });
  });

  it("같은 행 수에서 PK 안의 개행이 행 경계와 혼동되지 않는다", async () => {
    await pgClient.query('INSERT INTO "SystemSetting" (key, value, "updatedAt") VALUES ($1, $3, $4), ($2, $3, $4)', [
      "a\nb", "c", "value", "2026-09-18T00:00:00.000Z",
    ]);
    const before = await captureLegacyFingerprint(pgClient);
    await pgClient.query('UPDATE "SystemSetting" SET key = $1 WHERE key = $2', ["a", "a\nb"]);
    await pgClient.query('UPDATE "SystemSetting" SET key = $1 WHERE key = $2', ["b\nc", "c"]);
    const after = await captureLegacyFingerprint(pgClient);

    expect(after.tables.SystemSetting.count).toBe(before.tables.SystemSetting.count);
    expect(after.tables.SystemSetting.pkHash).not.toBe(before.tables.SystemSetting.pkHash);
    expect(after.tables.SystemSetting.rowHash).not.toBe(before.tables.SystemSetting.rowHash);
  });

  it("새 manifest는 형식을 명시하며 누락·다른 버전·미지원 형식끼리의 비교를 거절한다", async () => {
    const current = await captureLegacyFingerprint(pgClient);
    expect(current).toMatchObject({ format: "posanmeal-legacy-fingerprint", version: 2 });
    const legacy = { tables: current.tables };
    const future = { ...current, version: 999 };
    const foreign = { ...current, format: "other" };

    for (const [left, right] of [[legacy, current], [current, legacy], [legacy, legacy], [future, future], [foreign, current]]) {
      expect(compareLegacyFingerprints(left, right)).toEqual({
        equal: false, differingTables: [], formatMismatch: true,
      });
    }
  });

  it("DB의 날짜 출력 설정과 세션 시간대가 달라도 date PK와 UTC 시각은 동일하다", async () => {
    try {
      await pgClient.query("SET DateStyle TO 'ISO, MDY'");
      await pgClient.query("SET TIME ZONE 'UTC'");
      const before = await captureLegacyFingerprint(pgClient);
      await pgClient.query("SET DateStyle TO 'SQL, DMY'");
      await pgClient.query("SET TIME ZONE 'Asia/Seoul'");
      const after = await captureLegacyFingerprint(pgClient);

      expect(compareLegacyFingerprints(before, after)).toEqual({ equal: true, differingTables: [] });
    } finally {
      await pgClient.query("RESET DateStyle");
      await pgClient.query("RESET TIME ZONE");
    }
  });

  it("timestamp를 JS Date로 반올림하지 않고 마이크로초 차이를 검출한다", async () => {
    // 운영 모델의 정밀도와 무관하게 SQL 출력 자체를 검증하며 세션 밖에는 남기지 않는다.
    await pgClient.query('CREATE TEMP TABLE "Admin" (id integer, username text, "passwordHash" text, "createdAt" timestamp(6))');
    try {
      await pgClient.query('INSERT INTO pg_temp."Admin" VALUES (1, $1, $2, $3::timestamp)', [
        "테스트", "hash", "2026-09-18T12:00:00.123456",
      ]);
      const before = await captureLegacyFingerprint(pgClient);
      await pgClient.query('UPDATE pg_temp."Admin" SET "createdAt" = $1::timestamp WHERE id = 1', [
        "2026-09-18T12:00:00.123457",
      ]);
      const after = await captureLegacyFingerprint(pgClient);

      expect(after.tables.Admin.pkHash).toBe(before.tables.Admin.pkHash);
      expect(compareLegacyFingerprints(before, after)).toEqual({ equal: false, differingTables: ["Admin"] });
    } finally {
      await pgClient.query('DROP TABLE pg_temp."Admin"');
    }
  });

  it("jsonb 키 순서와 공백은 정규화하되 큰 수의 값 차이는 유지한다", async () => {
    await pgClient.query('UPDATE "FaceProfile" SET embeddings = $1::jsonb WHERE "userId" = $2', [
      '{"z": 9007199254740992, "a": "문자\\n\\u0001\\\""}', fixture.studentId,
    ]);
    const before = await captureLegacyFingerprint(pgClient);
    await pgClient.query('UPDATE "FaceProfile" SET embeddings = $1::jsonb WHERE "userId" = $2', [
      '{ "a":"문자\\n\\u0001\\\"", "z":9007199254740992 }', fixture.studentId,
    ]);
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)))
      .toEqual({ equal: true, differingTables: [] });
    await pgClient.query('UPDATE "FaceProfile" SET embeddings = $1::jsonb WHERE "userId" = $2', [
      '{"a":"문자\\n\\u0001\\\"", "z":9007199254740993}', fixture.studentId,
    ]);
    expect(compareLegacyFingerprints(before, await captureLegacyFingerprint(pgClient)))
      .toEqual({ equal: false, differingTables: ["FaceProfile"] });
  });
});
