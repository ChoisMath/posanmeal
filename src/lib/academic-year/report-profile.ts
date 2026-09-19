import type { AcademicProfile, MemberState } from "./contracts";
import type { Db } from "./db";
import { getAcademicProfiles } from "./profile-service";
import { rosterMode, type RosterMode } from "./registration-context";
import { activeYear } from "./roster-service";

/** 그 학년도 기록이 없어 학급을 말할 수 없을 때 화면·엑셀에 그대로 넣는 문구. */
export const MISSING_PROFILE_WARNING = "학년도 정보 확인 필요";

export type ReportProfile = {
  userId: number;
  year: number;
  historical: AcademicProfile | null;
  current: AcademicProfile | null;
  currentState: string;
  warning: string | null;
  /**
   * 그 해 기록이 없을 때만 채운다. 이름은 학년·반과 달리 학년도에 매이는 값이 아니고,
   * 관리자가 "확인 필요"로 남은 사람을 찾아 고치려면 부를 이름이 있어야 한다.
   */
  fallbackName: string | null;
};

const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  ENROLLED: "재학",
  EMPLOYED: "재직",
  GRADUATED: "졸업",
  TRANSFERRED: "전출",
  RETIRED: "퇴직",
};

const UNKNOWN_STATE_LABEL = "미등록";

const LEAVING_STATES: ReadonlySet<MemberState> = new Set<MemberState>([
  "GRADUATED",
  "TRANSFERRED",
  "RETIRED",
]);

const USER_PROFILE_SELECT = {
  id: true,
  role: true,
  name: true,
  grade: true,
  classNum: true,
  number: true,
  gender: true,
  subject: true,
  homeroom: true,
  position: true,
} as const;

type UserProfileRow = {
  id: number;
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
};

function profileFromUser(user: UserProfileRow, year: number): AcademicProfile {
  return {
    role: user.role,
    name: user.name,
    grade: user.grade,
    classNum: user.classNum,
    number: user.number,
    gender: user.gender,
    subject: user.subject,
    homeroom: user.homeroom,
    position: user.position,
    year,
    userId: user.id,
    memberState: user.role === "STUDENT" ? "ENROLLED" : "EMPLOYED",
    version: 0,
    needsReview: false,
  };
}

/**
 * 과거 표기의 유일한 대체 규칙. READY에서는 대체가 없다 — 진급 뒤 `User`를 읽으면
 * 지난 학년도 보고서가 조용히 올해 학급을 보여 준다. PREPARING은 초기 이전이 아직
 * 검증되지 않아 기록이 비어 있을 수 있으므로 기존 화면과 같게 `User`를 본다.
 */
function resolveHistorical(
  mode: RosterMode,
  stored: AcademicProfile | undefined,
  user: UserProfileRow | undefined,
  year: number,
): { profile: AcademicProfile | null; warning: string | null } {
  if (stored) return { profile: stored, warning: null };
  if (mode === "PREPARING" && user) return { profile: profileFromUser(user, year), warning: null };
  return { profile: null, warning: MISSING_PROFILE_WARNING };
}

export function classLabelOf(profile: AcademicProfile | null): string {
  if (!profile || profile.grade === null || profile.classNum === null) {
    return MISSING_PROFILE_WARNING;
  }
  return `${profile.grade}-${profile.classNum}`;
}

/** 기록이 없어도 관리자가 사람을 찾을 수 있도록 계정 이름까지 본다. */
export function displayNameOf(report: ReportProfile | undefined): string {
  return report?.historical?.name ?? report?.fallbackName ?? "";
}

/** 졸업·전출자의 "현재 학급" 칸. 과거 학급을 그대로 복사해 넣지 않는다. */
export function currentClassLabelOf(report: ReportProfile | undefined): string {
  if (!report) return UNKNOWN_STATE_LABEL;
  const current = report.current;
  if (
    current
    && !LEAVING_STATES.has(current.memberState)
    && current.grade !== null
    && current.classNum !== null
  ) {
    return `${current.grade}-${current.classNum}`;
  }
  return report.currentState.length > 0 ? report.currentState : UNKNOWN_STATE_LABEL;
}

/**
 * 연도별로 한 번씩만 명부를 읽는다. 기간이 두 학년도에 걸쳐도 사람 수만큼 왕복하지
 * 않는다.
 */
