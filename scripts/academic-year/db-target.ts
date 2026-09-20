// 초기 이전 CLI가 닿을 수 있는 DB를 좁히는 관문. 운영 `.env`나 DATABASE_URL로는
// 절대 fallback하지 않고, 승인된 대상 설정 파일과 전부 일치할 때만 연결한다.
import fs from "node:fs";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const REJECTION_MESSAGE = "승인된 이전 대상 설정과 일치하지 않습니다";

export const MIGRATION_URL_ENV = "ACADEMIC_MIGRATION_DATABASE_URL";

// 식별자 보간을 피하기 위해 marker 조회 SQL은 고정 문자열 두 개 중 하나만 고른다.
const MARKER_SQL = {
  test: "SELECT key FROM academic_meta.academic_test_identity WHERE key = $1",
  operations: "SELECT key FROM academic_meta.academic_identity WHERE key = $1",
} as const;

export type MarkerScope = keyof typeof MARKER_SQL;

export interface MigrationTargetConfig {
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  markerScope: MarkerScope;
  marker: string;
  /** 백업/복원 확인 report ID. 없으면 apply를 실행하지 않는다. */
  restoreReportId: string | null;
}

export interface CliOptions {
  mode: "inspect" | "apply";
  targetConfigPath: string | null;
  reportDir: string | null;
  beforePath: string | null;
  surveyConfirmationsPath: string | null;
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(REJECTION_MESSAGE);
  }
  return value;
}

export function parseMigrationTargetConfig(raw: unknown): MigrationTargetConfig {
  if (typeof raw !== "object" || raw === null) throw new Error(REJECTION_MESSAGE);
  const source = raw as Record<string, unknown>;

  const markerScope = requiredString(source, "markerScope");
  if (!(markerScope in MARKER_SQL)) throw new Error(REJECTION_MESSAGE);

  const port = source.port;
  if (typeof port !== "number" || !Number.isInteger(port)) throw new Error(REJECTION_MESSAGE);

  const restoreReportId = source.restoreReportId;
  if (restoreReportId !== null && typeof restoreReportId !== "string") throw new Error(REJECTION_MESSAGE);

  return {
    environment: requiredString(source, "environment"),
    host: requiredString(source, "host"),
    port,
    database: requiredString(source, "database"),
    username: requiredString(source, "username"),
    markerScope: markerScope as MarkerScope,
    marker: requiredString(source, "marker"),
    restoreReportId: restoreReportId === "" ? null : restoreReportId,
  };
}

export function readMigrationTargetConfig(configPath: string): MigrationTargetConfig {
  return parseMigrationTargetConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

/** 연결 전 단계. 실패 메시지에 URL을 담지 않는다. */
export function assertUrlMatchesTarget(rawUrl: string, config: MigrationTargetConfig): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(REJECTION_MESSAGE);
  }

  const matches =
    url.hostname === config.host &&
    url.port === String(config.port) &&
    url.username === config.username &&
    url.pathname === `/${config.database}`;

  if (!matches) throw new Error(REJECTION_MESSAGE);
  return url;
}

export function parseCliArgs(argv: string[], allowSurveyConfirmations = false): CliOptions {
  const options: CliOptions = {
    mode: "inspect", targetConfigPath: null, reportDir: null, beforePath: null, surveyConfirmationsPath: null,
  };

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`값이 없는 인자: ${flag}`);

    switch (flag) {
      case "--mode":
        if (value !== "inspect" && value !== "apply") throw new Error(`알 수 없는 mode: ${value}`);
        options.mode = value;
        break;
      case "--target-config":
        options.targetConfigPath = value;
        break;
      case "--report-dir":
        options.reportDir = value;
        break;
      case "--before":
        options.beforePath = value;
        break;
      case "--survey-confirmations":
        if (!allowSurveyConfirmations || options.surveyConfirmationsPath !== null) {
          throw new Error("희망조사 확인 인자는 backfill apply에서 한 번만 지정할 수 있습니다");
        }
        options.surveyConfirmationsPath = value;
        break;
      default:
        throw new Error(`알 수 없는 인자: ${flag}`);
    }
  }

  if (options.mode === "apply" && (!options.targetConfigPath || !options.reportDir)) {
    throw new Error("--mode apply는 --target-config와 --report-dir를 모두 요구합니다");
  }
  if (options.surveyConfirmationsPath !== null && options.mode !== "apply") {
    throw new Error("희망조사 확인 인자는 backfill apply에서만 허용됩니다");
  }

  return options;
}

