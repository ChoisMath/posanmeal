import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Client } from "pg";
import { ACADEMIC_BACKFILL_KEY, backfill2026, captureDateLessSurveySource, verifyBackfill } from "@/lib/academic-year/backfill";
import { ACADEMIC_TEST_DATABASE_URL, ACADEMIC_TEST_IDENTITY_MARKER } from "@/lib/academic-year/test-target";
import { captureLegacyFingerprint } from "../../scripts/academic-year/fingerprint";
import { openAcademicTestDb, openAcademicTestPgClient, resetAcademicTestDb } from "./support/db";
import { seedLegacyFixture } from "./support/legacy-fixture";

const CLI_APPLICATION = "academic_foundation_cli_test";

function runCli(script: "backfill" | "verify" | "enable", args: string[]) {
  const url = new URL(ACADEMIC_TEST_DATABASE_URL);
  url.searchParams.set("application_name", CLI_APPLICATION);
  const child = spawn(process.execPath, ["--import", "tsx", `scripts/academic-year/${script}.ts`, ...args], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, NODE_ENV: "test", ACADEMIC_MIGRATION_DATABASE_URL: url.toString() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
}

function filesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  });
}

describe("guarded foundation CLI", () => {
  let db: PrismaClient;
  let pgClient: Client;
  let directory: string;
  let configPath: string;
  let beforePath: string;
  let reportDir: string;

  beforeAll(async () => {
    db = await openAcademicTestDb();
    pgClient = await openAcademicTestPgClient();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "academic-foundation-cli-"));
  });
  afterAll(async () => {
    await pgClient.end();
    await db.$disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetAcademicTestDb(db);
    await seedLegacyFixture(db);
    const runDir = fs.mkdtempSync(path.join(directory, "run-"));
    configPath = path.join(runDir, "target.json");
    beforePath = path.join(runDir, "before.json");
    reportDir = path.join(runDir, "reports");
    const url = new URL(ACADEMIC_TEST_DATABASE_URL);
    fs.writeFileSync(configPath, JSON.stringify({ environment: "synthetic-test", host: url.hostname,
      port: Number(url.port), database: url.pathname.slice(1), username: url.username,
      markerScope: "test", marker: ACADEMIC_TEST_IDENTITY_MARKER, restoreReportId: "synthetic-restore" }));
    fs.writeFileSync(beforePath, JSON.stringify(await captureLegacyFingerprint(pgClient)));
  });

  it("only explicit backfill apply accepts a survey confirmation file and preserves its evidence", async () => {
    await db.mealApplicationMealDate.deleteMany();
    await db.mealRegistrationMealDate.deleteMany();
    const application = await db.mealApplication.findFirstOrThrow();
    const source = (await captureDateLessSurveySource(db, application.id))!;
    const confirmationPath = path.join(path.dirname(configPath), "surveys.json");
    fs.writeFileSync(confirmationPath, JSON.stringify([{
      applicationId: application.id, academicYear: 2026, kind: "DATELESS_INTENT_SURVEY",
      expectedApprovedRegistrationCount: 1, expectedTotalRegistrationCount: 1,
      expectedSourceRowHash: source.sourceRowHash,
    }]));
    const args = ["--target-config", configPath, "--report-dir", reportDir,
      "--survey-confirmations", confirmationPath];
    expect((await runCli("backfill", args)).code).not.toBe(0);
    expect((await runCli("verify", ["--mode", "apply", ...args])).code).not.toBe(0);
    expect((await runCli("enable", ["--mode", "apply", ...args])).code).not.toBe(0);
    expect(await db.academicBackfill.count()).toBe(0);

    const result = await runCli("backfill", ["--mode", "apply", ...args]);
    expect(result).toMatchObject({ code: 0 });
    expect(result.output).toContain("canEnable=true");
    expect((await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).state).toBe("VERIFIED");
    const savedBefore = filesUnder(reportDir).find((filename) => path.basename(filename) === "before.json")!;
    const inspected = await runCli("verify", ["--target-config", configPath, "--before", savedBefore]);
    expect(inspected.code).toBe(0);
    expect(inspected.output).toContain("canEnable=true");
    const serialized = filesUnder(reportDir).map((filename) => fs.readFileSync(filename, "utf8")).join("");
    expect(serialized).not.toContain("학생테스트");
  }, 20_000);

  it.each([{ mode: [] }, { mode: ["--mode", "inspect"] }])("verify $mode never promotes COPIED or rewrites its manifest", async ({ mode }) => {
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    await backfill2026(db, before);
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    const result = await runCli("verify", ["--target-config", configPath, "--before", beforePath, ...mode]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("canEnable=true");
    expect(await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).toEqual(stamp);
  }, 15_000);

  it("explicit verification cannot write without a restore report", async () => {
    await backfill2026(db, JSON.parse(fs.readFileSync(beforePath, "utf8")));
    const target = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(configPath, JSON.stringify({ ...target, restoreReportId: null }));
    const result = await runCli("verify", ["--mode", "apply", "--target-config", configPath,
      "--before", beforePath, "--report-dir", reportDir]);

    expect(result.code).not.toBe(0);
    expect((await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).state).toBe("COPIED");
  }, 15_000);

  it("explicit verification promotes the copy and its protected before evidence remains usable for inspect", async () => {
    await backfill2026(db, JSON.parse(fs.readFileSync(beforePath, "utf8")));
    const verified = await runCli("verify", ["--mode", "apply", "--target-config", configPath,
      "--before", beforePath, "--report-dir", reportDir]);
    expect(verified.code).toBe(0);
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    expect(stamp.state).toBe("VERIFIED");
    expect(stamp.verifiedAt).not.toBeNull();
    const savedBefore = filesUnder(reportDir).find((filename) => path.basename(filename) === "before.json");
    expect(savedBefore).toBeDefined();
    const inspected = await runCli("verify", ["--target-config", configPath, "--before", savedBefore!]);

    expect(inspected.code).toBe(0);
    expect(await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).toEqual(stamp);
  }, 15_000);

  it("an old fingerprint format fails closed and only explicit apply invalidates its old VERIFIED stamp", async () => {
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    fs.writeFileSync(beforePath, JSON.stringify({ tables: before.tables }));

    const inspected = await runCli("verify", ["--target-config", configPath, "--before", beforePath]);
    expect(inspected.code).not.toBe(0);
    expect(inspected.output).toContain("FINGERPRINT_FORMAT_MISMATCH");
    expect(await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).toEqual(stamp);

    const confirmed = await runCli("verify", ["--mode", "apply", "--target-config", configPath,
      "--before", beforePath, "--report-dir", reportDir]);
    expect(confirmed.code).not.toBe(0);
    expect(confirmed.output).toContain("FINGERPRINT_FORMAT_MISMATCH");
    expect(await db.academicBackfill.findUnique({ where: { key: ACADEMIC_BACKFILL_KEY } }))
      .toMatchObject({ state: "COPIED", verifiedAt: null });
  }, 15_000);

  it("failed readonly comparison returns failure without changing the stored stamp", async () => {
    await backfill2026(db, JSON.parse(fs.readFileSync(beforePath, "utf8")));
    const stamp = await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } });
    await db.systemSetting.update({ where: { key: "faceMatchThreshold" }, data: { value: "0.6" } });
    const result = await runCli("verify", ["--target-config", configPath, "--before", beforePath]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("LEGACY_MODIFIED:SystemSetting");
    expect(await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).toEqual(stamp);
  }, 15_000);

  it("an unusable report directory prevents all backfill writes", async () => {
    fs.writeFileSync(reportDir, "not a directory");
    const result = await runCli("backfill", ["--mode", "apply", "--target-config", configPath, "--report-dir", reportDir]);

    expect(result.code).not.toBe(0);
    expect(await db.userAcademicRecord.count()).toBe(0);
    expect(await db.academicBackfill.count()).toBe(0);
  }, 15_000);

  it("persists the original before fingerprint before mutation and keeps it after a late report failure", async () => {
    fs.mkdirSync(reportDir);
    await pgClient.query("BEGIN");
    await pgClient.query('SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE');
    const running = runCli("backfill", ["--mode", "apply", "--target-config", configPath, "--report-dir", reportDir]);
    let savedBefore: string | undefined;
    try {
      await expect.poll(async () => {
        await pgClient.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await pgClient.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [CLI_APPLICATION],
        );
        return waiting.rows[0]?.n ?? 0;
      }, { timeout: 8000, interval: 25 }).toBeGreaterThan(0);
      const beforeFiles = filesUnder(reportDir).filter((filename) => path.basename(filename) === "before.json");
      expect(beforeFiles).toHaveLength(1);
      savedBefore = beforeFiles[0];
      expect(JSON.parse(fs.readFileSync(savedBefore, "utf8"))).toEqual(JSON.parse(fs.readFileSync(beforePath, "utf8")));
      fs.mkdirSync(path.join(path.dirname(savedBefore), "result.json"));
    } finally {
      await pgClient.query("ROLLBACK");
      await running;
    }
    expect((await running).code).not.toBe(0);
    expect(await db.userAcademicRecord.count()).toBe(2);
    expect((await db.academicBackfill.findUniqueOrThrow({ where: { key: ACADEMIC_BACKFILL_KEY } })).state).toBe("VERIFIED");
    expect(JSON.parse(fs.readFileSync(savedBefore!, "utf8"))).toEqual(JSON.parse(fs.readFileSync(beforePath, "utf8")));
  }, 15_000);

  it("READY inspect leaves mode and receipts unchanged, then guarded apply enables through MAIN", async () => {
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    await backfill2026(db, before);
    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    const control = await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    const inspected = await runCli("enable", ["--target-config", configPath]);

    expect(inspected.code).toBe(0);
    expect(inspected.output).toContain("canEnable=true");
    expect(await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).toEqual(control);
    expect(await db.rosterMutation.count()).toBe(0);

    const applied = await runCli("enable", ["--mode", "apply", "--target-config", configPath, "--report-dir", reportDir]);
    expect(applied.code).toBe(0);
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("READY");
    expect(await db.rosterMutation.findFirst({ where: { kind: "ENABLE_ACADEMIC_MODE" }, select: { actorUserId: true } }))
      .toEqual({ actorUserId: null });
    expect(filesUnder(reportDir).some((filename) => path.basename(filename) === "before.json")).toBe(true);
  }, 20_000);

  it("READY apply rejects an unverified copy and a target without restore evidence", async () => {
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    await backfill2026(db, before);
    const unverified = await runCli("enable", ["--mode", "apply", "--target-config", configPath, "--report-dir", reportDir]);
    expect(unverified.code).not.toBe(0);
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");

    await verifyBackfill(db, before, await captureLegacyFingerprint(pgClient));
    const target = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(configPath, JSON.stringify({ ...target, restoreReportId: null }));
    const unapproved = await runCli("enable", ["--mode", "apply", "--target-config", configPath, "--report-dir", reportDir]);
    expect(unapproved.code).not.toBe(0);
    expect((await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).mode).toBe("PREPARING");
    expect(await db.rosterMutation.count()).toBe(0);
  }, 20_000);
});
