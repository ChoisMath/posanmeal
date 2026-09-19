import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { assertActor } from "./access";
import type {
  Actor,
  MemberState,
  MutationInput,
  MutationReceipt,
  MutationSummary,
  Profile,
  RosterRow,
  YearState,
} from "./contracts";
import type { Db, Tx } from "./db";
import { DomainError } from "./errors";
import {
  sqlStateOf,
  withAcademicMutation,
  withRosterRowMutation,
  type RosterRowTarget,
} from "./mutation";
import {
  coerceProfile,
  normalizeEmail,
  parseProfile,
  profileIssues,
  type ProfileIssue,
} from "./profile-schema";
import { REVIEW_CLEAR_SQL, REVIEW_SET_SQL } from "./roster-sql";
import {
  BUMP_YEAR_SQL,
  COPY_DRAFT_SQL,
  DRAFT_EMAIL_TAKEN_SQL,
  EMAIL_TAKEN_SQL,
  INSERT_USERS_SQL,
  MISSING_RECORDS_SQL,
  PARK_SEATS_SQL,
  SEAT_TAKEN_SQL,
  UPDATE_USERS_SQL,
  UPSERT_DRAFT_ENTRIES_SQL,
  UPSERT_ENTRIES_SQL,
  UPSERT_RECORDS_SQL,
} from "./roster-write-sql";

type Summary = MutationSummary & Prisma.InputJsonObject;

/** 명부 행을 보는 화면이 필요로 하는 값까지 붙인 모양. 저장 계약은 `RosterRow`가 기준이다. */
export type RosterRowView = RosterRow & {
  version: number;
  needsReview: boolean;
  memberState: MemberState | null;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN" | null;
  accessState: string | null;
  /** 저장 규칙을 아직 만족하지 않는 행. 조회는 막지 않고 표시만 한다. */
  incomplete: boolean;
  issues: ProfileIssue[];
};

export interface ListRosterOptions {
  /** 전환 검토만 켠다. 일반 명부는 `included = true`만 본다. */
  includeExcluded?: boolean;
}

export interface WriteRosterOptions {
  /**
   * 호출자가 `included`를 직접 정하는가. 셀 편집·Excel 반영처럼 "이 사람을 명부에서
   * 뺄지"를 다루지 않는 쓰기는 false여야 저장된 제외 상태를 덮지 않는다.
   */
  applyIncluded?: boolean;
}

export type UpsertRosterProfileInput = {
  actor: Actor;
  requestId: string;
  kind: string;
  payloadHash: string;
  expectedRowVersion: number;
  /** 잠글 행이 없을 때(신규 인원, 또는 아직 기록이 없는 기존 사용자) 쓰는 control 버전. */
  expectedVersion?: number;
  year: number;
  userId?: number;
  entryId?: string;
  email: string;
  profile: Profile;
};

export async function activeYear(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ year: number }[]>`
    SELECT year FROM "AcademicYear" WHERE state = 'ACTIVE'
  `;
  const year = rows[0]?.year;
  if (rows.length !== 1 || year === undefined) {
    throw new DomainError("YEAR_MISMATCH", "활성 학년도가 하나가 아닙니다. 관리자 설정을 확인하세요.");
  }
  return year;
}

