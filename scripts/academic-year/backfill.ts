// 초기 이전 CLI. 기본은 읽기 전용 inspect이며, 쓰기는 승인된 대상 설정과
// 보호된 출력 경로를 모두 명시해야 한다. 출력에는 차이의 종류와 건수만 담고
// 이름·이메일·학번·연결 URL은 어떤 경우에도 내보내지 않는다.
import fs from "node:fs";
import path from "node:path";
import { backfill2026, runPreflight, verifyBackfill } from "../../src/lib/academic-year/backfill";
import { captureLegacyFingerprint } from "./fingerprint";
import {
  assertApplyAllowed,
  openMigrationPgClient,
  openMigrationTarget,
  parseCliArgs,
  readMigrationTargetConfig,
} from "./db-target";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.targetConfigPath) {
    throw new Error("--target-config를 지정하세요");
  }

  const config = readMigrationTargetConfig(options.targetConfigPath);
  assertApplyAllowed(options, config);

  const db = await openMigrationTarget(options.targetConfigPath);
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
      const result = await backfill2026(db, before);
      const after = await captureLegacyFingerprint(pgClient);
      const verified = await verifyBackfill(db, before, after);

      const reportDir = options.reportDir as string;
      fs.mkdirSync(reportDir, { recursive: true });
      const target = path.join(reportDir, `academic-backfill-${config.environment}-${Date.now()}.json`);
      fs.writeFileSync(
        target,
        JSON.stringify({ environment: config.environment, before, after, result, verified }, null, 2),
      );

      console.info(`environment=${config.environment} mode=apply`);
      console.info(`inserted=${result.inserted}`);
      console.info(`blockingIssues=${result.blockingIssues.join(",") || "none"}`);
      console.info(`canEnable=${verified.canEnable} issues=${verified.issues.join(",") || "none"}`);
    } finally {
      await pgClient.end();
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "초기 이전 CLI 실패");
    process.exitCode = 1;
  });
}