export function assertApplyAllowed(options: CliOptions, config: MigrationTargetConfig): void {
  if (options.mode !== "apply") return;
  if (!config.restoreReportId) {
    throw new Error("복원 검증 report ID가 없는 대상에는 apply를 실행하지 않습니다");
  }
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const PRISMA_CODE_PATTERN = /^P\d{4}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * CLI 출력용 안전 표기. 에러 message/detail에는 제약 위반 값(이메일 등)이
 * 섞여 나올 수 있으므로 종류만 남기고 원문은 절대 내보내지 않는다.
 */
export function safeErrorKind(error: unknown): string {
  const name = readField(error, "name");
  const code = readField(error, "code");

  if (name === "DomainError" && typeof code === "string") return `DomainError:${code}`;
  if (typeof code === "string" && PRISMA_CODE_PATTERN.test(code)) return `Prisma:${code}`;
  if (typeof code === "string" && SQLSTATE_PATTERN.test(code)) {
    const constraint = readField(error, "constraint");
    return typeof constraint === "string" && IDENTIFIER_PATTERN.test(constraint)
      ? `Postgres:${code}:${constraint}`
      : `Postgres:${code}`;
  }
  return "Error:UNKNOWN";
}

async function assertMarker(client: pg.ClientBase, config: MigrationTargetConfig): Promise<void> {
  const identity = await client.query<{ db: string; usr: string }>(
    "SELECT current_database() AS db, current_user AS usr",
  );
  const row = identity.rows[0];
  if (row?.db !== config.database || row?.usr !== config.username) {
    throw new Error(REJECTION_MESSAGE);
  }

  const marker = await client.query(MARKER_SQL[config.markerScope], [config.marker]);
  if (marker.rowCount !== 1) {
    throw new Error(REJECTION_MESSAGE);
  }
}

export interface MigrationTarget {
  db: PrismaClient;
  /** 외부에서 만든 pool은 Prisma가 닫지 않으므로 호출자가 직접 끊는다. */
  close: () => Promise<void>;
}

/**
 * 연결 전 URL 대조와 연결 후 current_database/current_user/marker 대조를 모두
 * 통과한 뒤에만 client를 돌려준다. marker를 새로 만들지 않는다.
 */
export async function openMigrationTarget(configPath: string): Promise<MigrationTarget> {
  const config = readMigrationTargetConfig(configPath);
  const rawUrl = process.env[MIGRATION_URL_ENV];
  if (!rawUrl) {
    throw new Error(`${MIGRATION_URL_ENV}가 설정되어 있지 않습니다`);
  }

  const url = assertUrlMatchesTarget(rawUrl, config);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  const probe = await pool.connect();
  try {
    await assertMarker(probe, config);
  } catch (error) {
    probe.release();
    await pool.end();
    throw error;
  }
  probe.release();

  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    db,
    close: async () => {
      await db.$disconnect();
      await pool.end();
    },
  };
}

/** fingerprint 계산처럼 raw SQL이 필요한 경로용. 같은 가드를 다시 적용한다. */
export async function openMigrationPgClient(configPath: string): Promise<pg.Client> {
  const config = readMigrationTargetConfig(configPath);
  const rawUrl = process.env[MIGRATION_URL_ENV];
  if (!rawUrl) {
    throw new Error(`${MIGRATION_URL_ENV}가 설정되어 있지 않습니다`);
  }

  const url = assertUrlMatchesTarget(rawUrl, config);
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await assertMarker(client, config);
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}
