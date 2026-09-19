import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { assertActor } from "./access";
import type {
  Actor,
  ImportPreview,
  ImportScope,
  MutationInput,
  MutationReceipt,
  MutationSummary,
  Profile,
  RosterRow,
  RowChange,
  YearState,
} from "./contracts";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import {
  canCommitWith,
  diffRosterImport,
  type ExistingAccount,
  type ImportCheck,
} from "./import-diff";
import { ROSTER_TX, withAcademicMutation } from "./mutation";
import { normalizeEmail } from "./profile-schema";
import { requireAcademicReady } from "./readiness";
import {
  excludeDraftEntries,
  listRosterView,
  readYearState,
  writeRosterProfiles,
} from "./roster-service";
import type { WorkbookManifest } from "./workbook";
import { parseRosterWorkbook } from "./workbook-parser";

export const IMPORT_MUTATION_KIND = "ROSTER_IMPORT";

const PREVIEW = "PREVIEW";
const COMMITTED = "COMMITTED";
const CANCELLED = "CANCELLED";

/**
 * 확정 때 다시 볼 값. 확정 요청 본문은 행 값을 담지 않으므로, 무엇을 쓸지는
 * 전적으로 서버에 보관된 이 payload와 preview가 정한다. 명부 원본이 들어 있어
 * 24시간 뒤 또는 확정·취소와 동시에 비워진다.
 */
interface ImportPayload extends Prisma.InputJsonObject {
  checks: ImportCheck[] & Prisma.InputJsonArray;
  /** 파일에 없던 초안 항목의 id. 값은 담지 않는다 — 확정은 included만 쓴다. */
  omittedEntryIds: string[] & Prisma.InputJsonArray;
  templateOnly: boolean;
}

type Summary = MutationSummary & Prisma.InputJsonObject;

export interface CommitRosterImportInput extends MutationInput {
  importId: string;
  /** 경로가 가리킨 학년도. 보관된 미리보기의 학년도와 다르면 확정하지 않는다. */
  year: number;
  confirmedNewRowTokens: string[];
  omissionsConfirmed: boolean;
}

// ---------------------------------------------------------------------------
// 미리보기
// ---------------------------------------------------------------------------

const ACCOUNTS_SQL = `
  SELECT u."id", u."role"::text AS "role", u."accessState", u."profileVersion",
         u."name", u."grade", u."classNum", u."number", u."gender"::text AS "gender",
         u."subject", u."homeroom", u."position",
         COALESCE(u."emailKey", lower(btrim(u."email"))) AS "emailKey"
  FROM "User" u
  WHERE COALESCE(u."emailKey", lower(btrim(u."email"))) = ANY($1::text[])
`;

interface AccountRow {
  id: number;
  role: Profile["role"];
  accessState: string;
  profileVersion: number;
  emailKey: string;
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
}

function accountOf(row: AccountRow): ExistingAccount {
  return {
    id: row.id,
    role: row.role,
    accessState: row.accessState,
    profileVersion: row.profileVersion,
    profile: {
      role: row.role,
      name: row.name,
      grade: row.grade,
      classNum: row.classNum,
      number: row.number,
      gender: row.gender,
      subject: row.subject,
      homeroom: row.homeroom,
      position: row.position,
    },
  };
}

async function loadAccounts(db: Db, emailKeys: string[]): Promise<Map<string, ExistingAccount>> {
  if (emailKeys.length === 0) return new Map();
  const rows = await db.$queryRawUnsafe<AccountRow[]>(ACCOUNTS_SQL, emailKeys);
  return new Map(rows.map((row) => [row.emailKey, accountOf(row)]));
}

async function loadUserVersions(db: Db, userIds: number[]): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: number; profileVersion: number }[]>`
    SELECT "id", "profileVersion" FROM "User" WHERE "id" = ANY(${userIds}::int[])
  `;
  return new Map(rows.map((row) => [row.id, row.profileVersion]));
}

function assertWritableYear(state: YearState): void {
  if (state === "ARCHIVED") {
    throw new DomainError(
      "YEAR_MISMATCH",
      "지난 학년도는 파일로 반영할 수 없습니다. 기록 정정 화면에서 한 건씩 고쳐주세요.",
    );
  }
}

