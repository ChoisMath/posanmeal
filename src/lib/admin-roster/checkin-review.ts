import type { MealKind } from "@/lib/meal-kind";
import { MEAL_KINDS } from "@/lib/meal-plan";
import { academicYearOfDate } from "@/lib/academic-year/calendar";

export type CheckInReviewState = "PENDING" | "ACCEPTED" | "DUPLICATE" | "REJECTED";
export type CheckInReviewRow = {
  id: string;
  clientKey: string;
  snapshotId: string | null;
  reason: string;
  state: CheckInReviewState;
  payload: unknown;
  decision: unknown;
  createdAt: string;
  resolvedAt: string | null;
  subject: { name: string; year: number; affiliation: string; warning: string | null } | null;
};

export type ReviewPayload = {
  userId: number | null;
  date: string | null;
  year: number | null;
  checkedAt: string | null;
  mealKind: MealKind | null;
  invalidMealKind: boolean;
  type: string | null;
  canAccept: boolean;
};

export function checkInReviewPayload(payload: unknown): ReviewPayload {
  const source = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const userId = typeof source.userId === "number" && Number.isInteger(source.userId) && source.userId > 0 ? source.userId : null;
  const date = typeof source.date === "string" ? source.date : null;
  const checkedAt = typeof source.checkedAt === "string" && !Number.isNaN(new Date(source.checkedAt).getTime()) ? source.checkedAt : null;
  const type = typeof source.type === "string" ? source.type : null;
  const mealKind = MEAL_KINDS.includes(source.mealKind as MealKind) ? source.mealKind as MealKind : null;
  const invalidMealKind = source.mealKind !== undefined && source.mealKind !== null && mealKind === null;
  let year: number | null = null;
  if (date !== null) {
    try { year = academicYearOfDate(date); } catch { /* 보관된 잘못된 원본도 거절 사유와 함께 확인할 수 있어야 한다. */ }
  }
  return { userId, date, year, checkedAt, mealKind, invalidMealKind, type,
    canAccept: userId !== null && year !== null && checkedAt !== null &&
      type !== null && ["STUDENT", "WORK", "PERSONAL"].includes(type) && !invalidMealKind };
}

export const CHECKIN_REVIEW_LABEL: Record<CheckInReviewState, string> = {
  PENDING: "확인 대기", ACCEPTED: "반영 완료", DUPLICATE: "중복 확인", REJECTED: "거절 확정",
};
