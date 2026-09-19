// academic-year 전용 통합 테스트 DB를 켜고/마이그레이션하고/끄는 wrapper.
// `up` / `migrate` / `down` 세 명령만 허용한다. URL은 항상 이 프로세스
// 내부에서만 구성하며, 실행 결과로 출력하지 않는다. 운영 DATABASE_URL로는
// 절대 fallback하지 않는다.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  ACADEMIC_TEST_COMPOSE_PROJECT,
  ACADEMIC_TEST_DATABASE,
  ACADEMIC_TEST_DATABASE_URL,
  ACADEMIC_TEST_DOCKER_LABEL,
  ACADEMIC_TEST_HOST,
  ACADEMIC_TEST_IDENTITY_MARKER,
  ACADEMIC_TEST_PORT,
  ACADEMIC_TEST_USER,
  parseAcademicTestTarget,
} from "../../src/lib/academic-year/test-target";

const REPO_ROOT = path.resolve(__dirname, "../..");
const COMPOSE_FILE = path.join(REPO_ROOT, "compose.academic-year-test.yml");
const IDENTITY_SQL = path.join(REPO_ROOT, "tests/integration/sql/identity.sql");
const STATE_FILE = path.join(os.tmpdir(), "posanmeal-academic-year-test-db.json");

interface DaemonState {
  mode: "docker" | "embedded";
  pid?: number;
  dataDir?: string;
}

function hasDocker(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readState(): DaemonState | undefined {
  if (!fs.existsSync(STATE_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as DaemonState;
}

function writeState(state: DaemonState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function assertMarkerReachable(): Promise<void> {
  const url = parseAcademicTestTarget(ACADEMIC_TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    const identity = await client.query<{ db: string; usr: string }>(
      "SELECT current_database() AS db, current_user AS usr",
    );
    const row = identity.rows[0];
    if (row?.db !== ACADEMIC_TEST_DATABASE || row?.usr !== ACADEMIC_TEST_USER) {
      throw new Error("전용 테스트 DB 설정을 확인하세요");
    }
    const marker = await client.query("SELECT key FROM academic_meta.academic_test_identity WHERE key = $1", [
      ACADEMIC_TEST_IDENTITY_MARKER,
    ]);
    if (marker.rowCount !== 1) {
      throw new Error("전용 테스트 DB 설정을 확인하세요");
    }
  } finally {
    await client.end();
  }
}

async function waitFor(check: () => Promise<void>, timeoutMs: number, intervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("timed out waiting for academic test DB");
}

function dockerComposeArgs(...args: string[]): string[] {
  return ["compose", "-p", ACADEMIC_TEST_COMPOSE_PROJECT, "-f", COMPOSE_FILE, ...args];
}

async function upWithDocker(): Promise<void> {
  execFileSync("docker", dockerComposeArgs("up", "-d"), { stdio: "inherit", cwd: REPO_ROOT });

  const containerId = execFileSync("docker", dockerComposeArgs("ps", "-q", "academic-db"), { cwd: REPO_ROOT })
    .toString()
    .trim();
  if (!containerId) {
    throw new Error("academic-db 컨테이너를 찾을 수 없습니다");
  }

  const label = execFileSync("docker", [
    "inspect",
    "--format",
    `{{ index .Config.Labels "${ACADEMIC_TEST_DOCKER_LABEL}" }}`,
    containerId,
  ])
    .toString()
    .trim();
  if (label !== "true") {
    throw new Error("전용 테스트 DB 설정을 확인하세요");
  }

  const hostIp = execFileSync("docker", [
    "inspect",
    "--format",
    `{{ (index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp }}`,
    containerId,
  ])
    .toString()
    .trim();
  const hostPort = execFileSync("docker", [
    "inspect",
    "--format",
    `{{ (index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort }}`,
    containerId,
  ])
    .toString()
    .trim();
  if (hostIp !== ACADEMIC_TEST_HOST || hostPort !== ACADEMIC_TEST_PORT) {
    throw new Error("전용 테스트 DB 설정을 확인하세요");
  }

  await waitFor(assertMarkerReachable, 30_000, 500);
  writeState({ mode: "docker" });
}

async function downWithDocker(): Promise<void> {
  execFileSync("docker", dockerComposeArgs("down", "-v"), { stdio: "inherit", cwd: REPO_ROOT });
}

async function upWithEmbedded(): Promise<void> {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "posanmeal-academic-pg-"));
  const dataDir = path.join(tmpBase, "data");
  const readyFile = path.join(tmpBase, "READY");

  const daemonScript = path.join(__dirname, "pg-daemon.ts");
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "node_modules/.bin/tsx"), daemonScript, dataDir, readyFile, IDENTITY_SQL],
    { detached: true, stdio: "ignore", cwd: REPO_ROOT },
  );
  child.unref();

  await waitFor(async () => {
    if (!fs.existsSync(readyFile)) throw new Error("not ready yet");
    const content = fs.readFileSync(readyFile, "utf8");
    if (content.startsWith("ERROR")) throw new Error(content);
  }, 60_000, 500);

  await waitFor(assertMarkerReachable, 30_000, 500);

  writeState({ mode: "embedded", pid: child.pid, dataDir: tmpBase });
}

async function downWithEmbedded(state: DaemonState): Promise<void> {
  if (state.pid) {
    try {
      process.kill(state.pid, "SIGINT");
    } catch {
      // 이미 종료된 경우 무시
    }
    await waitFor(async () => {
      try {
        process.kill(state.pid!, 0);
        throw new Error("still running");
      } catch (err) {
        if (err instanceof Error && err.message === "still running") throw err;
        // ESRCH => 프로세스가 이미 종료됨
      }
    }, 15_000, 300).catch(() => undefined);
  }
  if (state.dataDir) {
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  }
}

async function up(): Promise<void> {
  if (readState()) {
    console.log("academic test db already up (state file present); skipping");
    return;
  }
  if (hasDocker()) {
    await upWithDocker();
    console.log("academic test db up (docker)");
  } else {
    await upWithEmbedded();
    console.log("academic test db up (embedded-postgres)");
  }
}

async function migrate(): Promise<void> {
  await assertMarkerReachable();
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--config", "tests/integration/prisma.config.ts"],
    {
      stdio: "inherit",
      cwd: REPO_ROOT,
      env: { ...process.env, ACADEMIC_TEST_DATABASE_URL },
    },
  );
}

async function down(): Promise<void> {
  const state = readState();
  if (!state) {
    console.log("academic test db not up; nothing to do");
    return;
  }
  if (state.mode === "docker") {
    await downWithDocker();
  } else {
    await downWithEmbedded(state);
  }
  fs.rmSync(STATE_FILE, { force: true });
  console.log("academic test db down");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "up":
      await up();
      break;
    case "migrate":
      await migrate();
      break;
    case "down":
      await down();
      break;
    default:
      console.error("usage: test-db.ts <up|migrate|down>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
