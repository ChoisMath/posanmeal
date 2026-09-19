// 초기 이전 CLI. 기본은 읽기 전용 inspect이며, 쓰기는 승인된 대상 설정과
// 보호된 출력 경로를 모두 명시해야 한다. 출력에는 차이의 종류와 건수만 담고
// 이름·이메일·학번·연결 URL은 어떤 경우에도 내보내지 않는다.
import { backfill2026, runPreflight, verifyBackfill } from "../../src/lib/academic-year/backfill";
import { captureLegacyFingerprint } from "./fingerprint";
import { createMigrationReport } from "./report";
import {
  assertApplyAllowed,
  openMigrationPgClient,
  openMigrationTarget,
  parseCliArgs,
  readMigrationTargetConfig,
  safeErrorKind,
} from "./db-target";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.targetConfigPath) {
    throw new Error("--target-config를 지정하세요");
  }

  const config = readMigrationTargetConfig(options.targetConfigPath);
  assertApplyAllowed(options, config);
  const evidence = options.mode === "apply" ? createMigrationReport(options.reportDir!) : null;

  const target = await openMigrationTarget(options.targetConfigPath);
  const db = target.db;
  try {
    if (options.mode === "inspect") {
      const report = await runPreflight(db);
      console.info(`environment=${config.environment} mode=inspect`);
      console.info(`counts=${JSON.stringify(report.counts)}`);
      console.info(`issues=${report.issues.join(",") || "none"}`);
      console.info(`notes=${report.notes.join(",") || "none"}`);
      return;
    }

    const pgClient = await openMigrationPgClient(options.targetConfigPath);
    try {
      const before = await captureLegacyFingerprint(pgClient);
      evidence!.write("before.json", before);
      console.info(`report=${evidence!.directory}`);
      const result = await backfill2026(db, before);
      const after = await captureLegacyFingerprint(pgClient);
      evidence!.write("after.json", after);
      const verified = await verifyBackfill(db, before, after);
      evidence!.write("result.json", { environment: config.environment, result, verified });

      console.info(`environment=${config.environment} mode=apply`);
      console.info(`inserted=${result.inserted}`);
      console.info(`blockingIssues=${result.blockingIssues.join(",") || "none"}`);
      console.info(`canEnable=${verified.canEnable} issues=${verified.issues.join(",") || "none"}`);
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
