import { academicYearOfDate } from "@/lib/academic-year/calendar";
import type { Db } from "@/lib/academic-year/db";
import { getReportProfiles, type ReportProfile } from "@/lib/academic-year/report-profile";
import type { MealKind } from "@/lib/meal-kind";

export const ACCOUNT_INACTIVE_MESSAGE = "이용이 중지된 계정입니다. 관리자에게 문의하세요.";

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  role: true,
  grade: true,
  classNum: true,
  number: true,
  photoUrl: true,
  accessState: true,
} as const;

export type CheckInAccount = {
  id: number;
  name: string;
  role: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  photoUrl: string | null;
  accessState: string;
};

export type CheckInDisplayUser = {
  id: number;
  name: string;
  role: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  photoUrl: string | null;
};

/** 체크인 대상의 지금 상태. 토큰이나 얼굴이 아니라 이 행이 최종 근거다. */
export async function readCheckInUser(db: Db, userId: number): Promise<CheckInAccount | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
  return user as CheckInAccount | null;
}

/** 화면에 띄울 학급 표기는 그 날짜가 속한 학년도 기록에서 가져온다. */
export async function readDisplayProfile(
  db: Db,
  userId: number,
  dateKey: string,
): Promise<ReportProfile | undefined> {
  const profiles = await getReportProfiles(db, [userId], academicYearOfDate(dateKey), false);
  return profiles.get(userId);
}

export function displayUserOf(
  account: CheckInAccount,
  report: ReportProfile | undefined,
): CheckInDisplayUser {
  const profile = report?.historical;
  return {
    id: account.id,
    name: profile?.name ?? report?.fallbackName ?? account.name,
    role: account.role,
    grade: profile ? profile.grade : null,
    classNum: profile ? profile.classNum : null,
    number: profile ? profile.number : null,
    photoUrl: account.photoUrl,
  };
}

/** `isStudentEligibleToday`와 같은 판정이되, 삽입과 같은 트랜잭션에서 읽는다. */
export async function isStudentEligibleIn(
  db: Db,
  userId: number,
  mealKind: MealKind,
  date: Date,
): Promise<boolean> {
  const row = await db.mealRegistrationMealDate.findFirst({
    where: { mealKind, date, registration: { userId, status: "APPROVED" } },
    select: { registrationId: true },
  });
  return row !== null;
}
