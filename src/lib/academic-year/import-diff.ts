import { randomUUID } from "node:crypto";
import type {
  ImportScope,
  Profile,
  RosterRow,
  RowChange,
  RowIssue,
  YearState,
} from "./contracts";
import { normalizeEmail } from "./profile-schema";
import type { RosterRowView } from "./roster-service";
import type { ParsedRosterRow, ParsedRosterWorkbook } from "./workbook-parser";
import { ROW_TOKEN_HEADER, type WorkbookManifest } from "./workbook";

/**
 * 확정 때 "미리보기 이후 서버가 바뀌지 않았는가"를 다시 볼 기준. 행 버전은 확정
 * 연도면 `UserAcademicRecord.version`, 초안이면 `RosterEntry.version`이고,
 * `userVersion`은 확정 연도 쓰기가 함께 덮는 `User.profileVersion`이다.
 */
export interface ImportCheck {
  token: string;
  entryId: string | null;
  userId: number | null;
  rowVersion: number | null;
  userVersion: number | null;
}

export interface ExistingAccount {
  id: number;
  role: Profile["role"];
  accessState: string;
}

export interface DiffRosterImportInput {
  parsed: ParsedRosterWorkbook;
  year: number;
  state: YearState;
  scope: ImportScope;
  /** 그 학년도의 현재 명부 전체(제외된 행 포함). 한 번만 읽어서 메모리에서 대조한다. */
  roster: RosterRowView[];
  /** `includeData` 파일의 서버 대응표. 양식만 받은 파일은 null이다. */
  manifest: WorkbookManifest | null;
  /** 파일에 나온 이메일로 찾은 기존 계정. emailKey 기준. */
  accounts: Map<string, ExistingAccount>;
  /** 현재 `User.profileVersion`. 확정 연도 쓰기가 이 행도 함께 덮으므로 충돌 판정에 넣는다. */
  userVersions: Map<number, number>;
}

export interface DiffRosterImportResult {
  rows: RowChange[];
  checks: ImportCheck[];
  missingUserIds: number[];
  /** DRAFT + FULL 확정이 `included=false`로 표시할 후보. 그 밖에는 비어 있다. */
  omittedRows: RosterRow[];
  fileIssues: RowIssue[];
  canCommit: boolean;
}

const RE_DOWNLOAD = "명부를 다시 내려받아 사용하세요.";

function issue(source: ParsedRosterRow, column: string, code: string, message: string): RowIssue {
  return { sheet: source.sheet, row: source.row, column, code, message };
}

/** 교사 시트에는 성별 칸이 없다. 값이 오지 않은 자리는 "그대로 둔다"는 뜻이다. */
function sameProfile(file: Profile, server: Profile): boolean {
  const gender = file.role === "TEACHER" && file.gender === null ? server.gender : file.gender;
  return (
    file.role === server.role &&
    file.name === server.name &&
    file.grade === server.grade &&
    file.classNum === server.classNum &&
    file.number === server.number &&
    gender === server.gender &&
    file.subject === server.subject &&
    file.homeroom === server.homeroom &&
    file.position === server.position
  );
}

function rowFrom(current: RosterRowView, source: ParsedRosterRow, emailKey: string): RosterRow {
  return {
    entryId: current.entryId.length > 0 ? current.entryId : randomUUID(),
    userId: current.userId,
    email: source.email,
    emailKey,
    profile: source.profile,
    baseUserVersion: current.baseUserVersion,
    included: true,
  };
}

function checkFor(
  token: string,
  current: RosterRowView,
  state: YearState,
  userVersions: Map<number, number>,
): ImportCheck {
  return {
    token,
    entryId: current.entryId.length > 0 ? current.entryId : null,
    userId: current.userId,
    rowVersion: current.version,
    // 초안 쓰기는 `User`를 건드리지 않으므로 그 행의 버전으로 충돌을 판정하지 않는다.
    userVersion:
      state === "DRAFT" || current.userId === null
        ? null
        : userVersions.get(current.userId) ?? null,
  };
}

interface RosterIndex {
  byEntryId: Map<string, RosterRowView>;
  byUserId: Map<number, RosterRowView>;
  byEmailKey: Map<string, RosterRowView>;
}

