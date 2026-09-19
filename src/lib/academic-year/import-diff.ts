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
 * 확정 때 "미리보기가 본 값이 그대로인가"를 다시 볼 기준. 명부 행이 있는 경우의
 * 행 버전은 확정 연도면 `UserAcademicRecord.version`, 초안이면 `RosterEntry.version`
 * 이고, `userVersion`은 확정 연도 쓰기가 함께 덮는 `User.profileVersion`이다.
 *
 * 그 해 명부에 아직 없는 행도 검사 대상이다 — 기존 계정을 가리키면 그 계정이
 * (버전·이용 상태·역할 모두) 그대로여야 하고, 아무 계정도 없던 이메일이면
 * 확정 시점에도 비어 있어야 한다.
 */
export interface ImportCheck {
  token: string;
  entryId: string | null;
  userId: number | null;
  rowVersion: number | null;
  userVersion: number | null;
  /** 기존 계정을 가리키는 행에서 그 계정이 유지해야 하는 이용 상태·역할. */
  accessState: string | null;
  role: Profile["role"] | null;
  /** 확정 시점에도 아무 계정이 쓰지 않아야 하는 이메일. */
  requireEmailFree: string | null;
}

export interface ExistingAccount {
  id: number;
  role: Profile["role"];
  accessState: string;
  profileVersion: number;
  /** `User` 행이 현재 담고 있는 값. 확정 연도의 신규 편입 행이 무엇을 덮는지 보여 준다. */
  profile: Profile;
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
  /**
   * DRAFT + FULL 확정이 `included=false`로 표시할 초안 항목. 값이 아니라 id만
   * 넘긴다 — 누락된 사람의 이름·이메일은 확정 때 쓰지 않는다.
   */
  omittedEntryIds: string[];
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

function memberCheck(
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
    accessState: null,
    role: null,
    requireEmailFree: null,
  };
}

