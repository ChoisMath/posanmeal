import { enableAcademicMode, inspectAcademicMode } from "../../src/lib/academic-year/readiness";
import { captureLegacyFingerprint } from "./fingerprint";
import { createMigrationReport } from "./report";
import { assertApplyAllowed, openMigrationPgClient, openMigrationTarget, parseCliArgs, readMigrationTargetConfig, safeErrorKind } from "./db-target";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.targetConfigPath) throw new Error("--target-config를 지정하세요");
  const config = readMigrationTargetConfig(options.targetConfigPath);
  assertApplyAllowed(options, config);
  const evidence = options.mode === "apply" ? createMigrationReport(options.reportDir!) : null;
  const target = await openMigrationTarget(options.targetConfigPath);
  try {
    if (evidence) {
      const pgClient = await openMigrationPgClient(options.targetConfigPath);
      try {
        evidence.write("before.json", await captureLegacyFingerprint(pgClient));
        console.info(`report=${evidence.directory}`);
        await enableAcademicMode(target.db, { kind: "MAIN", userId: null, sessionVersion: null });
        evidence.write("after.json", await captureLegacyFingerprint(pgClient));
      } finally {
        await pgClient.end();
      }
    }
    const readiness = await inspectAcademicMode(target.db);
    evidence?.write("result.json", { environment: config.environment, ...readiness });
    console.info(`environment=${config.environment} mode=${options.mode} operation=enable`);
    console.info(`rosterMode=${readiness.mode} canEnable=${readiness.canEnable}`);
    console.info(`issues=${readiness.issues.join(",") || "none"}`);
    if (readiness.issues.length > 0) process.exitCode = 1;
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