/**
 * 파일을 읽어 행별 변화만 계산하고 서버에 보관한다. 아무것도 쓰지 않는다.
 * 학년도 버전이 파일 발행 뒤 움직였다는 이유로 파일 전체를 거절하지 않는다 —
 * 충돌은 언제나 행 단위로만 판정한다.
 */
export async function previewRosterImport(
  db: PrismaClient,
  actor: Actor,
  year: number,
  scope: ImportScope,
  file: ArrayBuffer,
): Promise<ImportPreview> {
  await assertActor(db, actor, "WRITE_ADMIN");
  await requireAcademicReady(db);

  const parsed = await parseRosterWorkbook(file);
  if (parsed.year !== year) {
    throw new DomainError("YEAR_MISMATCH", `이 파일은 ${parsed.year}학년도 명부입니다.`);
  }

  // 초안 행과 전환 후 control 버전을 섞으면 서로 다른 테이블의 행 버전이 우연히
  // 같아도 확정이 통과한다. 파일 파싱을 끝낸 뒤 모든 DB 근거를 한 시점에서 읽는다.
  return db.$transaction(async (tx) => {
    await assertActor(tx, actor, "WRITE_ADMIN");
    await requireAcademicReady(tx);
    const state = await readYearState(tx, year);
    assertWritableYear(state);

    let manifest: WorkbookManifest | null = null;
    if (!parsed.templateOnly) {
      const stored = await tx.rosterFile.findUnique({ where: { id: parsed.fileId } });
      if (!stored) {
        throw new DomainError(
          "INVALID_FILE",
          "이 파일의 서버 기록이 보존 기간(30일)이 지나 정리되었습니다. 명부를 다시 내려받아 사용하세요.",
        );
      }
      if (stored.year !== year) {
        throw new DomainError(
          "YEAR_MISMATCH",
          `이 파일은 ${stored.year}학년도 명부로 발행된 것입니다.`,
        );
      }
      manifest = stored.manifest as unknown as WorkbookManifest;
    }

    const roster = await listRosterView(tx, year, undefined, { includeExcluded: true });
    const emailKeys = [...new Set(parsed.rows.map((row) => normalizeEmail(row.email)))];
    const [accounts, userVersions] = await Promise.all([
      loadAccounts(tx, emailKeys),
      loadUserVersions(tx, roster.map((row) => row.userId).filter((id): id is number => id !== null)),
    ]);

    const diff = diffRosterImport({ parsed, year, state, scope, roster, manifest, accounts, userVersions });

    const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    const academicYear = await tx.academicYear.findUniqueOrThrow({ where: { year } });

    const id = randomUUID();
    const preview: ImportPreview = {
      id, year,
      controlVersion: control.version,
      yearVersion: academicYear.version,
      scope,
      rows: diff.rows,
      missingUserIds: diff.missingUserIds,
      coveredRoles: parsed.coveredRoles,
      canCommit: diff.canCommit,
      fileIssues: diff.fileIssues,
    };

    const payload: ImportPayload = {
      checks: diff.checks as ImportPayload["checks"],
      omittedEntryIds: diff.omittedEntryIds as ImportPayload["omittedEntryIds"],
      templateOnly: parsed.templateOnly,
    };

    await tx.rosterImport.create({ data: {
      id,
      year,
      scope,
      controlVersion: control.version,
      yearVersion: academicYear.version,
      state: PREVIEW,
      payload,
      preview: preview as unknown as Prisma.InputJsonObject,
    } });

    return preview;
  }, { ...ROSTER_TX, isolationLevel: "RepeatableRead" });
}

// ---------------------------------------------------------------------------
// 충돌 선택·취소
// ---------------------------------------------------------------------------

interface LoadedImport {
  id: string;
  year: number;
  scope: ImportScope;
  state: string;
  preview: ImportPreview;
  payload: ImportPayload;
}

