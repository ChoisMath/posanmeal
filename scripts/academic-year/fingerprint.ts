import crypto from "node:crypto";
import type { ClientBase } from "pg";
import legacyColumns from "./legacy-columns.json";

type ColumnType = "text" | "timestamp" | "date" | "json";

interface ColumnDef {
  name: string;
  type: ColumnType;
}

interface TableDef {
  pk: string[];
  columns: ColumnDef[];
}

const LEGACY_TABLES = legacyColumns as Record<string, TableDef>;

export const LEGACY_FINGERPRINT_FORMAT = "posanmeal-legacy-fingerprint";
export const LEGACY_FINGERPRINT_VERSION = 2;

export interface LegacyFingerprint {
  // 이전에 저장한 무버전 manifest도 읽되 비교 단계에서 명시적으로 거절한다.
  format?: string;
  version?: number;
  tables: Record<string, { count: number; pkHash: string; rowHash: string }>;
}

export interface LegacyFingerprintDiff {
  equal: boolean;
  differingTables: string[];
  formatMismatch?: boolean;
}

function columnExpr(column: ColumnDef): string {
  const quoted = `"${column.name}"`;
  switch (column.type) {
    case "timestamp":
      return `to_char(${quoted}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    case "date":
      return `to_char(${quoted}, 'YYYY-MM-DD')`;
    case "json":
      // jsonb 컬럼은 저장 시 이미 정규화되므로 ::jsonb::text 로 캐스팅해
      // 항상 동일한 정렬·표기의 텍스트를 얻는다.
      return `${quoted}::jsonb::text`;
    case "text":
    default:
      return `${quoted}::text`;
  }
}

async function fingerprintTable(
  pgClient: ClientBase,
  tableName: string,
  def: TableDef,
): Promise<{ count: number; pkHash: string; rowHash: string }> {
  const pkExprs = def.pk.map((name) => columnExpr({
    name, type: def.columns.find((column) => column.name === name)?.type ?? "text",
  }));
  const colExprs = def.columns.map(columnExpr);
  const orderBy = def.pk.map((name) => `"${name}"`).join(", ");

  const sql = `
    SELECT
      json_build_array(${pkExprs.join(", ")})::text AS pk_text,
      json_build_array(${colExprs.join(", ")})::text AS row_text
    FROM "${tableName}"
    ORDER BY ${orderBy}
  `;

  const result = await pgClient.query(sql);
  const pkLines = result.rows.map((row: { pk_text: string }) => row.pk_text);
  const rowLines = result.rows.map(
    (row: { pk_text: string; row_text: string }) => [row.pk_text, row.row_text],
  );

  return {
    count: result.rows.length,
    // 저장 가능한 제어문자나 개행이 열·행 경계로 해석되지 않도록 두 경계 모두 인코딩한다.
    pkHash: sha256(JSON.stringify(pkLines)),
    rowHash: sha256(JSON.stringify(rowLines)),
  };
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * repeatable-read/read-only 트랜잭션으로 스냅샷을 떠서 여러 테이블을
 * 읽는 도중 다른 트랜잭션의 변경이 섞이지 않게 한다.
 */
export async function captureLegacyFingerprint(pgClient: ClientBase): Promise<LegacyFingerprint> {
  await pgClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await pgClient.query("SET LOCAL TIME ZONE 'UTC'");
    const tables: LegacyFingerprint["tables"] = {};
    for (const [tableName, def] of Object.entries(LEGACY_TABLES)) {
      tables[tableName] = await fingerprintTable(pgClient, tableName, def);
    }
    await pgClient.query("COMMIT");
    return { format: LEGACY_FINGERPRINT_FORMAT, version: LEGACY_FINGERPRINT_VERSION, tables };
  } catch (err) {
    await pgClient.query("ROLLBACK");
    throw err;
  }
}

export function compareLegacyFingerprints(a: LegacyFingerprint, b: LegacyFingerprint): LegacyFingerprintDiff {
  if ([a, b].some((value) => value.format !== LEGACY_FINGERPRINT_FORMAT || value.version !== LEGACY_FINGERPRINT_VERSION)) {
    return { equal: false, differingTables: [], formatMismatch: true };
  }
  const tableNames = new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]);
  const differingTables: string[] = [];

  for (const tableName of tableNames) {
    const left = a.tables[tableName];
    const right = b.tables[tableName];
    const isDifferent =
      !left ||
      !right ||
      left.count !== right.count ||
      left.pkHash !== right.pkHash ||
      left.rowHash !== right.rowHash;
    if (isDifferent) {
      differingTables.push(tableName);
    }
  }

  differingTables.sort();

  return { equal: differingTables.length === 0, differingTables };
}
