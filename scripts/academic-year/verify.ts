// 기본 inspect는 상태를 바꾸지 않는다. VERIFIED 확정은 복원 근거와 보고 경로를
// 갖춘 명시적 apply에서만 수행한다.
import fs from "node:fs";
import type { LegacyFingerprint } from "./fingerprint";
import { captureLegacyFingerprint } from "./fingerprint";
import { inspectBackfill, verifyBackfill } from "../../src/lib/academic-year/backfill";
import { createMigrationReport } from "./report";
import {
  assertApplyAllowed,
  openMigrationPgClient,
  openMigrationTarget,
  parseCliArgs,
  readMigrationTargetConfig,
  safeErrorKind,
} from "./db-target";

function readFingerprint(filePath: string): LegacyFingerprint {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("tables" in parsed)) {
    throw new Error("비교할 manifest 형식이 올바르지 않습니다");
  }
  return parsed as LegacyFingerprint;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.targetConfigPath) throw new Error("--target-config를 지정하세요");
  if (!options.beforePath) throw new Error("--before를 지정하세요");

  const config = readMigrationTargetConfig(options.targetConfigPath);
  assertApplyAllowed(options, config);
  const before = readFingerprint(options.beforePath);
  const evidence = options.mode === "apply" ? createMigrationReport(options.reportDir!) : null;
  evidence?.write("before.json", before);
  if (evidence) console.info(`report=${evidence.directory}`);

  const target = await openMigrationTarget(options.targetConfigPath);
  const db = target.db;
  try {
    const pgClient = await openMigrationPgClient(options.targetConfigPath);
    try {
      const after = await captureLegacyFingerprint(pgClient);
      evidence?.write("after.json", after);
      const verified = options.mode === "apply"
        ? await verifyBackfill(db, before, after)
        : await inspectBackfill(db, before, after);
      evidence?.write("result.json", { environment: config.environment, verified });

      console.info(`environment=${config.environment} mode=${options.mode} operation=verify`);
      console.info(`canEnable=${verified.canEnable}`);
      console.info(`issues=${verified.issues.join(",") || "none"}`);
      if (!verified.canEnable) process.exitCode = 1;
    } finally {
      await pgClient.end();
    }
  } finally {
    await target.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`failed kind=${safeErrorKind(error)}`);
    process.exitCode = 1;
  });
}