async function loadPreviewImport(db: Db, year: number, importId: string): Promise<LoadedImport> {
  const row = await db.rosterImport.findUnique({ where: { id: importId } });
  if (!row) {
    throw new DomainError("MISSING_PROFILE", "미리보기를 찾을 수 없습니다.");
  }
  assertSameYear(year, row.year);
  if (row.state !== PREVIEW || row.preview === null || row.payload === null) {
    throw new DomainError(
      "VERSION_CONFLICT",
      "이 미리보기는 더 이상 유효하지 않습니다. 파일을 다시 올려주세요.",
    );
  }
  return {
    id: row.id,
    year: row.year,
    scope: row.scope as ImportScope,
    state: row.state,
    preview: row.preview as unknown as ImportPreview,
    payload: row.payload as unknown as ImportPayload,
  };
}

/** 화면이 보고 있는 학년도와 보관된 미리보기의 학년도가 어긋나면 손대지 않는다. */
function assertSameYear(expected: number, stored: number): void {
  if (expected !== stored) {
    throw new DomainError("YEAR_MISMATCH", "이 미리보기는 다른 학년도의 것입니다.");
  }
}

export async function resolveImportConflicts(
  db: PrismaClient,
  actor: Actor,
  year: number,
  importId: string,
  choices: Array<{ token: string; resolution: "USE_FILE" | "KEEP_SERVER" }>,
): Promise<ImportPreview> {
  await assertActor(db, actor, "WRITE_ADMIN");
  await requireAcademicReady(db);

  const loaded = await loadPreviewImport(db, year, importId);
  const byToken = new Map(choices.map((choice) => [choice.token, choice.resolution]));

  const rows: RowChange[] = loaded.preview.rows.map((row) => {
    const resolution = byToken.get(row.token);
    if (resolution === undefined) return row;
    if (row.kind !== "CONFLICT") {
      throw new DomainError("REVIEW_REQUIRED", "충돌이 아닌 행에는 선택을 저장할 수 없습니다.");
    }
    return { ...row, resolution };
  });

  const preview: ImportPreview = {
    ...loaded.preview,
    rows,
    canCommit: canCommitWith(rows, loaded.preview.fileIssues ?? []),
  };

  const updated = await db.rosterImport.updateMany({
    where: {
      id: importId,
      year,
      state: PREVIEW,
      preview: { equals: loaded.preview as unknown as Prisma.InputJsonObject },
    },
    data: { preview: preview as unknown as Prisma.InputJsonObject },
  });
  if (updated.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", "미리보기가 변경되었거나 종료되었습니다. 파일을 다시 올려주세요.");
  }

  return preview;
}

/** 취소는 기다리지 않고 바로 사본을 비운다. 보존 정리는 잊힌 미리보기만 맡는다. */
export async function cancelRosterImport(
  db: PrismaClient,
  actor: Actor,
  year: number,
  importId: string,
): Promise<void> {
  await assertActor(db, actor, "WRITE_ADMIN");
  await requireAcademicReady(db);

  const row = await db.rosterImport.findUnique({ where: { id: importId } });
  if (!row) {
    throw new DomainError("MISSING_PROFILE", "미리보기를 찾을 수 없습니다.");
  }
  assertSameYear(year, row.year);
  if (row.state === COMMITTED) {
    throw new DomainError("VERSION_CONFLICT", "이미 반영된 가져오기는 취소할 수 없습니다.");
  }

  const cancelled = await db.rosterImport.updateMany({
    where: { id: importId, year, state: { not: COMMITTED } },
    data: { state: CANCELLED, payload: Prisma.DbNull, preview: Prisma.DbNull },
  });
  if (cancelled.count !== 1) {
    throw new DomainError("VERSION_CONFLICT", "이미 반영되었거나 삭제된 가져오기는 취소할 수 없습니다.");
  }
}

// ---------------------------------------------------------------------------
// 확정
// ---------------------------------------------------------------------------

