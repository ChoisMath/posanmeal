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
import { withAcademicMutation, withRosterRowMutation, type RosterRowTarget } from "./mutation";
import { normalizeEmail, parseProfile } from "./profile-schema";
import { REVIEW_CLEAR_SQL, REVIEW_SET_SQL } from "./roster-sql";

type Summary = MutationSummary & Prisma.InputJsonObject;

/** 명부 행을 보는 화면이 필요로 하는 값까지 붙인 모양. 저장 계약은 `RosterRow`가 기준이다. */
export type RosterRowView = RosterRow & {
  version: number;
  needsReview: boolean;
  memberState: MemberState | null;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN" | null;
  accessState: string | null;
};

export type UpsertRosterProfileInput = {
  actor: Actor;
  requestId: string;
  kind: string;
  payloadHash: string;
  expectedRowVersion: number;
  /** 잠글 행이 없는 신규 추가에서만 쓰는 control 버전. */
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
  WHERE e."year" = $1::int AND e."included" = true
  ORDER BY e."emailKey"
`;

/**
 * `included = true`인 행만 일반 명부로 돌려준다. 전환 검토가 보는 제외 후보는
 * 따로 읽는다 (Task 7).
 */
export async function listRoster(
  db: Db,
  year: number,
  role?: Profile["role"],
): Promise<RosterRow[]> {
  const rows = await listRosterView(db, year, role);
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
): Promise<RosterRowView[]> {
  const state = await readYearState(db, year);

  if (state === "DRAFT") {
    const rows = await db.$queryRawUnsafe<DraftRowSql[]>(DRAFT_ROSTER_SQL, year);
    return rows
      .map((row) => ({
        entryId: row.entryId,
        userId: row.userId,
        email: row.email,
        emailKey: row.emailKey,
        profile: parseProfile(row.draftProfile),
        baseUserVersion: row.baseUserVersion,
        included: row.included,
        version: row.version,
        needsReview: false,
        memberState: null,
        adminLevel: null,
        accessState: null,
      }))
      .filter((row) => role === undefined || row.profile.role === role);
  }

  const rows = await db.$queryRawUnsafe<ConfirmedRow[]>(CONFIRMED_ROSTER_SQL, year, role ?? null);
  return rows.map((row) => ({
    entryId: row.entryId ?? "",
    userId: row.userId,
    email: row.email,
    emailKey: row.emailKey,
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
    baseUserVersion: row.baseUserVersion,
    included: row.included,
    version: row.version,
    needsReview: row.needsReview,
    memberState: row.memberState as MemberState,
    adminLevel: row.adminLevel,
    accessState: row.accessState,
  }));
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

/**
 * 원본 학년도의 명부를 그대로 초안으로 복사한다. 자동 진급도, `User` 생성도,
 * 로그인 활성화도 하지 않는다 — 초안은 아직 아무 권한도 만들지 않는 종이다.
 */
const COPY_DRAFT_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "draftEmail", "draftProfile",
    "included", "baseUserVersion", "version"
  )
  SELECT gen_random_uuid()::text, $1::int, u."id", u."emailKey", u."email",
         jsonb_build_object(
           'role', r."role"::text, 'name', r."name",
           'grade', r."grade", 'classNum', r."classNum", 'number', r."number",
           'gender', r."gender"::text, 'subject', r."subject",
           'homeroom', r."homeroom", 'position', r."position"
         ),
         true, u."profileVersion", 0
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  JOIN "RosterEntry" src
    ON src."year" = r."year" AND src."userId" = r."userId" AND src."included" = true
  WHERE r."year" = $2::int AND u."emailKey" IS NOT NULL
`;

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

/**
 * 연도 상태로 wrapper를 고른 뒤 한 행짜리 일괄 쓰기를 돌린다. 여기서 읽는 상태는
 * 잠금 밖이라 wrapper 선택에만 쓰고, 실제 분기는 트랜잭션 안에서 다시 읽는다.
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
  const isNew = state === "DRAFT" ? input.entryId === undefined : input.userId === undefined;

  const write = async (tx: Tx): Promise<Summary> => {
    const stored =
      input.entryId === undefined
        ? null
        : await tx.rosterEntry.findUnique({
            where: { id: input.entryId },
            select: { included: true, baseUserVersion: true },
          });

    const row: RosterRow = {
      entryId: input.entryId ?? randomUUID(),
      userId: input.userId ?? null,
      email,
      emailKey: normalizeEmail(email),
      profile,
      baseUserVersion: stored?.baseUserVersion ?? null,
      included: stored?.included ?? true,
    };

    return writeRosterProfiles(tx, input.year, [row]);
  };

  if (isNew) {
    if (input.expectedVersion === undefined) {
      throw new DomainError("VERSION_CONFLICT", "명부 버전을 함께 보내야 새 인원을 추가할 수 있습니다.");
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

  const target: RosterRowTarget =
    state === "DRAFT"
      ? { table: "RosterEntry", entryId: input.entryId! }
      : { table: "UserAcademicRecord", year: input.year, userId: input.userId! };

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

/** $1은 학년도, $2~$16은 행 배열이다. 행 수가 늘어도 문장 수는 그대로다. */
const UNNEST_ROWS = `
  unnest(
    $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[],
    $8::int[], $9::int[], $10::int[], $11::text[], $12::text[], $13::text[],
    $14::text[], $15::bool[], $16::int[]
  ) AS v(
    entry_id, user_id, email, email_key, role, name,
    grade, class_num, number, gender, subject, homeroom,
    position, included, base_user_version
  )
`;

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

const GENDER_KEPT = `CASE WHEN v.role = 'TEACHER' AND v.gender IS NULL THEN %KEEP% ELSE v.gender END`;

const PARK_SEATS_SQL = `
  UPDATE "UserAcademicRecord" r SET "number" = -r."userId"
  FROM ${UNNEST_ROWS}
  WHERE r."year" = $1::int AND r."userId" = v.user_id AND r."role" = 'STUDENT'
    AND (r."grade", r."classNum", r."number") IS DISTINCT FROM (v.grade, v.class_num, v.number)
`;

const UPSERT_RECORDS_SQL = `
  INSERT INTO "UserAcademicRecord" (
    "year", "userId", "role", "name", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "memberState", "needsReview", "version", "updatedAt"
  )
  SELECT $1::int, v.user_id, v.role::"Role", v.name, v.grade, v.class_num, v.number,
         v.gender::"Gender", v.subject, v.homeroom, v.position,
         CASE WHEN v.role = 'STUDENT' THEN 'ENROLLED' ELSE 'EMPLOYED' END,
         false, 0, CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "role" = EXCLUDED."role",
    "name" = EXCLUDED."name",
    "grade" = EXCLUDED."grade",
    "classNum" = EXCLUDED."classNum",
    "number" = EXCLUDED."number",
    "gender" = CASE
      WHEN EXCLUDED."role" = 'TEACHER' AND EXCLUDED."gender" IS NULL
      THEN "UserAcademicRecord"."gender" ELSE EXCLUDED."gender" END,
    "subject" = EXCLUDED."subject",
    "homeroom" = EXCLUDED."homeroom",
    "position" = EXCLUDED."position",
    "memberState" = CASE
      WHEN "UserAcademicRecord"."role" = EXCLUDED."role"
      THEN "UserAcademicRecord"."memberState" ELSE EXCLUDED."memberState" END,
    "version" = "UserAcademicRecord"."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE (
      "UserAcademicRecord"."role", "UserAcademicRecord"."name", "UserAcademicRecord"."grade",
      "UserAcademicRecord"."classNum", "UserAcademicRecord"."number", "UserAcademicRecord"."gender",
      "UserAcademicRecord"."subject", "UserAcademicRecord"."homeroom", "UserAcademicRecord"."position"
    ) IS DISTINCT FROM (
      EXCLUDED."role", EXCLUDED."name", EXCLUDED."grade",
      EXCLUDED."classNum", EXCLUDED."number",
      CASE WHEN EXCLUDED."role" = 'TEACHER' AND EXCLUDED."gender" IS NULL
           THEN "UserAcademicRecord"."gender" ELSE EXCLUDED."gender" END,
      EXCLUDED."subject", EXCLUDED."homeroom", EXCLUDED."position"
    )
  RETURNING "userId"
`;

const UPDATE_USERS_SQL = `
  UPDATE "User" u SET
    "email" = v.email, "emailKey" = v.email_key, "name" = v.name, "role" = v.role::"Role",
    "grade" = v.grade, "classNum" = v.class_num, "number" = v.number,
    "gender" = (${GENDER_KEPT.replace("%KEEP%", 'u."gender"::text')})::"Gender",
    "subject" = v.subject, "homeroom" = v.homeroom, "position" = v.position,
    "profileVersion" = u."profileVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  WHERE u."id" = v.user_id
    AND $1::int IS NOT NULL
    AND (
      u."email", u."emailKey", u."name", u."role"::text, u."grade", u."classNum",
      u."number", u."gender"::text, u."subject", u."homeroom", u."position"
    ) IS DISTINCT FROM (
      v.email, v.email_key, v.name, v.role, v.grade, v.class_num,
      v.number, ${GENDER_KEPT.replace("%KEEP%", 'u."gender"::text')}, v.subject, v.homeroom, v.position
    )
  RETURNING u."id"
`;

/**
 * 확정 연도의 명부 항목. 기존 항목이 있으면 그 id를 그대로 써서 (year, emailKey)
 * 색인과 (year, userId) 색인이 서로 다른 행을 가리키는 상태를 만들지 않는다.
 */
const UPSERT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "included", "baseUserVersion", "version"
  )
  SELECT COALESCE(e."id", v.entry_id), $1::int, v.user_id, v.email_key, v.included,
         u."profileVersion", 0
  FROM ${UNNEST_ROWS}
  JOIN "User" u ON u."id" = v.user_id
  LEFT JOIN "RosterEntry" e ON e."year" = $1::int AND e."userId" = v.user_id
  ON CONFLICT ("year", "userId") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "included" = EXCLUDED."included",
    "baseUserVersion" = EXCLUDED."baseUserVersion",
    "version" = "RosterEntry"."version" + 1
  WHERE (
    "RosterEntry"."emailKey", "RosterEntry"."included", "RosterEntry"."baseUserVersion"
  ) IS DISTINCT FROM (
    EXCLUDED."emailKey", EXCLUDED."included", EXCLUDED."baseUserVersion"
  )
