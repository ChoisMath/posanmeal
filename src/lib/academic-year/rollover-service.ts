import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { invalidateFaceCache } from "@/lib/face-embedding-cache";
import { todayKST } from "@/lib/timezone";
import { assertActor } from "./access";
import { deactivateUsers } from "./account-service";
import { academicYearBounds } from "./calendar";
import type {
  Actor,
  MemberState,
  MutationInput,
  MutationReceipt,
  MutationSummary,
  Profile,
} from "./contracts";
import type { Tx } from "./db";
import { DomainError } from "./errors";
import { ROSTER_TX, withAcademicMutation } from "./mutation";
import { normalizeEmail } from "./profile-schema";
import { requireAcademicReady } from "./readiness";
import {
  activeYear,
  listRosterView,
  rosterRowArgs,
  writeRosterProfiles,
  type RosterRowView,
} from "./roster-service";
import {
  DELETE_LEAVER_ENTRIES_SQL,
  LEAVER_MEMBER_STATE_SQL,
  LINK_ROLLOVER_ENTRIES_SQL,
  ROLLOVER_ACCOUNTS_SQL,
  ROLLOVER_MEAL_DATE_WARNINGS_SQL,
  SET_REVIEWED_SQL,
  SOURCE_MEMBERS_SQL,
} from "./rollover-sql";
import { BUMP_YEAR_SQL, INSERT_USERS_SQL } from "./roster-write-sql";

type Summary = MutationSummary & Prisma.InputJsonObject;

export type RolloverDecision = "GRADUATED" | "TRANSFERRED" | "RETIRED" | "RESTORE";

export type RolloverWarnings = {
  futureMealDatesOfLeavers: number;
  remainingMealDatesInSourceYear: number;
  studentsWithSameGrade: number;
};

export type RolloverMissing = {
  userId: number;
  role: Profile["role"];
  suggested: MemberState | null;
  decision: RolloverDecision | null;
};

export type RolloverReview = {
  year: number;
  version: number;
  yearVersion: number;
  sourceYear: number;
  sourceVersion: number;
  missing: RolloverMissing[];
  issues: string[];
  warnings: RolloverWarnings;
  canActivate: boolean;
};

export interface RolloverTimeOptions {
  /** 오늘(KST, YYYY-MM-DD). 테스트가 고정하기 위한 이음새다. */
  today?: string;
}

export type SaveRolloverDecisionInput = MutationInput & {
  year: number;
  userId: number;
  decision: RolloverDecision;
};

export type ActivateAcademicYearInput = MutationInput &
  RolloverTimeOptions & {
    year: number;
    yearVersion: number;
    sourceVersion: number;
    kiosksPaused: boolean;
    warningsAcknowledged: boolean;
  };

export const ACTIVATE_MUTATION_KIND = "ACTIVATE_YEAR";
export const DECISION_MUTATION_KIND = "ROLLOVER_DECISION";

/** 종료 결정이 그 역할에 대해 뜻이 통하는 조합. 학생 퇴직·교사 졸업은 없다. */
const LEAVING_STATES: Record<Profile["role"], MemberState[]> = {
  STUDENT: ["GRADUATED", "TRANSFERRED"],
  TEACHER: ["TRANSFERRED", "RETIRED"],
};

const CONTINUING_STATES: ReadonlySet<string> = new Set(["ENROLLED", "EMPLOYED"]);

