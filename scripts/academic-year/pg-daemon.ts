// 이 파일은 독립 프로세스(detached child)로만 실행된다. `up` 명령이 spawn
// 하고 즉시 리턴하며, 이 프로세스는 postgres 하위 프로세스를 붙든 채로 계속
// 살아있는다 (embedded-postgres가 spawn()한 postgres 자식이 이벤트 루프를
// 참조 상태로 유지한다). `down`은 이 프로세스에 SIGINT를 보내 정상 종료시킨다.
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import {
  ACADEMIC_TEST_DATABASE,
  ACADEMIC_TEST_PASSWORD,
  ACADEMIC_TEST_PORT,
  ACADEMIC_TEST_USER,
} from "../../src/lib/academic-year/test-target";

const dataDir = process.argv[2];
const readyFilePath = process.argv[3];
const identitySqlPath = process.argv[4];

if (!dataDir || !readyFilePath || !identitySqlPath) {
  console.error("pg-daemon: dataDir, readyFilePath, identitySqlPath 인자가 필요합니다");
  process.exit(1);
}

const embedded = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: ACADEMIC_TEST_USER,
  password: ACADEMIC_TEST_PASSWORD,
  port: Number(ACADEMIC_TEST_PORT),
  persistent: false,
  onLog: () => {
    // 임베디드 postgres의 stdout 로그는 조용히 무시한다 (부모가 stdio:ignore로 spawn).
  },
});

async function main(): Promise<void> {
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase(ACADEMIC_TEST_DATABASE);

  const client = embedded.getPgClient(ACADEMIC_TEST_DATABASE);
  await client.connect();
  const identitySql = fs.readFileSync(identitySqlPath, "utf8");
  await client.query(identitySql);
  await client.end();

  fs.writeFileSync(readyFilePath, String(process.pid));
}

process.on("SIGINT", () => {
  void embedded.stop().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void embedded.stop().finally(() => process.exit(0));
});

main().catch((err) => {
  fs.writeFileSync(readyFilePath, `ERROR: ${String(err)}`);
  process.exit(1);
});