function indexRoster(roster: RosterRowView[]): RosterIndex {
  const byEntryId = new Map<string, RosterRowView>();
  const byUserId = new Map<number, RosterRowView>();
  const byEmailKey = new Map<string, RosterRowView>();
  for (const row of roster) {
    if (row.entryId.length > 0) byEntryId.set(row.entryId, row);
    if (row.userId !== null) byUserId.set(row.userId, row);
    byEmailKey.set(row.emailKey, row);
  }
  return { byEntryId, byUserId, byEmailKey };
}

/**
 * 순수 대조. DB에 닿지 않고 파일·현재 명부·서버 대응표만으로 행 종류를 정한다.
 * 어느 행도 이름 유사도나 학번으로 사람을 추측해 묶지 않는다 — 대응표의 토큰이나
 * 정규화 이메일이 유일한 연결 근거다.
 */
export function diffRosterImport(input: DiffRosterImportInput): DiffRosterImportResult {
  const { parsed, state, scope, manifest, accounts } = input;
  const index = indexRoster(input.roster);

  const rows: RowChange[] = [];
  const checks: ImportCheck[] = [];
  const matchedEntryIds = new Set<string>();
  const matchedUserIds = new Set<number>();

  for (const source of parsed.rows) {
    const emailKey = normalizeEmail(source.email);
    const token = randomUUID();
    const issues: RowIssue[] = [];

    const review = (change: Omit<RowChange, "token">): void => {
      rows.push({ ...change, token });
    };

    const current = source.rowToken
      ? resolveByToken(source, manifest, index, issues)
      : resolveByEmail(source, emailKey, parsed.templateOnly, index, issues);

    if (issues.length > 0) {
      review({
        kind: "REVIEW",
        input: {
          entryId: current?.entryId ?? randomUUID(),
          userId: current?.userId ?? null,
          email: source.email,
          emailKey,
          profile: source.profile,
          baseUserVersion: current?.baseUserVersion ?? null,
          included: true,
        },
        before: current?.profile ?? null,
        issues,
      });
      continue;
    }

    if (current) {
      if (current.entryId.length > 0) matchedEntryIds.add(current.entryId);
      if (current.userId !== null) matchedUserIds.add(current.userId);

      const row = rowFrom(current, source, emailKey);
      checks.push(checkFor(token, current, state, input.userVersions));

      const seen = source.rowToken ? manifest?.rows[source.rowToken]?.version : undefined;
      if (seen !== undefined && seen !== current.version) {
        review({
          kind: "CONFLICT",
          input: row,
          before: current.profile,
          issues: [],
          server: current.profile,
        });
        continue;
      }

      review({
        kind: sameProfile(source.profile, current.profile) ? "SAME" : "CHANGED",
        input: row,
        before: current.profile,
        issues: [],
      });
      continue;
    }

    const account = accounts.get(emailKey);
    const blocked = newRowIssue(source, account);
    if (blocked) {
      review({
        kind: "REVIEW",
        input: {
          entryId: randomUUID(),
          userId: account?.id ?? null,
          email: source.email,
          emailKey,
          profile: source.profile,
          baseUserVersion: null,
          included: true,
        },
        before: null,
        issues: [blocked],
      });
      continue;
    }

    review({
      kind: "NEW",
      input: {
        entryId: randomUUID(),
        userId: account?.id ?? null,
        email: source.email,
        emailKey,
        profile: source.profile,
        baseUserVersion: null,
        included: true,
      },
      before: null,
      issues: [],
    });
  }

  const { missingUserIds, omittedRows } = omissionsOf(
    input,
    matchedEntryIds,
    matchedUserIds,
    scope,
    state,
  );

  return {
    rows,
    checks,
    missingUserIds,
    omittedRows,
    fileIssues: parsed.issues,
    canCommit: canCommitWith(rows, parsed.issues),
  };
}