function isLeavingState(role: Profile["role"], value: string): value is MemberState {
  return (LEAVING_STATES[role] as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 대조 계산
// ---------------------------------------------------------------------------

interface SourceMember {
  userId: number;
  role: Profile["role"];
  memberState: string;
  grade: number | null;
  accessState: string;
}

interface AccountRow {
  id: number;
  emailKey: string;
  role: Profile["role"];
  accessState: string;
}

interface RolloverPlan {
  sourceYear: number;
  sourceVersion: number;
  yearVersion: number;
  /** 새 학년도에 들어갈 초안 행(included = true). */
  rows: RosterRowView[];
  missing: RolloverMissing[];
  issues: string[];
  warnings: RolloverWarnings;
  leavers: Array<{ userId: number; memberState: MemberState }>;
}

function countIssue(issues: string[], code: string, count: number): void {
  if (count > 0) issues.push(`${code}:${count}`);
}

function duplicateSeats(rows: RosterRowView[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const { role, grade, classNum, number } = row.profile;
    if (role !== "STUDENT" || grade === null || classNum === null || number === null) continue;
    const seat = `${grade}-${classNum}-${number}`;
    if (seen.has(seat)) duplicates += 1;
    seen.add(seat);
  }
  return duplicates;
}

function duplicateEmails(rows: RosterRowView[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = normalizeEmail(row.email);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

async function loadAccounts(
  tx: Tx,
  rows: RosterRowView[],
): Promise<{ byKey: Map<string, AccountRow>; byId: Map<number, AccountRow> }> {
  const emailKeys = [...new Set(rows.map((row) => normalizeEmail(row.email)))];
  const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is number => id !== null))];
  const accounts = await tx.$queryRawUnsafe<AccountRow[]>(ROLLOVER_ACCOUNTS_SQL, emailKeys, ids);
  return {
    byKey: new Map(accounts.map((account) => [account.emailKey, account])),
    byId: new Map(accounts.map((account) => [account.id, account])),
  };
}

function accountOf(
  row: RosterRowView,
  byKey: Map<string, AccountRow>,
  byId: Map<number, AccountRow>,
): AccountRow | undefined {
  return row.userId !== null ? byId.get(row.userId) : byKey.get(normalizeEmail(row.email));
}

async function countMealDateWarnings(
  tx: Tx,
  sourceYear: number,
  leaverIds: number[],
  today: string,
): Promise<Pick<RolloverWarnings, "futureMealDatesOfLeavers" | "remainingMealDatesInSourceYear">> {
  const bounds = academicYearBounds(sourceYear);
  const rows = await tx.$queryRawUnsafe<
    Array<Pick<RolloverWarnings, "futureMealDatesOfLeavers" | "remainingMealDatesInSourceYear">>
  >(ROLLOVER_MEAL_DATE_WARNINGS_SQL, today, leaverIds, bounds.startDate, bounds.endDate);

  return {
    futureMealDatesOfLeavers: rows[0]?.futureMealDatesOfLeavers ?? 0,
    remainingMealDatesInSourceYear: rows[0]?.remainingMealDatesInSourceYear ?? 0,
  };
}

/**
 * 전환 가능 여부의 유일한 판정. review와 전환 transaction이 같은 함수를 쓰므로,
 * 검토 화면이 통과시킨 것과 전환이 다시 본 것이 갈라지지 않는다.
 */
async function planRollover(tx: Tx, year: number, today: string): Promise<RolloverPlan> {
  const target = await tx.academicYear.findUnique({ where: { year } });
  if (!target) {
    throw new DomainError("YEAR_MISMATCH", "해당 학년도가 없습니다.");
  }
  if (target.state !== "DRAFT") {
    throw new DomainError("YEAR_MISMATCH", "초안 학년도만 전환할 수 있습니다.");
  }

  const sourceYear = await activeYear(tx);
  const source = await tx.academicYear.findUniqueOrThrow({ where: { year: sourceYear } });

  const allRows = await listRosterView(tx, year, undefined, { includeExcluded: true });
  const rows = allRows.filter((row) => row.included);
  const includedUserIds = new Set(
    rows.map((row) => row.userId).filter((id): id is number => id !== null),
  );

  const members = await tx.$queryRawUnsafe<SourceMember[]>(SOURCE_MEMBERS_SQL, sourceYear);
  const continuing = members.filter(
    (member) => CONTINUING_STATES.has(member.memberState) && member.accessState === "ACTIVE",
  );
  const gradeByUserId = new Map(members.map((member) => [member.userId, member.grade]));

  const decisions = new Map(
    (await tx.rosterDecision.findMany({ where: { year } })).map((row) => [row.userId, row]),
  );

  const missing: RolloverMissing[] = continuing
    .filter((member) => !includedUserIds.has(member.userId))
    .map((member) => ({
      userId: member.userId,
      role: member.role,
      // 3학년은 졸업이 유력하지만 그래도 사람이 명시해야 한다.
      suggested: member.role === "STUDENT" && member.grade === 3 ? "GRADUATED" : null,
      decision: (decisions.get(member.userId)?.decision as RolloverDecision | undefined) ?? null,
    }));

  const leavers: Array<{ userId: number; memberState: MemberState }> = [];
  let undecided = 0;
  let stale = 0;
  for (const person of missing) {
    const decision = decisions.get(person.userId);
    if (!decision || decision.decision === "RESTORE") {
      undecided += 1;
      continue;
    }
    if (decision.sourceVersion !== source.version) {
      stale += 1;
      continue;
    }
    if (!isLeavingState(person.role, decision.decision)) {
      undecided += 1;
      continue;
    }
    leavers.push({ userId: person.userId, memberState: decision.decision });
  }

  const { byKey, byId } = await loadAccounts(tx, rows);
  let roleMismatch = 0;
  let inactive = 0;
  for (const row of rows) {
    const account = accountOf(row, byKey, byId);
    if (!account) continue;
    if (account.role !== row.profile.role) roleMismatch += 1;
    if (account.accessState !== "ACTIVE") inactive += 1;
  }

  const issues: string[] = [];
  countIssue(issues, "INCOMPLETE_ROWS", rows.filter((row) => row.incomplete).length);
  countIssue(issues, "DUPLICATE_SEAT", duplicateSeats(rows));
  countIssue(issues, "DUPLICATE_EMAIL", duplicateEmails(rows));
  countIssue(issues, "ROLE_MISMATCH", roleMismatch);
  countIssue(issues, "INACTIVE_ACCOUNT", inactive);
  countIssue(issues, "MISSING_DECISION", undecided);
  countIssue(issues, "STALE_DECISION", stale);

  const mealDates = await countMealDateWarnings(
    tx,
    sourceYear,
    leavers.map((leaver) => leaver.userId),
    today,
  );
  const studentsWithSameGrade = rows.filter(
    (row) =>
      row.profile.role === "STUDENT" &&
      row.userId !== null &&
      row.profile.grade !== null &&
      gradeByUserId.get(row.userId) === row.profile.grade,
  ).length;

  return {
    sourceYear,
    sourceVersion: source.version,
    yearVersion: target.version,
    rows,
    missing,
    issues,
    warnings: { ...mealDates, studentsWithSameGrade },
    leavers,
  };
}

// ---------------------------------------------------------------------------
// 검토
// ---------------------------------------------------------------------------

/**
 * 전체 대조. control 행을 배타 잠금한 채 계산해 다른 전역 변경과 엇갈리지 않게 하되,
 * 검토를 저장했다는 사실만으로 명부 content version을 올리지는 않는다.
 */
export async function reviewRollover(
  db: PrismaClient,
  actor: Actor,
  year: number,
  options?: RolloverTimeOptions,
): Promise<RolloverReview> {
  const today = options?.today ?? todayKST();

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;
    await requireAcademicReady(tx);
    await assertActor(tx, actor, "WRITE_ADMIN");

    const plan = await planRollover(tx, year, today);
    await tx.$executeRawUnsafe(SET_REVIEWED_SQL, year, plan.yearVersion, plan.sourceVersion);

    const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });

    return {
      year,
      version: control.version,
      yearVersion: plan.yearVersion,
      sourceYear: plan.sourceYear,
      sourceVersion: plan.sourceVersion,
      missing: plan.missing,
      issues: plan.issues,
      warnings: plan.warnings,
      canActivate: plan.issues.length === 0,
    };
  }, ROSTER_TX);
}