export async function getReportProfilesByYear(
  db: Db,
  idsByYear: Map<number, Iterable<number>>,
  includeCurrent: boolean,
): Promise<Map<number, Map<number, ReportProfile>>> {
  const mode = await rosterMode(db);
  const currentYear = includeCurrent ? await activeYear(db) : null;

  const normalized = new Map<number, number[]>();
  for (const [year, ids] of idsByYear) {
    normalized.set(year, [...new Set(ids)]);
  }

  const allIds = [...new Set([...normalized.values()].flat())];
  if (allIds.length === 0) {
    return new Map([...normalized.keys()].map((year) => [year, new Map()]));
  }

  // 연도당 정확히 한 번. 현재 소속 병기를 요청하면 운영 연도의 조회도 이 계획에 합류한다.
  const plan = new Map<number, number[]>(normalized);
  if (currentYear !== null) {
    plan.set(currentYear, [...new Set([...(plan.get(currentYear) ?? []), ...allIds])]);
  }

  const storedByYear = new Map<number, Map<number, AcademicProfile>>();
  await Promise.all(
    [...plan].map(async ([year, ids]) => {
      storedByYear.set(year, await getAcademicProfiles(db, ids, year));
    }),
  );

  const currentProfiles = currentYear === null
    ? new Map<number, AcademicProfile>()
    : storedByYear.get(currentYear) ?? new Map<number, AcademicProfile>();

  const users = new Map<number, UserProfileRow>();
  const fallbackNames = new Map<number, string>();
  if (mode === "PREPARING") {
    const rows = await db.user.findMany({
      where: { id: { in: allIds } },
      select: USER_PROFILE_SELECT,
    });
    for (const row of rows) users.set(row.id, row as UserProfileRow);
  } else {
    const missing = allIds.filter((id) =>
      [...normalized].some(([year, ids]) => ids.includes(id) && !storedByYear.get(year)?.has(id)),
    );
    if (missing.length > 0) {
      const rows = await db.user.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true },
      });
      for (const row of rows) fallbackNames.set(row.id, row.name);
    }
  }

  const result = new Map<number, Map<number, ReportProfile>>();
  for (const [year, ids] of normalized) {
    const stored = storedByYear.get(year) ?? new Map<number, AcademicProfile>();
    const perYear = new Map<number, ReportProfile>();
    for (const userId of ids) {
      const user = users.get(userId);
      const { profile, warning } = resolveHistorical(mode, stored.get(userId), user, year);
      const current = currentYear === null
        ? null
        : currentProfiles.get(userId)
          ?? (mode === "PREPARING" && user ? profileFromUser(user, currentYear) : null);
      perYear.set(userId, {
        userId,
        year,
        historical: profile,
        current,
        // 전환은 떠난 사람의 상태를 떠난 해의 기록에 적는다. 새 학년도에 행이 없다는
        // 사실만으로 "미등록"이라고 하면 졸업·전출을 구분하지 못한다.
        currentState: currentYear === null
          ? ""
          : current
            ? MEMBER_STATE_LABEL[current.memberState]
            : profile && LEAVING_STATES.has(profile.memberState)
              ? MEMBER_STATE_LABEL[profile.memberState]
              : UNKNOWN_STATE_LABEL,
        warning,
        fallbackName: profile ? null : fallbackNames.get(userId) ?? user?.name ?? null,
      });
    }
    result.set(year, perYear);
  }
  return result;
}

export async function getReportProfiles(
  db: Db,
  ids: number[],
  year: number,
  includeCurrent: boolean,
): Promise<Map<number, ReportProfile>> {
  const byYear = await getReportProfilesByYear(db, new Map([[year, ids]]), includeCurrent);
  return byYear.get(year) ?? new Map();
}

export type YearMemberFilter = {
  /** 비우면 그 해 기록이 있는 사람 전부. */
  role?: "STUDENT" | "TEACHER";
  grade?: number;
  classNum?: number;
  enrolledOnly?: boolean;
};

/**
 * 어떤 사람을 그 학년도 보고서에 올릴지. READY에서는 그 해 기록이 출발점이라
 * 졸업·전출한 사람도 당시 소속으로 남는다. PREPARING은 기록이 비어 있을 수 있어
 * 기존과 같이 현재 `User`를 본다.
 */
