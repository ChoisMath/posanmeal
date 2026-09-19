import { academicYearOfDate } from "@/lib/academic-year/calendar";
import type { Db } from "@/lib/academic-year/db";
import type { RosterMode } from "@/lib/academic-year/registration-context";
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

/** 화면 표기에 필요한 그 학년도 기록의 최소 집합. */
export type DisplayRecord = {
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
};

/** 체크인 대상의 지금 상태. 토큰이나 얼굴이 아니라 이 행이 최종 근거다. */
export async function readCheckInUser(db: Db, userId: number): Promise<CheckInAccount | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: ACCOUNT_SELECT });
  return user as CheckInAccount | null;
}

/**
 * 화면에 띄울 학급 표기를 그 날짜의 학년도 기록에서 가져온다. PREPARING에서는
 * 기록이 비어 있을 수 있어 기존처럼 `User` 값을 쓰므로 조회 자체를 하지 않는다 —
 * 식당 줄의 모든 프레임이 지나는 자리라 왕복 한 번도 아깝다.
 */
export async function readDisplayRecord(
  db: Db,
  mode: RosterMode,
  userId: number,
  dateKey: string,
): Promise<DisplayRecord | null> {
  if (mode !== "READY") return null;
  const record = await db.userAcademicRecord.findFirst({
    where: { year: academicYearOfDate(dateKey), userId },
    select: { name: true, grade: true, classNum: true, number: true },
  });
  return record;
}

/**
 * READY에서 그 해 기록이 없으면 학급을 말할 수 없다. 현재 `User.grade`로 메우면
 * 진급한 학생의 지난 기록이 올해 학급으로 보이므로 비워 두고 이름만 남긴다.
 */
export function displayUserOf(
  account: CheckInAccount,
  mode: RosterMode,
  record: DisplayRecord | null,
): CheckInDisplayUser {
  const source: DisplayRecord | null = record ?? (mode === "READY" ? null : account);
  return {
    id: account.id,
    name: source?.name ?? account.name,
    role: account.role,
    grade: source?.grade ?? null,
    classNum: source?.classNum ?? null,
    number: source?.number ?? null,
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