// ---------------------------------------------------------------------------
// 결정
// ---------------------------------------------------------------------------

/**
 * 누락 한 사람에 대한 결정. 결정은 초안 학년도 version을 올리므로 앞서 끝난 검토는
 * 자동으로 무효가 되고, 관리자는 다시 대조한 뒤에만 전환할 수 있다.
 */
export async function saveRolloverDecision(
  db: PrismaClient,
  input: SaveRolloverDecisionInput,
): Promise<MutationReceipt> {
  const { receipt } = await withAcademicMutation(
    db,
    input,
    async (tx) => {
      await requireAcademicReady(tx);
      await assertActor(tx, input.actor, "WRITE_ADMIN");
    },
    async (tx): Promise<Summary> => {
      const target = await tx.academicYear.findUnique({ where: { year: input.year } });
      if (!target || target.state !== "DRAFT") {
        throw new DomainError("YEAR_MISMATCH", "초안 학년도에만 결정을 남길 수 있습니다.");
      }

      const sourceYear = await activeYear(tx);
      const source = await tx.academicYear.findUniqueOrThrow({ where: { year: sourceYear } });
      const record = await tx.userAcademicRecord.findUnique({
        where: { year_userId: { year: sourceYear, userId: input.userId } },
        select: { role: true },
      });
      if (!record) {
        throw new DomainError("MISSING_PROFILE", "현재 학년도 명부에 없는 사람입니다.");
      }

      const role = record.role as Profile["role"];
      if (input.decision !== "RESTORE" && !isLeavingState(role, input.decision)) {
        throw new DomainError(
          "MISSING_PROFILE",
          role === "STUDENT"
            ? "학생은 졸업 또는 전출로만 종료할 수 있습니다."
            : "교사는 전출 또는 퇴직으로만 종료할 수 있습니다.",
        );
      }

      if (input.decision === "RESTORE") {
        const restored = await tx.rosterEntry.updateMany({
          where: { year: input.year, userId: input.userId },
          data: { included: true, version: { increment: 1 } },
        });
        if (restored.count === 0) {
          throw new DomainError("MISSING_PROFILE", "초안에 그 사람의 명부 행이 없습니다.");
        }
      }

      await tx.rosterDecision.upsert({
        where: { year_userId: { year: input.year, userId: input.userId } },
        create: {
          year: input.year,
          userId: input.userId,
          decision: input.decision,
          sourceVersion: source.version,
        },
        update: { decision: input.decision, sourceVersion: source.version },
      });

      await tx.$executeRawUnsafe(BUMP_YEAR_SQL, input.year);
      return { changed: 1, ids: [input.userId] };
    },
  );

  return receipt;
}