function newRowCheck(
  token: string,
  emailKey: string,
  account: ExistingAccount | undefined,
  state: YearState,
): ImportCheck {
  if (!account) {
    return {
      token,
      entryId: null,
      userId: null,
      rowVersion: null,
      userVersion: null,
      accessState: null,
      role: null,
      requireEmailFree: emailKey,
    };
  }
  return {
    token,
    entryId: null,
    userId: account.id,
    rowVersion: null,
    userVersion: state === "DRAFT" ? null : account.profileVersion,
    accessState: account.accessState,
    role: account.role,
    requireEmailFree: null,
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

/** 한 파일 행의 판정 결과. 같은 사람을 두 번 가리키는 파일을 뒤에서 걸러내려고 근거를 들고 있는다. */
interface DiffEntry {
  source: ParsedRosterRow;
  change: RowChange;
  check: ImportCheck | null;
  /** 이 행이 가리킨 사람. 같은 값이 두 번 나오면 파일이 한 사람을 두 줄로 적은 것이다. */
  subject: string | null;
}

/**
 * 순수 대조. DB에 닿지 않고 파일·현재 명부·서버 대응표만으로 행 종류를 정한다.
 * 어느 행도 이름 유사도나 학번으로 사람을 추측해 묶지 않는다 — 대응표의 토큰이나
 * 정규화 이메일이 유일한 연결 근거다.
 */
export function diffRosterImport(input: DiffRosterImportInput): DiffRosterImportResult {
  const { parsed, state, scope, manifest, accounts } = input;
  const index = indexRoster(input.roster);
  const entries: DiffEntry[] = [];

  for (const source of parsed.rows) {
    const emailKey = normalizeEmail(source.email);
    const token = randomUUID();
    const issues: RowIssue[] = [];

    const current = source.rowToken
      ? resolveByToken(source, manifest, index, issues)
      : resolveByEmail(source, emailKey, parsed.templateOnly, index, issues);

    if (current && current.profile.role !== source.profile.role) {
      issues.push(issue(source, "이메일", "ROLE_MISMATCH", "기존 명부와 다른 역할의 시트에 있습니다. 원래 역할의 시트에서 수정하세요."));
    }

    if (issues.length > 0) {
      entries.push({
        source,
        check: null,
        subject: null,
        change: {
          kind: "REVIEW",
          token,
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
        },
      });
      continue;
    }

    if (current) {
      const row = rowFrom(current, source, emailKey);
      const seen = source.rowToken ? manifest?.rows[source.rowToken]?.version : undefined;
      const conflicted = seen !== undefined && seen !== current.version;

      entries.push({
        source,
        check: memberCheck(token, current, state, input.userVersions),
        subject: subjectKeyOf(current.entryId, current.userId),
        change: conflicted
          ? {
              kind: "CONFLICT",
              token,
              input: row,
              before: current.profile,
              issues: [],
              server: current.profile,
            }
          : {
              kind: sameProfile(source.profile, current.profile) ? "SAME" : "CHANGED",
              token,
              input: row,
              before: current.profile,
              issues: [],
            },
      });
      continue;
    }

    const account = accounts.get(emailKey);
    const blocked = newRowIssue(source, account);
    const newInput: RosterRow = {
      entryId: randomUUID(),
      userId: account?.id ?? null,
      email: source.email,
      emailKey,
      profile: source.profile,
      baseUserVersion: null,
      included: true,
    };

    entries.push({
      source,
      check: blocked ? null : newRowCheck(token, emailKey, account, state),
      subject: blocked ? null : subjectKeyOf(null, account?.id ?? null) ?? `email:${emailKey}`,
      change: blocked
        ? { kind: "REVIEW", token, input: newInput, before: null, issues: [blocked] }
        : {
            kind: "NEW",
            token,
            input: newInput,
            // 이미 있는 계정을 그 해 명부로 끌어오는 행이면 무엇을 덮게 되는지 보여 준다.
            before: account?.profile ?? null,
            issues: [],
          },
    });
  }

  flagDuplicateSubjects(entries);

  const matchedEntryIds = new Set<string>();
  const matchedUserIds = new Set<number>();
  for (const entry of entries) {
    if (entry.change.kind === "REVIEW") continue;
    const { entryId, userId } = entry.change.input;
    if (entryId.length > 0) matchedEntryIds.add(entryId);
    if (userId !== null) matchedUserIds.add(userId);
  }

  const { missingUserIds, omittedEntryIds, omittedChecks } = omissionsOf(
    input,
    matchedEntryIds,
    matchedUserIds,
    scope,
    state,
  );

  const rows = entries.map((entry) => entry.change);
  const checks = entries
    .map((entry) => entry.check)
    .filter((check): check is ImportCheck => check !== null);

  return {
    rows,
    checks: [...checks, ...omittedChecks],
    missingUserIds,
    omittedEntryIds,
    fileIssues: parsed.issues,
    canCommit: canCommitWith(rows, parsed.issues),
  };
}

function subjectKeyOf(entryId: string | null, userId: number | null): string | null {
  if (entryId !== null && entryId.length > 0) return `entry:${entryId}`;
  if (userId !== null) return `user:${userId}`;
  return null;
}

/**
 * 한 사람을 두 줄로 적은 파일(토큰 둘이 같은 행을 가리키거나, 토큰 있는 줄과
 * 토큰 없는 줄이 같은 사람을 가리키는 경우). 확정 때 일괄 쓰기의 식별 충돌로
 * 터지기 전에 두 줄 모두를 보여 주고 막는다.
 */
function flagDuplicateSubjects(entries: DiffEntry[]): void {
  const seen = new Map<string, DiffEntry[]>();
  for (const entry of entries) {
    if (entry.subject === null) continue;
    const bucket = seen.get(entry.subject);
    if (bucket) bucket.push(entry);
    else seen.set(entry.subject, [entry]);
  }

  for (const bucket of seen.values()) {
    if (bucket.length < 2) continue;
    for (const entry of bucket) {
      entry.check = null;
      entry.subject = null;
      entry.change = {
        ...entry.change,
        kind: "REVIEW",
        issues: [
          ...entry.change.issues,
          issue(
            entry.source,
            ROW_TOKEN_HEADER,
            "DUPLICATE_ROSTER_MATCH",
            "같은 사람을 가리키는 행이 여러 개입니다. 한 줄만 남긴 뒤 다시 올려주세요.",
          ),
        ],
      };
    }
  }
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

/**
 * 누락된 사람에게는 `included` 말고 아무것도 쓰지 않으므로 값을 실어 두지 않는다.
 * 다만 미리보기가 그 행의 버전을 봤다는 사실은 남겨, 목록을 보여 준 뒤 누군가
 * 그 사람을 고쳤다면 확정이 물리게 한다.
 */
function omissionsOf(
  input: DiffRosterImportInput,
  matchedEntryIds: Set<string>,
  matchedUserIds: Set<number>,
  scope: ImportScope,
  state: YearState,
): { missingUserIds: number[]; omittedEntryIds: string[]; omittedChecks: ImportCheck[] } {
  if (scope !== "FULL") return { missingUserIds: [], omittedEntryIds: [], omittedChecks: [] };

  const covered = new Set(input.parsed.coveredRoles);
  const omitted = input.roster.filter(
    (row) =>
      row.included &&
      covered.has(row.profile.role) &&
      !(row.entryId.length > 0 && matchedEntryIds.has(row.entryId)) &&
      !(row.userId !== null && matchedUserIds.has(row.userId)),
  );

  if (state !== "DRAFT") {
    return {
      missingUserIds: omitted.map((row) => row.userId).filter((id): id is number => id !== null),
      omittedEntryIds: [],
      omittedChecks: [],
    };
  }

  const withEntry = omitted.filter((row) => row.entryId.length > 0);
  return {
    missingUserIds: omitted.map((row) => row.userId).filter((id): id is number => id !== null),
    omittedEntryIds: withEntry.map((row) => row.entryId),
    omittedChecks: withEntry.map((row) => ({
      token: `omitted:${row.entryId}`,
      entryId: row.entryId,
      userId: row.userId,
      rowVersion: row.version,
      userVersion: null,
      accessState: null,
      role: null,
      requireEmailFree: null,
    })),
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
