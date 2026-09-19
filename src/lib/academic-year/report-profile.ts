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
  if (mode === "PREPARING") {
    const rows = await db.user.findMany({
      where: { id: { in: allIds } },
      select: USER_PROFILE_SELECT,
    });
    for (const row of rows) users.set(row.id, row as UserProfileRow);
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
  role: "STUDENT" | "TEACHER";
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
        role: filter.role,
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
      role: filter.role,
      ...(filter.grade === undefined ? {} : { grade: filter.grade }),
      ...(filter.classNum === undefined ? {} : { classNum: filter.classNum }),
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** 이름 → 학급 → 번호. 기록이 없는 사람은 뒤로 민다. */
export function compareByProfile(
  a: ReportProfile | undefined,
  b: ReportProfile | undefined,
  mode: "TEACHER" | "STUDENT",
): number {
  const left = a?.historical;
  const right = b?.historical;
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  if (mode === "TEACHER") return left.name.localeCompare(right.name, "ko");
  const classDiff = (left.classNum ?? 0) - (right.classNum ?? 0);
  if (classDiff !== 0) return classDiff;
  const numberDiff = (left.number ?? 0) - (right.number ?? 0);
  if (numberDiff !== 0) return numberDiff;
  return left.name.localeCompare(right.name, "ko");
}