`;

const UPSERT_DRAFT_ENTRIES_SQL = `
  INSERT INTO "RosterEntry" (
    "id", "year", "userId", "emailKey", "draftEmail", "draftProfile",
    "included", "baseUserVersion", "version"
  )
  SELECT v.entry_id, $1::int, v.user_id, v.email_key, v.email,
         jsonb_build_object(
           'role', v.role, 'name', v.name, 'grade', v.grade, 'classNum', v.class_num,
           'number', v.number, 'gender', v.gender, 'subject', v.subject,
           'homeroom', v.homeroom, 'position', v.position
         ),
         v.included, v.base_user_version, 0
  FROM ${UNNEST_ROWS}
  ON CONFLICT ("id") DO UPDATE SET
    "emailKey" = EXCLUDED."emailKey",
    "draftEmail" = EXCLUDED."draftEmail",
    "draftProfile" = EXCLUDED."draftProfile",
    "included" = EXCLUDED."included",
    "version" = "RosterEntry"."version" + 1
  WHERE (
    "RosterEntry"."emailKey", "RosterEntry"."draftEmail",
    "RosterEntry"."draftProfile", "RosterEntry"."included"
  ) IS DISTINCT FROM (
    EXCLUDED."emailKey", EXCLUDED."draftEmail",
    EXCLUDED."draftProfile", EXCLUDED."included"
  )
  RETURNING "id"