export async function listYearMemberIds(
  db: Db,
  year: number,
  filter: YearMemberFilter,
): Promise<number[]> {
  const mode = await rosterMode(db);
  if (mode === "READY") {
    const rows = await db.userAcademicRecord.findMany({
      where: {
        year,
        ...(filter.role === undefined ? {} : { role: filter.role }),
        ...(filter.grade === undefined ? {} : { grade: filter.grade }),
        ...(filter.classNum === undefined ? {} : { classNum: filter.classNum }),
        ...(filter.enrolledOnly
          ? { memberState: filter.role === "STUDENT" ? "ENROLLED" : "EMPLOYED" }
          : {}),
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  const users = await db.user.findMany({
    where: {
      ...(filter.role === undefined ? {} : { role: filter.role }),
      ...(filter.grade === undefined ? {} : { grade: filter.grade }),
      ...(filter.classNum === undefined ? {} : { classNum: filter.classNum }),
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/**
 * 그 기간에 실제로 자료가 있는 사람. 명부 기록이 지워졌더라도 체크인이나 확정된
 * 신청이 있으면 보고서에서 빠지면 안 된다 — 빠지면 합계가 맞지 않고 고칠 대상도
 * 보이지 않는다.
 */
export async function collectPeriodUserIds(
  db: Db,
  range: { startDate: Date; endDate: Date },
): Promise<number[]> {
  const [checkIns, confirmed] = await Promise.all([
    db.checkIn.findMany({
      where: { date: { gte: range.startDate, lte: range.endDate } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.mealRegistrationMealDate.findMany({
      where: {
        date: { gte: range.startDate, lte: range.endDate },
        registration: { status: "APPROVED" },
      },
      select: { registration: { select: { userId: true } } },
    }),
  ]);

  return [
    ...new Set([
      ...checkIns.map((row) => row.userId),
      ...confirmed.map((row) => row.registration.userId),
    ]),
  ];
}

/** 과거 기간 보고서의 분류. "unknown"은 그 해 기록이 없는 사람만 모으는 마지막 묶음이다. */
export type ReportCategory = "teacher" | "1" | "2" | "3" | "unknown";

export const REPORT_CATEGORIES: readonly ReportCategory[] = ["teacher", "1", "2", "3", "unknown"];

export const UNKNOWN_CATEGORY_LABEL = "확인 필요";

export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

const KNOWN_GRADES = new Set([1, 2, 3]);

/**
 * 분류의 단 하나의 규칙. 월별 표·월별 엑셀·일별 엑셀이 각자 갈래를 세면 언젠가
 * 어긋나고, 어느 칸에도 들지 못한 사람은 조용히 사라진다. 구체적인 칸에 넣을 수
 * 없는 사람(기록 없음, 학년이 비었거나 1~3 밖, 뜻밖의 역할)은 전부 "확인 필요"다.
 */
export function reportBucketOf(report: ReportProfile | undefined): ReportCategory {
  const profile = report?.historical;
  if (!profile) return "unknown";
  if (profile.role === "TEACHER") return "teacher";
  if (profile.role === "STUDENT" && profile.grade !== null && KNOWN_GRADES.has(profile.grade)) {
    return String(profile.grade) as ReportCategory;
  }
  return "unknown";
}

export type PeriodBuckets = {
  profiles: Map<number, ReportProfile>;
  byCategory: Map<ReportCategory, number[]>;
};

/**
 * 한 기간 보고서의 전체 명단을 한 번에 가른다. 그 해 기록과 그 기간 자료를 합친 뒤
 * `reportBucketOf`로만 분류하므로 다섯 묶음은 서로 겹치지 않고, 더하면 그 기간
 * 전체와 정확히 같다. 조회는 명부 1회 + 기간 자료 2회 + Profile 1회뿐이다.
 */
export async function listPeriodBuckets(
  db: Db,
  year: number,
  range: { startDate: Date; endDate: Date },
  includeCurrent: boolean,
): Promise<PeriodBuckets> {
  const [rosterIds, dataIds] = await Promise.all([
    listYearMemberIds(db, year, {}),
    collectPeriodUserIds(db, range),
  ]);

  const candidates = [...new Set([...rosterIds, ...dataIds])];
  const profiles = await getReportProfiles(db, candidates, year, includeCurrent);
  const dataSet = new Set(dataIds);

  const byCategory = new Map<ReportCategory, number[]>(
    REPORT_CATEGORIES.map((category) => [category, []]),
  );
  for (const id of candidates) {
    const report = profiles.get(id);
    // 기록이 없는 사람은 그 기간에 실제 자료가 있을 때만 올린다.
    if (!report?.historical && !dataSet.has(id)) continue;
    byCategory.get(reportBucketOf(report))!.push(id);
  }

  for (const [category, ids] of byCategory) {
    ids.sort((a, b) =>
      compareByProfile(
        profiles.get(a),
        profiles.get(b),
        category === "teacher" ? "TEACHER" : "STUDENT",
      ),
    );
  }

  return { profiles, byCategory };
}

export async function listPeriodCategory(
  db: Db,
  year: number,
  range: { startDate: Date; endDate: Date },
  category: ReportCategory,
  includeCurrent: boolean,
): Promise<{ ids: number[]; profiles: Map<number, ReportProfile> }> {
  const { profiles, byCategory } = await listPeriodBuckets(db, year, range, includeCurrent);
  return { ids: byCategory.get(category) ?? [], profiles };
}

/** 이름 → 학급 → 번호. 기록이 없는 사람은 뒤로 민다. */
export function compareByProfile(
  a: ReportProfile | undefined,
  b: ReportProfile | undefined,
  mode: "TEACHER" | "STUDENT",
): number {
  const left = a?.historical;
  const right = b?.historical;
  if (!left || !right) {
    if (left) return -1;
    if (right) return 1;
    return displayNameOf(a).localeCompare(displayNameOf(b), "ko");
  }
  if (mode === "TEACHER") return left.name.localeCompare(right.name, "ko");
  const classDiff = (left.classNum ?? 0) - (right.classNum ?? 0);
  if (classDiff !== 0) return classDiff;
  const numberDiff = (left.number ?? 0) - (right.number ?? 0);
  if (numberDiff !== 0) return numberDiff;
  return left.name.localeCompare(right.name, "ko");
}