// ---------------------------------------------------------------------------
// 전환
// ---------------------------------------------------------------------------

function assertReviewed(input: ActivateAcademicYearInput, plan: RolloverPlan, reviewed: {
  reviewedVersion: number | null;
  reviewedSourceVersion: number | null;
}): void {
  const matches =
    reviewed.reviewedVersion === plan.yearVersion &&
    reviewed.reviewedSourceVersion === plan.sourceVersion &&
    input.yearVersion === plan.yearVersion &&
    input.sourceVersion === plan.sourceVersion;

  if (!matches) {
    throw new DomainError(
      "VERSION_CONFLICT",
      "검토 이후 명부나 현재 학년도가 바뀌었습니다. 전체 대조를 다시 하세요.",
    );
  }
}

function assertActivatable(input: ActivateAcademicYearInput, plan: RolloverPlan): void {
  if (!input.kiosksPaused) {
    throw new DomainError("REVIEW_REQUIRED", "키오스크를 멈춘 사실을 먼저 확인하세요.");
  }
  if (plan.issues.length > 0) {
    throw new DomainError("REVIEW_REQUIRED", "확인이 필요한 항목이 남아 있습니다.");
  }

  const warned = Object.values(plan.warnings).some((value) => value !== 0);
  if (warned && !input.warningsAcknowledged) {
    throw new DomainError("REVIEW_REQUIRED", "전환 경고를 확인해야 학년도를 바꿀 수 있습니다.");
  }
}