export async function readYearState(db: Db, year: number): Promise<YearState> {
  const rows = await db.$queryRaw<{ state: string }[]>`
    SELECT state FROM "AcademicYear" WHERE year = ${year}
  `;
  const state = rows[0]?.state;
  if (!state) {
    throw new DomainError("YEAR_MISMATCH", "해당 학년도가 없습니다.");
  }
  return state as YearState;
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

interface ConfirmedRow {
  entryId: string | null;
  userId: number;
  email: string;
  emailKey: string;
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  baseUserVersion: number | null;
  included: boolean;
  version: number;
  needsReview: boolean;
  memberState: string;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  accessState: string;
}

const CONFIRMED_ROSTER_SQL = `
  SELECT e."id" AS "entryId", r."userId", u."email",
         COALESCE(u."emailKey", lower(btrim(u."email"))) AS "emailKey",
         r."role", r."name", r."grade", r."classNum", r."number", r."gender",
         r."subject", r."homeroom", r."position",
         e."baseUserVersion", COALESCE(e."included", true) AS "included",
         r."version", r."needsReview", r."memberState", u."adminLevel", u."accessState"
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  LEFT JOIN "RosterEntry" e ON e."year" = r."year" AND e."userId" = r."userId"
  WHERE r."year" = $1::int
    AND ($2::text IS NULL OR r."role"::text = $2::text)
    AND ($3::bool OR COALESCE(e."included", true) = true)
  ORDER BY r."grade" NULLS LAST, r."classNum" NULLS LAST, r."number" NULLS LAST, r."name"
`;

interface DraftRowSql {
  entryId: string;
  userId: number | null;
  email: string;
  emailKey: string;
  draftProfile: unknown;
  baseUserVersion: number | null;
  included: boolean;
  version: number;
}

const DRAFT_ROSTER_SQL = `
  SELECT e."id" AS "entryId", e."userId",
         COALESCE(e."draftEmail", u."email", e."emailKey") AS "email",
         e."emailKey", e."draftProfile", e."baseUserVersion", e."included", e."version"
  FROM "RosterEntry" e
  LEFT JOIN "User" u ON u."id" = e."userId"
  WHERE e."year" = $1::int AND ($2::bool OR e."included" = true)
  ORDER BY e."emailKey"
`;

/**
 * `included = true`인 행만 일반 명부로 돌려준다. 전환 검토가 보는 제외 후보는
 * `includeExcluded`로 명시해서 읽는다 (Task 7).
 */
export async function listRoster(
  db: Db,
  year: number,
  role?: Profile["role"],
  options?: ListRosterOptions,
): Promise<RosterRow[]> {
  const rows = await listRosterView(db, year, role, options);
  return rows.map(({ entryId, userId, email, emailKey, profile, baseUserVersion, included }) => ({
    entryId,
    userId,
    email,
    emailKey,
    profile,
    baseUserVersion,
    included,
  }));
}

export async function listRosterView(
  db: Db,
  year: number,
  role?: Profile["role"],
  options?: ListRosterOptions,
): Promise<RosterRowView[]> {
  const state = await readYearState(db, year);
  const includeExcluded = options?.includeExcluded ?? false;

  if (state === "DRAFT") {
    const rows = await db.$queryRawUnsafe<DraftRowSql[]>(DRAFT_ROSTER_SQL, year, includeExcluded);
    return rows
      .map((row) => {
        // 초안에는 아직 덜 채운 행이 있을 수 있다. 한 행 때문에 명부 전체가
        // 열리지 않으면 고칠 수단이 사라지므로 조회는 너그럽게 읽는다.
        const { profile, issues } = coerceProfile(row.draftProfile);
        return {
          entryId: row.entryId,
          userId: row.userId,
          email: row.email,
          emailKey: row.emailKey,
          profile,
          baseUserVersion: row.baseUserVersion,
          included: row.included,
          version: row.version,
          needsReview: issues.length > 0,
          memberState: null,
          adminLevel: null,
          accessState: null,
          incomplete: issues.length > 0,
          issues,
        };
      })
      .filter((row) => role === undefined || row.profile.role === role);
  }

  const rows = await db.$queryRawUnsafe<ConfirmedRow[]>(
    CONFIRMED_ROSTER_SQL,
    year,
    role ?? null,
    includeExcluded,
  );
  return rows.map((row) => {
    const profile: Profile = {
      role: row.role,
      name: row.name,
      grade: row.grade,
      classNum: row.classNum,
      number: row.number,
      gender: row.gender,
      subject: row.subject,
      homeroom: row.homeroom,
      position: row.position,
    };
    const issues = profileIssues(profile);
    return {
      entryId: row.entryId ?? "",
      userId: row.userId,
      email: row.email,
      emailKey: row.emailKey,
      profile,
      baseUserVersion: row.baseUserVersion,
      included: row.included,
      version: row.version,
      needsReview: row.needsReview,
      memberState: row.memberState as MemberState,
      adminLevel: row.adminLevel,
      accessState: row.accessState,
      incomplete: issues.length > 0,
      issues,
    };
  });
}

export interface LegacyAdminUser {
  id: number;
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER";
  grade: number | null;
  classNum: number | null;
  number: number | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  gender: "MALE" | "FEMALE" | null;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  accessState: string;
  rowVersion: number | null;
  needsReview: boolean;
  missingAcademicRecord: boolean;
}

/**
 * 옛 관리자 화면이 보는 목록. 학년도 기록이 있으면 그 값을, 아직 없으면(초기 이전
 * 전) `User` 값을 보여 주고 `missingAcademicRecord`로 그 사실을 알린다. 사람을
 * 목록에서 빠뜨리면 관리자가 고칠 수단 자체가 사라지므로 행을 감추지 않는다.
 * 새 학년도 API는 이 폴백을 쓰지 않는다.
 */
const LEGACY_ADMIN_USERS_SQL = `
  SELECT u."id", u."email", u."adminLevel", u."accessState",
         COALESCE(r."role"::text, u."role"::text) AS "role",
         COALESCE(r."name", u."name") AS "name",
         COALESCE(r."grade", u."grade") AS "grade",
         COALESCE(r."classNum", u."classNum") AS "classNum",
         COALESCE(r."number", u."number") AS "number",
         COALESCE(r."subject", u."subject") AS "subject",
         COALESCE(r."homeroom", u."homeroom") AS "homeroom",
         COALESCE(r."position", u."position") AS "position",
         COALESCE(r."gender"::text, u."gender"::text) AS "gender",
         r."version" AS "rowVersion",
         COALESCE(r."needsReview", false) AS "needsReview",
         (r."id" IS NULL) AS "missingAcademicRecord"
  FROM "User" u
  LEFT JOIN "UserAcademicRecord" r ON r."year" = $1::int AND r."userId" = u."id"
  WHERE ($2::text IS NULL OR COALESCE(r."role"::text, u."role"::text) = $2::text)
  ORDER BY "grade" NULLS LAST, "classNum" NULLS LAST, "number" NULLS LAST, "name"
`;

export async function listLegacyAdminUsers(
  db: Db,
  year: number,
  role?: Profile["role"],
): Promise<LegacyAdminUser[]> {
  return db.$queryRawUnsafe<LegacyAdminUser[]>(LEGACY_ADMIN_USERS_SQL, year, role ?? null);
}

/** 그 학년도 기록이 없어 명부에 뜨지 않는 사용자. 화면은 현재값으로 메우지 않고 이 목록만 알린다. */
export async function userIdsWithoutRecord(db: Db, year: number): Promise<number[]> {
  const rows = await db.$queryRaw<{ id: number }[]>`
    SELECT u."id" FROM "User" u
    WHERE NOT EXISTS (
      SELECT 1 FROM "UserAcademicRecord" r WHERE r."year" = ${year} AND r."userId" = u."id"
    )
    ORDER BY u."id"
  `;
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// 초안 학년도
// ---------------------------------------------------------------------------

export async function createDraftYear(
  db: PrismaClient,
  input: MutationInput & { year: number; sourceYear?: number },
): Promise<MutationReceipt> {
  const { receipt } = await withAcademicMutation(
    db,
    input,
    (tx) => assertActor(tx, input.actor, "WRITE_ADMIN"),
    async (tx): Promise<Summary> => {
      const existing = await tx.academicYear.findUnique({ where: { year: input.year } });
      if (existing) {
        throw new DomainError("YEAR_MISMATCH", "이미 있는 학년도입니다.");
      }

      const current = await activeYear(tx);
      if (input.year !== current + 1) {
        throw new DomainError(
          "YEAR_MISMATCH",
          `초안은 활성 학년도의 다음 해(${current + 1})만 만들 수 있습니다.`,
        );
      }

      const source = input.sourceYear ?? current;
      await readYearState(tx, source);

      await tx.academicYear.create({ data: { year: input.year, state: "DRAFT", version: 0 } });
      const copied = await tx.$executeRawUnsafe(COPY_DRAFT_SQL, input.year, source);

      return { changed: copied, ids: [input.year] };
    },
  );

  return receipt;
}

// ---------------------------------------------------------------------------
// 행 단위 편집
// ---------------------------------------------------------------------------

async function lockableTarget(
  db: Db,
  input: UpsertRosterProfileInput,
  state: YearState,
): Promise<RosterRowTarget | null> {
  if (state === "DRAFT") {
    if (input.entryId === undefined) return null;
    const entry = await db.rosterEntry.findUnique({
      where: { id: input.entryId },
      select: { id: true },
    });
    return entry ? { table: "RosterEntry", entryId: input.entryId } : null;
  }

  if (input.userId === undefined) return null;
  const record = await db.userAcademicRecord.findUnique({
    where: { year_userId: { year: input.year, userId: input.userId } },
    select: { id: true },
  });
  return record ? { table: "UserAcademicRecord", year: input.year, userId: input.userId } : null;
}

/**
 * 연도 상태로 wrapper와 잠글 행을 고른 뒤 한 행짜리 일괄 쓰기를 돌린다. 그 선택은
 * 트랜잭션 밖에서 읽은 상태에 기대므로, 트랜잭션 안에서 상태가 그대로인지 다시
 * 확인한다 — 사이에 초안이 활성화되면 초안 편집이 확정 경로로 새어 들어가
 * `User`를 만들어 버릴 수 있다.
 */
export async function upsertRosterProfile(
  db: PrismaClient,
  input: UpsertRosterProfileInput,
): Promise<MutationReceipt> {
  const email = input.email.trim();
  if (email.length === 0) {
    throw new DomainError("MISSING_PROFILE", "이메일을 입력하세요.");
  }
  const profile = parseProfile(input.profile);
  const state = await readYearState(db, input.year);
  const target = await lockableTarget(db, input, state);

  const write = async (tx: Tx): Promise<Summary> => {
    if ((await readYearState(tx, input.year)) !== state) {
      throw new DomainError("VERSION_CONFLICT", "학년도 상태가 바뀌었습니다. 새로고침 후 다시 시도하세요.");
    }

    const row: RosterRow = {
      entryId: input.entryId ?? randomUUID(),
      userId: input.userId ?? null,
      email,
      emailKey: normalizeEmail(email),
      profile,
      baseUserVersion: null,
      included: true,
    };

    return writeRosterProfiles(tx, input.year, [row]);
  };

  if (target === null) {
    if (input.expectedVersion === undefined) {
      throw new DomainError("MISSING_PROFILE", "이 학년도에 해당 명부 행이 없습니다.");
    }
    const { receipt } = await withAcademicMutation(
      db,
      {
        actor: input.actor,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        kind: input.kind,
        payloadHash: input.payloadHash,
      },
      (tx) => assertActor(tx, input.actor, "WRITE_ADMIN"),
      write,
    );
    return receipt;
  }

  const { receipt } = await withRosterRowMutation(
    db,
    {
      actor: input.actor,
      requestId: input.requestId,
      expectedRowVersion: input.expectedRowVersion,
      kind: input.kind,
      payloadHash: input.payloadHash,
      target,
    },
    (tx) => assertActor(tx, input.actor, "WRITE_ADMIN"),
    write,
  );
  return receipt;
}

// ---------------------------------------------------------------------------
// 일괄 쓰기
// ---------------------------------------------------------------------------

interface RowColumns {
  entryIds: string[];
  userIds: (number | null)[];
  emails: string[];
  emailKeys: string[];
  roles: string[];
  names: string[];
  grades: (number | null)[];
  classNums: (number | null)[];
  numbers: (number | null)[];
  genders: (string | null)[];
  subjects: (string | null)[];
  homerooms: (string | null)[];
  positions: (string | null)[];
  included: boolean[];
  baseUserVersions: (number | null)[];
}

function columnsOf(rows: RosterRow[]): RowColumns {
  return {
    entryIds: rows.map((row) => row.entryId),
    userIds: rows.map((row) => row.userId),
    emails: rows.map((row) => row.email),
    emailKeys: rows.map((row) => row.emailKey),
    roles: rows.map((row) => row.profile.role),
    names: rows.map((row) => row.profile.name),
    grades: rows.map((row) => row.profile.grade),
    classNums: rows.map((row) => row.profile.classNum),
    numbers: rows.map((row) => row.profile.number),
    genders: rows.map((row) => row.profile.gender),
    subjects: rows.map((row) => row.profile.subject),
    homerooms: rows.map((row) => row.profile.homeroom),
    positions: rows.map((row) => row.profile.position),
    included: rows.map((row) => row.included),
    baseUserVersions: rows.map((row) => row.baseUserVersion),
  };
}

function rowArgs(year: number, columns: RowColumns): unknown[] {
  return [
    year,
    columns.entryIds,
    columns.userIds,
    columns.emails,
    columns.emailKeys,
    columns.roles,
    columns.names,
    columns.grades,
    columns.classNums,
    columns.numbers,
    columns.genders,
    columns.subjects,
    columns.homerooms,
    columns.positions,
    columns.included,
    columns.baseUserVersions,
  ];
}

/**
 * 트랜잭션 전용 일괄 쓰기. 호출자가 Zod로 검증한 행만 받으며, 여기서는 식별 충돌을
 * 쓰기 전에 거절하고 남은 일을 전부 집합 연산으로 처리한다. Task 7·8의 Excel 확정과
 * 전환이 같은 함수를 다시 쓴다.
 */
export async function writeRosterProfiles(
  tx: Tx,
  year: number,
  rows: RosterRow[],
  options?: WriteRosterOptions,
): Promise<Summary> {
  if (rows.length === 0) return { changed: 0, ids: [] };

  assertNoDuplicatesInBatch(rows);
  const state = await readYearState(tx, year);
  const applyIncluded = options?.applyIncluded ?? false;

  return state === "DRAFT"
    ? writeDraftRows(tx, year, rows, applyIncluded)
    : writeConfirmedRows(tx, year, rows, state, applyIncluded);
}

/**
 * 같은 사람이 한 배치에 두 번 들어오면 Postgres가 "cannot affect row a second
 * time"(21000)을 내며, 그 오류에는 무엇이 잘못됐는지가 담기지 않는다. Excel이
 * 이 쓰기를 먹이므로 원인을 말해 주는 도메인 오류로 먼저 끊는다.
 */
function assertNoDuplicatesInBatch(rows: RosterRow[]): void {
  const emails = new Set<string>();
  const seats = new Set<string>();
  const userIds = new Set<number>();
  const entryIds = new Set<string>();

  for (const row of rows) {
    if (emails.has(row.emailKey)) {
      throw new DomainError("IDENTITY_CONFLICT", "같은 이메일이 두 번 들어 있습니다.");
    }
    emails.add(row.emailKey);

    if (row.userId !== null) {
      if (userIds.has(row.userId)) {
        throw new DomainError("IDENTITY_CONFLICT", "같은 사용자가 두 번 들어 있습니다.");
      }
      userIds.add(row.userId);
    }

    if (entryIds.has(row.entryId)) {
      throw new DomainError("IDENTITY_CONFLICT", "같은 명부 행이 두 번 들어 있습니다.");
    }
    entryIds.add(row.entryId);

    const { role, grade, classNum, number } = row.profile;
    if (role !== "STUDENT" || grade === null || classNum === null || number === null) continue;
    const seat = `${grade}-${classNum}-${number}`;
    if (seats.has(seat)) {
      throw new DomainError("IDENTITY_CONFLICT", `학번 ${seat} 이(가) 두 번 들어 있습니다.`);
    }
    seats.add(seat);
  }
}

async function writeDraftRows(
  tx: Tx,
  year: number,
  rows: RosterRow[],
  applyIncluded: boolean,
): Promise<Summary> {
  const columns = columnsOf(rows);

  const taken = await tx.$queryRawUnsafe<{ id: string }[]>(
    DRAFT_EMAIL_TAKEN_SQL,
    year,
    columns.emailKeys,
    columns.entryIds,
  );
  if (taken.length > 0) {
    throw new DomainError("IDENTITY_CONFLICT", "이 초안에 이미 같은 이메일이 있습니다.");
  }

  const written = await runWithIdentityGuard(() =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      UPSERT_DRAFT_ENTRIES_SQL,
      ...rowArgs(year, columns),
      applyIncluded,
    ),
  );

  if (written.length > 0) {
    await tx.$executeRawUnsafe(BUMP_YEAR_SQL, year);
  }
  return { changed: written.length, ids: written.map((row) => row.id) };
}

async function writeConfirmedRows(
  tx: Tx,
  year: number,
  rows: RosterRow[],
  state: YearState,
  applyIncluded: boolean,
): Promise<Summary> {
  const isActive = state === "ACTIVE";
  const newRows = rows.filter((row) => row.userId === null);
  if (newRows.length > 0 && !isActive) {
    throw new DomainError("YEAR_MISMATCH", "지난 학년도에는 새 인원을 추가할 수 없습니다.");
  }

  // 지난 학년도에는 남은 명부 편집과 보존 기록 정정만 허용한다. 기록이 없는
  // 사람을 뒤늦게 그 해의 명부에 끼워 넣는 길은 두지 않는다.
  if (!isActive) {
    const missing = await tx.$queryRawUnsafe<{ userId: number }[]>(
      MISSING_RECORDS_SQL,
      year,
      rows.map((row) => row.userId),
    );
    if (missing.length > 0) {
      throw new DomainError("YEAR_MISMATCH", "지난 학년도에 없던 기록은 새로 만들 수 없습니다.");
    }
  }

  await assertNoConfirmedConflicts(tx, year, rows);

  let resolved = rows;
  if (newRows.length > 0) {
    const created = await runWithIdentityGuard(() =>
      tx.$queryRawUnsafe<{ id: number; emailKey: string }[]>(
        INSERT_USERS_SQL,
        ...rowArgs(year, columnsOf(rows)),
      ),
    );
    const byKey = new Map(created.map((row) => [row.emailKey, row.id]));
    resolved = rows.map((row) =>
      row.userId === null ? { ...row, userId: byKey.get(row.emailKey) ?? null } : row,
    );

    await tx.userAccessEvent.createMany({
      data: created.map((row) => ({
        userId: row.id,
        state: "ACTIVE",
        reason: "ROSTER_ADD",
        effectiveAt: new Date(),
      })),
    });
  }

  const columns = columnsOf(resolved);
  const args = rowArgs(year, columns);

  await tx.$executeRawUnsafe(PARK_SEATS_SQL, ...args);
  const recordChanged = await runWithIdentityGuard(() =>
    tx.$queryRawUnsafe<{ userId: number }[]>(UPSERT_RECORDS_SQL, ...args),
  );

  const userChanged = isActive
    ? await runWithIdentityGuard(() => tx.$queryRawUnsafe<{ id: number }[]>(UPDATE_USERS_SQL, ...args))
    : [];
  if (isActive) {
    await runWithIdentityGuard(() =>
      tx.$executeRawUnsafe(UPSERT_ENTRIES_SQL, ...args, applyIncluded),
    );
  }

  await tx.$executeRawUnsafe(REVIEW_SET_SQL, year);
  await tx.$executeRawUnsafe(REVIEW_CLEAR_SQL, year);

  const ids = [
    ...new Set([...recordChanged.map((row) => row.userId), ...userChanged.map((row) => row.id)]),
  ];
  if (ids.length > 0) {
    await tx.$executeRawUnsafe(BUMP_YEAR_SQL, year);
  }

  return { changed: ids.length, ids };
}

/**
 * 옛 호환 쓰기는 무엇이든 받아들이고 양쪽을 `needsReview`로 남겼지만, 새 경로는
 * 충돌을 만들어 두지 않는다. 자리를 쥔 사람이 이용 중지 상태여도 그 자리는 여전히
 * 그 사람 것이므로, 화면이 "왜 안 되는지"를 바로 읽을 수 있게 그 사실을 말해 준다.
 */
async function assertNoConfirmedConflicts(tx: Tx, year: number, rows: RosterRow[]): Promise<void> {
  const columns = columnsOf(rows);

  const emailTaken = await tx.$queryRawUnsafe<{ id: number }[]>(
    EMAIL_TAKEN_SQL,
    columns.emailKeys,
    columns.emails,
    columns.userIds,
  );
  if (emailTaken.length > 0) {
    throw new DomainError("IDENTITY_CONFLICT", "이미 다른 사용자가 쓰는 이메일입니다.");
  }

  const batchIds = columns.userIds.filter((id): id is number => id !== null);
  const seatTaken = await tx.$queryRawUnsafe<
    { grade: number; classNum: number; number: number; accessState: string }[]
  >(SEAT_TAKEN_SQL, year, columns.grades, columns.classNums, columns.numbers, batchIds);

  const clash = seatTaken[0];
  if (clash) {
    throw seatConflict(clash.grade, clash.classNum, clash.number, clash.accessState);
  }
}

function seatConflict(
  grade: number,
  classNum: number,
  number: number,
  accessState: string,
): DomainError {
  const seat = `${grade}학년 ${classNum}반 ${number}번`;
  return new DomainError(
    "IDENTITY_CONFLICT",
    accessState === "ACTIVE"
      ? `${seat} 자리는 이미 다른 학생이 쓰고 있습니다.`
      : `${seat} 자리는 이용이 중지된 계정이 아직 쥐고 있습니다. 그 학생을 먼저 정리하세요.`,
  );
}

const UNIQUE_VIOLATION = "23505";

/**
 * 좌석·이메일 선점 검사는 control 행을 공유 잠금만 한 채로 돌기 때문에, 검사와
 * 쓰기 사이에 다른 관리자가 같은 자리를 차지할 수 있다. 그때 DB가 내는 unique
 * 위반을 500으로 흘리지 않고 검사에 걸렸을 때와 같은 409로 맞춘다. raw 쿼리는
 * P2002가 아니라 P2010으로 오므로 원본 SQLSTATE를 본다.
 */
async function runWithIdentityGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const isUnique =
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
      sqlStateOf(error) === UNIQUE_VIOLATION;
    if (isUnique) {
      throw new DomainError(
        "IDENTITY_CONFLICT",
        "같은 이메일이나 학번을 다른 변경이 먼저 차지했습니다. 새로고침 후 다시 시도하세요.",
      );
    }
    throw error;
  }
}