function resolveByToken(
  source: ParsedRosterRow,
  manifest: WorkbookManifest | null,
  index: RosterIndex,
  issues: RowIssue[],
): RosterRowView | null {
  const token = source.rowToken as string;
  const entry = manifest?.rows[token];
  if (!entry) {
    issues.push(
      issue(source, ROW_TOKEN_HEADER, "UNKNOWN_ROW_TOKEN", `이 행을 서버 기록과 맞출 수 없습니다. ${RE_DOWNLOAD}`),
    );
    return null;
  }

  const current =
    (entry.entryId.length > 0 ? index.byEntryId.get(entry.entryId) : undefined) ??
    (entry.userId !== null ? index.byUserId.get(entry.userId) : undefined) ??
    null;

  if (!current) {
    issues.push(
      issue(source, ROW_TOKEN_HEADER, "ROW_GONE", `이 행은 서버 명부에서 사라졌습니다. ${RE_DOWNLOAD}`),
    );
    return null;
  }

  const originalKey = normalizeEmail(entry.email);
  if (originalKey !== normalizeEmail(source.email) || originalKey !== current.emailKey) {
    issues.push(
      issue(
        source,
        "이메일",
        "IDENTITY_CONFLICT",
        "이 행의 이메일이 바뀌었습니다. 이메일 변경은 사용자 관리의 이메일 변경 절차를 사용하세요.",
      ),
    );
    return null;
  }

  return current;
}

/**
 * 토큰이 없는 행. 양식만 받은 파일에 관리자가 직접 적어 넣은 기존 이메일은 그
 * 사람의 수정으로 보지만, 데이터가 담겨 나갔던 파일에서 토큰이 지워진 행은
 * 신규로 추정하지 않는다 — 그 추정은 계정을 하나 더 만드는 쪽으로 틀린다.
 */
function resolveByEmail(
  source: ParsedRosterRow,
  emailKey: string,
  templateOnly: boolean,
  index: RosterIndex,
  issues: RowIssue[],
): RosterRowView | null {
  const current = index.byEmailKey.get(emailKey);
  if (!current) return null;

  if (!templateOnly) {
    issues.push(
      issue(source, ROW_TOKEN_HEADER, "ROW_TOKEN_MISSING", `행 표시가 지워진 파일입니다. ${RE_DOWNLOAD}`),
    );
    return null;
  }
  return current;
}

function newRowIssue(source: ParsedRosterRow, account: ExistingAccount | undefined): RowIssue | null {
  if (!account) return null;
  if (account.accessState !== "ACTIVE") {
    return issue(
      source,
      "이메일",
      "ACCOUNT_INACTIVE",
      "이용이 중지된 계정의 이메일입니다. 계정 상태를 먼저 정리한 뒤 다시 올려주세요.",
    );
  }
  if (account.role !== source.profile.role) {
    return issue(
      source,
      "이메일",
      "ROLE_MISMATCH",
      "이 이메일은 다른 역할의 계정이 쓰고 있습니다. 역할 변경은 사용자 관리에서 처리하세요.",
    );
  }
  return null;
}

function omissionsOf(
  input: DiffRosterImportInput,
  matchedEntryIds: Set<string>,
  matchedUserIds: Set<number>,
  scope: ImportScope,
  state: YearState,
): { missingUserIds: number[]; omittedRows: RosterRow[] } {
  if (scope !== "FULL") return { missingUserIds: [], omittedRows: [] };

  const covered = new Set(input.parsed.coveredRoles);
  const omitted = input.roster.filter(
    (row) =>
      row.included &&
      covered.has(row.profile.role) &&
      !(row.entryId.length > 0 && matchedEntryIds.has(row.entryId)) &&
      !(row.userId !== null && matchedUserIds.has(row.userId)),
  );

  return {
    missingUserIds: omitted.map((row) => row.userId).filter((id): id is number => id !== null),
    omittedRows:
      state === "DRAFT"
        ? omitted.map((row) => ({
            entryId: row.entryId,
            userId: row.userId,
            email: row.email,
            emailKey: row.emailKey,
            profile: row.profile,
            baseUserVersion: row.baseUserVersion,
            included: false,
          }))
        : [],
  };
}

/** 확정 버튼을 열어 줄 조건. 신규 행은 여기서 막지 않고 확정 때 토큰으로 확인받는다. */
export function canCommitWith(rows: RowChange[], fileIssues: RowIssue[]): boolean {
  if (fileIssues.length > 0) return false;
  return rows.every(
    (row) =>
      row.issues.length === 0 &&
      row.kind !== "REVIEW" &&
      (row.kind !== "CONFLICT" || row.resolution !== undefined),
  );
}
