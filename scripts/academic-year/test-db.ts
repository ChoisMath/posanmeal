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

// waitFor와 달리 타임아웃을 예외로 던지지 않고 boolean으로 알려준다.
// 종료 대기처럼 "실패해도 다음 단계(SIGKILL 등)로 넘어가야 하는" 경우에 쓴다.
async function waitUntilTrue(check: () => Promise<boolean>, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function dockerComposeArgs(...args: string[]): string[] {
  return ["compose", "-p", ACADEMIC_TEST_COMPOSE_PROJECT, "-f", COMPOSE_FILE, ...args];
}

async function downWithDocker(): Promise<void> {
  execFileSync("docker", dockerComposeArgs("down", "-v"), { stdio: "inherit", cwd: REPO_ROOT });
}

async function upWithDocker(): Promise<void> {
  execFileSync("docker", dockerComposeArgs("up", "-d"), { stdio: "inherit", cwd: REPO_ROOT });

  try {
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
  } catch (err) {
    // 검증 실패 시 방금 띄운 컨테이너를 추적되지 않은 채로 남기지 않는다.
    try {
      execFileSync("docker", dockerComposeArgs("down", "-v"), { stdio: "inherit", cwd: REPO_ROOT });
    } catch (cleanupErr) {
      console.error(
        "docker compose down 실패 (수동 정리 필요):",
        cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
      );
    }
    throw err;
  }
}

// daemon은 detached spawn으로 자신이 곧 process group leader가 되므로
// (pid === pgid), 음수 pid로 시그널을 보내면 daemon과 그 아래 postgres
// 프로세스 트리 전체에 전달된다. daemon만 죽이면 postgres가 고아 프로세스로
// 남을 수 있어 그룹 전체를 대상으로 한다.
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // 그룹 시그널이 지원되지 않거나 이미 종료된 경우, 최소한 daemon 자체에는 시도한다.
    try {
      process.kill(pid, signal);
    } catch {
      // 이미 종료됨
    }
  }
}

async function teardownEmbeddedStartup(pid: number | undefined, tmpBase: string): Promise<void> {
  if (pid) {
    killProcessGroup(pid, "SIGKILL");
    await waitUntilTrue(async () => !isPidAlive(pid), 5_000, 200);
  }
  fs.rmSync(tmpBase, { recursive: true, force: true });
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

  try {
    await waitFor(async () => {
      if (!fs.existsSync(readyFile)) throw new Error("not ready yet");
      const content = fs.readFileSync(readyFile, "utf8");
      if (content.startsWith("ERROR")) throw new Error(content);
    }, 60_000, 500);

    await waitFor(assertMarkerReachable, 30_000, 500);
  } catch (err) {
    // 검증 실패 시 방금 띄운 detached daemon(및 그 postgres 자식)을
    // 추적되지 않은 채로 남기지 않는다.
    await teardownEmbeddedStartup(child.pid, tmpBase);
    throw err;
  }

  writeState({ mode: "embedded", pid: child.pid, dataDir: tmpBase });
}

/**
 * SIGINT로 정상 종료를 시도하고, 시간 안에 끝나지 않으면 프로세스 그룹
 * 전체를 SIGKILL한다. 그래도 살아있으면 데이터 디렉터리를 지우지 않고
 * (아직 postgres가 파일을 쓰고 있을 수 있으므로) 사람이 확인할 수 있게
 * 에러로 표면화한다 — 타임아웃을 조용히 삼키지 않는다.
 */
async function downWithEmbedded(state: DaemonState): Promise<void> {
  if (state.pid) {
    const pid = state.pid;
    killProcessGroup(pid, "SIGINT");
    const stoppedGracefully = await waitUntilTrue(async () => !isPidAlive(pid), 15_000, 300);

    if (!stoppedGracefully) {
      killProcessGroup(pid, "SIGKILL");
      const stoppedAfterKill = await waitUntilTrue(async () => !isPidAlive(pid), 5_000, 300);

      if (!stoppedAfterKill) {
        throw new Error(
          `academic test db daemon(pid=${pid})이 SIGKILL 이후에도 응답하지 않습니다. ` +
            `수동으로 프로세스를 정리한 뒤 ${state.dataDir ?? "임시 디렉터리"}를 삭제하세요.`,
        );
      }
    }
  }
  if (state.dataDir) {
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  }
}

async function probeStateIsLive(state: DaemonState): Promise<boolean> {
  try {
    if (state.mode === "embedded" && (!state.pid || !isPidAlive(state.pid))) {
      return false;
    }
    await assertMarkerReachable();
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleState(state: DaemonState): Promise<void> {
  try {
    if (state.mode === "docker") {
      execFileSync("docker", dockerComposeArgs("down", "-v"), { stdio: "inherit", cwd: REPO_ROOT });
    } else {
      await downWithEmbedded(state);
    }
  } catch (err) {
    console.warn(
      "오래된 academic test db 상태 정리 중 경고 (수동 확인 권장):",
      err instanceof Error ? err.message : err,
    );
  }
}

async function up(): Promise<void> {
  const existingState = readState();
  if (existingState) {
    if (await probeStateIsLive(existingState)) {
      console.log("academic test db already up; skipping");
      return;
    }
    console.warn("state file은 있지만 DB가 응답하지 않습니다. 정리 후 새로 시작합니다.");
    await cleanupStaleState(existingState);
    fs.rmSync(STATE_FILE, { force: true });
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