function assertReviewed(preview: ImportPreview, confirmed: Set<string>): void {
  if (!preview.canCommit || (preview.fileIssues ?? []).length > 0) {
    throw new DomainError("REVIEW_REQUIRED", "확인이 필요한 행이 남아 있습니다.");
  }
  for (const row of preview.rows) {
    if (row.issues.length > 0 || row.kind === "REVIEW") {
      throw new DomainError("REVIEW_REQUIRED", "확인이 필요한 행이 남아 있습니다.");
    }
    if (row.kind === "CONFLICT" && row.resolution === undefined) {
      throw new DomainError("REVIEW_REQUIRED", "충돌한 행의 선택이 남아 있습니다.");
    }
    if (row.kind === "NEW" && !confirmed.has(row.token)) {
      throw new DomainError("REVIEW_REQUIRED", "새로 추가할 인원을 확인해 주세요.");
    }
  }
}

/**
 * 미리보기가 본 값이 그대로인지 다시 본다. 한 행이라도 움직였으면 관리자가 보지
 * 못한 값을 덮어쓰게 되므로 통째로 물린다 — 화면은 다시 미리보기부터 시작한다.
 */
async function assertNoDrift(tx: Tx, year: number, state: YearState, checks: ImportCheck[]): Promise<void> {
  if (checks.length === 0) return;

  const roster = await listRosterView(tx, year, undefined, { includeExcluded: true });
  const byEntryId = new Map(roster.filter((row) => row.entryId.length > 0).map((row) => [row.entryId, row]));
  const byUserId = new Map(
    roster.filter((row) => row.userId !== null).map((row) => [row.userId as number, row]),
  );

  const emailKeys = checks
    .map((check) => check.requireEmailFree)
    .filter((key): key is string => key !== null);
  const userIds = [...checkedUserIds(checks)];
  const [takenEmails, accountById, userVersions] = await Promise.all([
    loadAccounts(tx, emailKeys),
    loadAccountsById(tx, userIds),
    state === "DRAFT" ? Promise.resolve(new Map<number, number>()) : loadUserVersions(tx, userIds),
  ]);

  const stale = new DomainError(
    "VERSION_CONFLICT",
    "미리보기 이후 명부가 바뀌었습니다. 파일을 다시 올려 미리보기부터 진행하세요.",
  );

  for (const check of checks) {
    if (check.requireEmailFree !== null) {
      // 미리보기 때 비어 있던 이메일을 그 사이 누군가 차지했다.
      if (takenEmails.has(check.requireEmailFree)) throw stale;
      continue;
    }

    if (check.rowVersion === null) {
      // 그 해 명부에는 없지만 이미 있는 계정을 끌어오는 행.
      const account = check.userId !== null ? accountById.get(check.userId) : undefined;
      if (!account) throw stale;
      if (check.accessState !== null && account.accessState !== check.accessState) throw stale;
      if (account.accessState !== "ACTIVE") throw stale;
      if (check.role !== null && account.role !== check.role) throw stale;
      if (check.userVersion !== null && account.profileVersion !== check.userVersion) throw stale;
      continue;
    }

    const current =
      (check.entryId !== null ? byEntryId.get(check.entryId) : undefined) ??
      (check.userId !== null ? byUserId.get(check.userId) : undefined);
    if (!current || current.version !== check.rowVersion) throw stale;
    if (check.userVersion !== null && userVersions.get(check.userId as number) !== check.userVersion) {
      throw stale;
    }
  }
}

function checkedUserIds(checks: ImportCheck[]): Set<number> {
  return new Set(checks.map((check) => check.userId).filter((id): id is number => id !== null));
}

const ACCOUNTS_BY_ID_SQL = `
  SELECT u."id", u."role"::text AS "role", u."accessState", u."profileVersion",
         u."name", u."grade", u."classNum", u."number", u."gender"::text AS "gender",
         u."subject", u."homeroom", u."position",
         COALESCE(u."emailKey", lower(btrim(u."email"))) AS "emailKey"
  FROM "User" u WHERE u."id" = ANY($1::int[])
`;

async function loadAccountsById(db: Db, ids: number[]): Promise<Map<number, ExistingAccount>> {
  if (ids.length === 0) return new Map();
  const rows = await db.$queryRawUnsafe<AccountRow[]>(ACCOUNTS_BY_ID_SQL, ids);
  return new Map(rows.map((row) => [row.id, accountOf(row)]));
}

