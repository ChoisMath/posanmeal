import type { ResolveContext } from "@/lib/meal-plan-server";
import { assertActor } from "./access";
import type { AcademicProfile, Actor } from "./contracts";
import type { Db } from "./db";
import { DomainError } from "./errors";
import { getAcademicProfiles } from "./profile-service";
import { activeYear, readYearState } from "./roster-service";

export type RegistrationIntent = "CREATE" | "EDIT" | "RESTORE" | "CANCEL";

export type RosterMode = "PREPARING" | "READY";

export type RegistrationContext = {
  year: number;
  profile: AcademicProfile;
  resolveContext: ResolveContext;
};

export async function rosterMode(db: Db): Promise<RosterMode> {
  const rows = await db.$queryRaw<{ mode: string }[]>`SELECT mode FROM "RosterControl" WHERE id = 1`;
  const mode = rows[0]?.mode;
  if (mode !== "PREPARING" && mode !== "READY") {
    throw new DomainError("NOT_READY", "학년도 설정을 확인하세요.");
  }
  return mode;
}

/**
 * 공고가 어느 학년도에 속하는지 정하는 유일한 자리. READY에서는 기록된 값만
 * 인정한다 — 초기 이전이 모든 공고의 학년도를 채운 뒤에야 READY로 올라가므로
 * 비어 있다는 것은 고칠 수 없는 결측이다. PREPARING에서는 아직 채워지지 않은
 * 공고가 남아 있어 운영 연도로 본다.
 */
export async function resolveApplicationYear(
  db: Db,
  mode: RosterMode,
  applicationYear: number | null,
): Promise<number> {
  if (applicationYear !== null) return applicationYear;
  if (mode === "READY") {
    throw new DomainError("YEAR_MISMATCH", "공고의 학년도 정보가 없습니다. 관리자에게 문의하세요.");
  }
  return activeYear(db);
}

/**
 * 그 학년도의 학년. READY에는 대체가 없다 — 현재 `User.grade`로 메우면 진급한
 * 학생의 지난 공고가 올해 학년으로 재계산된다. PREPARING에서만 연도 기록이
 * 없을 때 기존과 같이 `User.grade`를 본다.
 */
export async function gradeFor(
  db: Db,
  mode: RosterMode,
  profile: AcademicProfile | undefined,
  userId: number,
): Promise<number | null> {
  if (profile?.grade != null) return profile.grade;
  if (mode === "READY") {
    throw new DomainError("MISSING_PROFILE", "해당 학년도의 학적 정보가 없습니다.");
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { grade: true } });
  return user?.grade ?? null;
}

async function fallbackProfile(db: Db, userId: number, year: number): Promise<AcademicProfile> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      name: true,
      grade: true,
      classNum: true,
      number: true,
      gender: true,
      subject: true,
      homeroom: true,
      position: true,
    },
  });
  if (!user) {
    throw new DomainError("MISSING_PROFILE", "대상 사용자를 찾을 수 없습니다.");
  }
  return {
    ...user,
    year,
    userId,
    memberState: user.role === "STUDENT" ? "ENROLLED" : "EMPLOYED",
    version: 0,
    needsReview: false,
  };
}

const CREATING: ReadonlySet<RegistrationIntent> = new Set<RegistrationIntent>(["CREATE", "RESTORE"]);

/**
 * 신청의 모든 분기(학생 본인·관리자 대리·상태 복원·Excel 일괄)가 공유하는 자격
 * 검사. 학년도를 먼저 정하고 그 해의 Profile만으로 판정하므로, 진급한 학생의
 * 지난 공고도 당시 학년으로 처리된다.
 */
export async function getRegistrationContext(
  tx: Db,
  actor: Actor,
  applicationId: number,
  userId: number,
  intent: RegistrationIntent,
): Promise<RegistrationContext> {
  const application = await tx.mealApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, academicYear: true },
  });
  if (!application) {
    throw new DomainError("INVALID_INPUT", "공고를 찾을 수 없습니다.");
  }

  const mode = await rosterMode(tx);
  const year = await resolveApplicationYear(tx, mode, application.academicYear);
  const current = await activeYear(tx);

  if (year !== current && (await readYearState(tx, year)) === "DRAFT") {
    throw new DomainError("YEAR_MISMATCH", "초안 학년도 공고에는 신청할 수 없습니다.");
  }

  const isSelf = actor.kind === "USER" && actor.userId === userId;
  if (isSelf) {
    await assertActor(tx, actor, "STUDENT");
    if (year !== current) {
      throw new DomainError("YEAR_MISMATCH", "지난 학년도 공고는 직접 수정할 수 없습니다.");
    }
  } else {
    await assertActor(tx, actor, "WRITE_ADMIN");
  }

  if (CREATING.has(intent) && year !== current) {
    throw new DomainError("YEAR_MISMATCH", "지난 학년도 공고에는 새로 신청할 수 없습니다.");
  }

  const profiles = await getAcademicProfiles(tx, [userId], year);
  const stored = profiles.get(userId);
  if (!stored && mode === "READY") {
    throw new DomainError("MISSING_PROFILE", "해당 학년도의 학적 정보가 없습니다.");
  }
  const profile = stored ?? (await fallbackProfile(tx, userId, year));

  if (profile.role !== "STUDENT") {
    throw new DomainError("INVALID_INPUT", "학생만 신청할 수 있습니다.");
  }

  if (CREATING.has(intent)) {
    if (profile.memberState !== "ENROLLED") {
      throw new DomainError("MISSING_PROFILE", "재학 중인 학생만 신청할 수 있습니다.");
    }
    const account = await tx.user.findUnique({ where: { id: userId }, select: { accessState: true } });
    if (account?.accessState !== "ACTIVE") {
      throw new DomainError("ACCOUNT_INACTIVE", "이용이 중지된 계정입니다.");
    }
  }

  const grade = await gradeFor(tx, mode, stored, userId);
  if (grade === null) {
    throw new DomainError("MISSING_PROFILE", "해당 학년도의 학년 정보가 없습니다.");
  }

  const [appMeals, openRows] = await Promise.all([
    tx.mealApplicationMeal.findMany({ where: { applicationId } }),
    tx.mealApplicationMealDate.findMany({ where: { applicationId, grade } }),
  ]);

  return {
    year,
    profile: { ...profile, grade },
    resolveContext: { appMeals, openRows },
  };
}