/**
 * 하나의 transaction. 원본을 먼저 ARCHIVED로 내린 뒤 대상을 ACTIVE로 올린다 —
 * "ACTIVE는 하나"라는 부분 unique 색인은 지연 검사가 아니므로 순서가 곧 정합성이다.
 * 그 뒤의 모든 쓰기는 집합 연산이며, 기존 신청·확정일·체크인과 계속 다니는 사람의
 * 얼굴 등록은 어느 문장도 건드리지 않는다.
 */
export async function activateAcademicYear(
  db: PrismaClient,
  input: ActivateAcademicYearInput,
): Promise<MutationReceipt> {
  const today = input.today ?? todayKST();
  let deactivated = 0;

  const { receipt } = await withAcademicMutation(
    db,
    input,
    async (tx) => {
      await requireAcademicReady(tx);
      await assertActor(tx, input.actor, "MAIN");
    },
    async (tx): Promise<Summary> => {
      const plan = await planRollover(tx, input.year, today);
      const target = await tx.academicYear.findUniqueOrThrow({ where: { year: input.year } });

      assertReviewed(input, plan, target);
      assertActivatable(input, plan);

      const at = new Date();
      await tx.academicYear.update({
        where: { year: plan.sourceYear },
        data: { state: "ARCHIVED" },
      });
      await tx.academicYear.update({
        where: { year: input.year },
        data: { state: "ACTIVE", activatedAt: at, version: { increment: 1 } },
      });

      const args = rosterRowArgs(input.year, plan.rows);
      const created = await tx.$queryRawUnsafe<{ id: number; emailKey: string }[]>(
        INSERT_USERS_SQL,
        ...args,
      );
      if (created.length > 0) {
        await tx.userAccessEvent.createMany({
          data: created.map((row) => ({
            userId: row.id,
            state: "ACTIVE",
            reason: "ROLLOVER_ADD",
            effectiveAt: at,
            requestId: input.requestId,
          })),
        });
      }

      // INSERT가 돌려주는 키는 초안 항목의 emailKey 그대로다. 같은 값으로 되찾아야
      // 저장된 키가 정규화되지 않은 행에서도 사람과 계정이 어긋나지 않는다.
      const newIdByKey = new Map(created.map((row) => [row.emailKey, row.id]));
      const rows = plan.rows.map((row) =>
        row.userId === null ? { ...row, userId: newIdByKey.get(row.emailKey) ?? null } : row,
      );

      // 계정과 항목을 먼저 이어 두면 이어지는 일괄 쓰기가 이미 있는 행을 갱신하게
      // 되어, 초안 항목의 id가 그대로 남는다.
      await tx.$executeRawUnsafe(
        LINK_ROLLOVER_ENTRIES_SQL,
        input.year,
        rows.map((row) => row.entryId),
        rows.map((row) => row.userId),
      );

      const leaverIds = plan.leavers.map((leaver) => leaver.userId);
      if (leaverIds.length > 0) {
        await tx.$executeRawUnsafe(DELETE_LEAVER_ENTRIES_SQL, input.year, leaverIds);
      }

      const written = await writeRosterProfiles(tx, input.year, rows, { applyIncluded: true });

      if (leaverIds.length > 0) {
        await tx.$executeRawUnsafe(
          LEAVER_MEMBER_STATE_SQL,
          plan.sourceYear,
          leaverIds,
          plan.leavers.map((leaver) => leaver.memberState),
        );
        await deactivateUsers(tx, leaverIds, "ROLLOVER", at, input.requestId);
        deactivated = leaverIds.length;
      }

      await tx.eligibilityEvent.create({
        data: { scope: "ROLLOVER", occurredAt: at, requestId: input.requestId },
      });

      return {
        changed: written.changed,
        ids: [input.year, plan.sourceYear],
        sourceYear: plan.sourceYear,
        newAccounts: created.length,
        members: rows.length,
        leavers: leaverIds.length,
        kiosksPaused: input.kiosksPaused,
        warnings: { ...plan.warnings },
      };
    },
  );

  // 종료자의 얼굴 등록이 사라진 사실은 커밋 뒤에만 캐시에 반영한다.
  if (deactivated > 0) invalidateFaceCache();
  return receipt;
}