`;

const INSERT_USERS_SQL = `
  INSERT INTO "User" (
    "email", "emailKey", "name", "role", "grade", "classNum", "number", "gender",
    "subject", "homeroom", "position", "createdAt", "updatedAt"
  )
  SELECT v.email, v.email_key, v.name, v.role::"Role", v.grade, v.class_num, v.number,
         v.gender::"Gender", v.subject, v.homeroom, v.position,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM ${UNNEST_ROWS}
  -- $1은 이 문장이 쓰지 않는 학년도다. 모든 문장이 같은 인자 목록을 받도록
  -- 여기서 형만 붙여 둔다 — 빠지면 Postgres가 $1의 형을 정하지 못한다(42P18).
  WHERE v.user_id IS NULL AND $1::int IS NOT NULL
  RETURNING "id", "emailKey"
`;

const BUMP_YEAR_SQL = `
  UPDATE "AcademicYear" SET "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "year" = $1::int
`;

const EMAIL_TAKEN_SQL = `
  SELECT u."id" FROM "User" u
  JOIN unnest($1::text[], $2::text[], $3::int[]) AS v(email_key, email, user_id)
    ON (u."emailKey" = v.email_key OR u."email" = v.email)
  WHERE v.user_id IS NULL OR u."id" <> v.user_id
  LIMIT 1
