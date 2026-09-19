// 초기 이전 이후 원본 보존을 확인하는 읽기 전용 CLI. `--before`로 받은
// manifest(해시·건수만 담긴다)와 현재 상태를 비교해 차이의 종류만 출력한다.
import fs from "node:fs";
import type { LegacyFingerprint } from "./fingerprint";
import { captureLegacyFingerprint } from "./fingerprint";
import { verifyBackfill } from "../../src/lib/academic-year/backfill";
import {
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
  const before = readFingerprint(options.beforePath);

  const target = await openMigrationTarget(options.targetConfigPath);
  const db = target.db;
  const pgClient = await openMigrationPgClient(options.targetConfigPath);
  try {
    const after = await captureLegacyFingerprint(pgClient);
    const verified = await verifyBackfill(db, before, after);

    console.info(`environment=${config.environment} mode=verify`);
    console.info(`canEnable=${verified.canEnable}`);
    console.info(`issues=${verified.issues.join(",") || "none"}`);
  } finally {
    await pgClient.end();
    await target.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`failed kind=${safeErrorKind(error)}`);
    process.exitCode = 1;
  });
}