function rowsToWrite(preview: ImportPreview, applyIncluded: boolean): RosterRow[] {
  return preview.rows
    .filter((row) => row.resolution !== "KEEP_SERVER")
    // included를 직접 정하는 확정에서는 값이 같은 행도 함께 보내야 그 행의
    // 포함 여부가 파일 기준으로 다시 세워진다.
    .filter((row) => applyIncluded || row.kind !== "SAME")
    .map((row) => row.input);
}

/**
 * 원자 확정. 요청 본문은 어떤 행 값도 담지 않고, 무엇을 쓸지는 서버에 보관된
 * 미리보기가 정한다. 검증·재검사를 모두 마친 뒤 학생·교사를 한 번의 일괄 쓰기로
 * 반영하므로, 어느 단계에서 실패해도 남는 것이 없다.
 */
export async function commitRosterImport(
  db: PrismaClient,
  input: CommitRosterImportInput,
): Promise<MutationReceipt> {
  const { receipt } = await withAcademicMutation(
    db,
    input,
    (tx) => assertActor(tx, input.actor, "WRITE_ADMIN"),
    async (tx): Promise<Summary> => {
      const row = await tx.rosterImport.findUnique({ where: { id: input.importId } });
      if (!row) {
        throw new DomainError("MISSING_PROFILE", "미리보기를 찾을 수 없습니다.");
      }
      if (row.state !== PREVIEW || row.preview === null || row.payload === null) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "이 미리보기는 더 이상 유효하지 않습니다. 파일을 다시 올려주세요.",
        );
      }

      assertSameYear(input.year, row.year);

      const preview = row.preview as unknown as ImportPreview;
      const payload = row.payload as unknown as ImportPayload;
      const year = row.year;

      // 요청의 버전이 보관된 미리보기가 본 control 버전과 같아야 한다. control
      // 버전은 전역 변경(전환·초안 생성·다른 Excel 확정)에서만 움직이므로, 다른
      // 관리자의 평범한 셀 편집 때문에 확정이 물리지는 않는다.
      if (input.expectedVersion !== preview.controlVersion) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "이 미리보기 이후 다른 일괄 변경이 반영되었습니다. 파일을 다시 올려주세요.",
        );
      }

      const state = await readYearState(tx, year);
      assertWritableYear(state);

      assertReviewed(preview, new Set(input.confirmedNewRowTokens));
      await assertNoDrift(tx, year, state, payload.checks);

      const applyIncluded =
        state === "DRAFT" && preview.scope === "FULL" && input.omissionsConfirmed;
      const rows = rowsToWrite(preview, applyIncluded);
      const summary = await writeRosterProfiles(tx, year, rows, { applyIncluded });

      // 누락된 사람에게는 제외 표시만 쓴다. 값 upsert를 태우면 미리보기 시점의
      // 이름·이메일이 그 사이의 수정을 덮어써 버린다.
      const excluded = applyIncluded
        ? await excludeDraftEntries(tx, year, payload.omittedEntryIds)
        : { changed: 0, ids: [] };

      // 읽은 뒤 취소되거나 충돌 선택이 바뀌면 명부 쓰기도 함께 되돌린다.
      const committed = await tx.rosterImport.updateMany({
        where: {
          id: row.id,
          year,
          state: PREVIEW,
          preview: { equals: row.preview as Prisma.InputJsonObject },
        },
        data: {
          state: COMMITTED,
          payload: Prisma.DbNull,
          preview: Prisma.DbNull,
          summary: {
            year,
            changed: summary.changed + excluded.changed,
            rows: rows.length,
            excluded: excluded.changed,
          },
        },
      });

      if (committed.count !== 1) {
        throw new DomainError("VERSION_CONFLICT", "미리보기가 변경되었거나 취소되었습니다. 파일을 다시 올려주세요.");
      }

      return {
        changed: summary.changed + excluded.changed,
        ids: [...summary.ids, ...excluded.ids],
      };
    },
  );

  return receipt;
}