`;

const SEAT_TAKEN_SQL = `
  SELECT r."grade", r."classNum", r."number", u."accessState"
  FROM "UserAcademicRecord" r
  JOIN "User" u ON u."id" = r."userId"
  JOIN unnest($2::int[], $3::int[], $4::int[]) AS v(grade, class_num, number)
    ON r."grade" = v.grade AND r."classNum" = v.class_num AND r."number" = v.number
  WHERE r."year" = $1::int AND r."role" = 'STUDENT' AND r."memberState" = 'ENROLLED'
    AND NOT (r."userId" = ANY($5::int[]))
  LIMIT 1
`;

const DRAFT_EMAIL_TAKEN_SQL = `
  SELECT e."id" FROM "RosterEntry" e
  JOIN unnest($2::text[], $3::text[]) AS v(email_key, entry_id) ON e."emailKey" = v.email_key
  WHERE e."year" = $1::int AND e."id" <> v.entry_id
  LIMIT 1
`;

/**
 * 트랜잭션 전용 일괄 쓰기. 호출자가 Zod로 검증한 행만 받으며, 여기서는 식별 충돌을
 * 쓰기 전에 거절하고 남은 일을 전부 집합 연산으로 처리한다. Task 7·8의 Excel 확정과
 * 전환이 같은 함수를 다시 쓴다.
 */
export async function writeRosterProfiles(
  tx: Tx,
  year: number,
  rows: RosterRow[],
): Promise<Summary> {
  if (rows.length === 0) return { changed: 0, ids: [] };

  assertNoDuplicatesInBatch(rows);
  const state = await readYearState(tx, year);

  return state === "DRAFT"
    ? writeDraftRows(tx, year, rows)
    : writeConfirmedRows(tx, year, rows, state);
}

function assertNoDuplicatesInBatch(rows: RosterRow[]): void {
  const emails = new Set<string>();
  const seats = new Set<string>();
  for (const row of rows) {
    if (emails.has(row.emailKey)) {
      throw new DomainError("IDENTITY_CONFLICT", "같은 이메일이 두 번 들어 있습니다.");
    }
    emails.add(row.emailKey);

    const { role, grade, classNum, number } = row.profile;
    if (role !== "STUDENT" || grade === null || classNum === null || number === null) continue;
    const seat = `${grade}-${classNum}-${number}`;
    if (seats.has(seat)) {
      throw new DomainError("IDENTITY_CONFLICT", `학번 ${seat} 이(가) 두 번 들어 있습니다.`);
    }
    seats.add(seat);
  }
}

async function writeDraftRows(tx: Tx, year: number, rows: RosterRow[]): Promise<Summary> {
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
    tx.$queryRawUnsafe<{ id: string }[]>(UPSERT_DRAFT_ENTRIES_SQL, ...rowArgs(year, columns)),
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
): Promise<Summary> {
  const isActive = state === "ACTIVE";
  const newRows = rows.filter((row) => row.userId === null);
  if (newRows.length > 0 && !isActive) {
    throw new DomainError("YEAR_MISMATCH", "지난 학년도에는 새 인원을 추가할 수 없습니다.");
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
    await runWithIdentityGuard(() => tx.$executeRawUnsafe(UPSERT_ENTRIES_SQL, ...args));
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
    const seat = `${clash.grade}학년 ${clash.classNum}반 ${clash.number}번`;
    throw new DomainError(
      "IDENTITY_CONFLICT",
      clash.accessState === "ACTIVE"
        ? `${seat} 자리는 이미 다른 학생이 쓰고 있습니다.`
        : `${seat} 자리는 이용이 중지된 계정이 아직 쥐고 있습니다. 그 학생을 먼저 정리하세요.`,
    );
  }
}

/** emailKey·(year, emailKey) unique 위반을 원본 메시지 없이 식별 충돌로 바꾼다. */
async function runWithIdentityGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError("IDENTITY_CONFLICT", "이미 다른 사용자가 쓰는 이메일입니다.");
    }
    throw error;
  }
}
