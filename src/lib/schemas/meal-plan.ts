import { z } from "zod";
import { academicYearBounds } from "@/lib/academic-year/calendar";
import { getDaysInMonthUtc } from "@/lib/date-range";
import { monthsOf } from "@/lib/meal-plan";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mealKind = z.enum(["BREAKFAST", "LUNCH", "DINNER"]);
const method = z.enum(["NONE", "YN", "WEEKDAY", "DATE"]);

export const YEAR_SPAN_MESSAGE =
  "공고 기간이 학년도(3월~다음 해 2월)를 벗어납니다. 두 개의 공고로 나눠 등록하세요.";

/** 대상 월 전체가 차지하는 날짜 구간. 월 범위와 개설일을 같은 기준으로 잰다. */
function monthSpan(
  startYear: number,
  startMonth: number,
  monthCount: number,
): { first: string; last: string } {
  const months = monthsOf(startYear, startMonth, monthCount);
  const first = months[0];
  const last = months[months.length - 1];
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    first: `${first.year}-${pad(first.month)}-01`,
    last: `${last.year}-${pad(last.month)}-${pad(getDaysInMonthUtc(last.year, last.month))}`,
  };
}

/**
 * 대상 월과 모든 개설일이 한 학년도 안에 있는지. 학년도가 정해진 뒤에는 서버가
 * 이 판정을 다시 한다 — 입력에 학년도가 없으면 zod는 검사할 수 없기 때문이다.
 */
export function isWithinAcademicYear(
  academicYear: number,
  v: {
    startYear: number;
    startMonth: number;
    monthCount: number;
    meals: { dates: { date: string }[] }[];
  },
): boolean {
  const { startDate, endDate } = academicYearBounds(academicYear);
  const span = monthSpan(v.startYear, v.startMonth, v.monthCount);
  if (span.first < startDate || span.last > endDate) return false;
  return v.meals.every((meal) =>
    meal.dates.every((d) => d.date >= startDate && d.date <= endDate),
  );
}

function withinAcademicYear(v: {
  academicYear?: number | null;
  startYear: number;
  startMonth: number;
  monthCount: number;
  meals: { dates: { date: string }[] }[];
}): boolean {
  return v.academicYear == null || isWithinAcademicYear(v.academicYear, v);
}

export const adminApplicationSchema = z
  .object({
    // 학년도 입력란은 뒤따르는 UI 작업에서 붙는다. 값이 없으면 서버가 운영 연도로
    // 채우고, READY에서는 새 공고에 한해 채우지 못한 요청을 거절한다.
    academicYear: z.number().int().min(2000).max(2100).nullish(),
    subject: z.string().min(1).max(100),
    description: z.string().max(5000).optional().default(""),
    startYear: z.number().int().min(2024).max(2100),
    startMonth: z.number().int().min(1).max(12),
    monthCount: z.number().int().min(1).max(6),
    applyStartAt: z.string().datetime({ offset: true }),
    applyEndAt: z.string().datetime({ offset: true }),
    meals: z
      .array(
        z.object({
          mealKind,
          price: z.number().int().min(0).max(1_000_000),
          exemptionSelectable: z.boolean(),
          method,
          dates: z.array(
            z.object({ grade: z.number().int().min(1).max(3), date: dateKey }),
          ),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine((v) => new Date(v.applyEndAt) > new Date(v.applyStartAt), {
    message: "마감일시는 시작일시 이후여야 합니다",
  })
  .refine((v) => v.meals.every((m) => m.method === "NONE" || m.dates.length > 0), {
    message: "신청 가능한 식사는 개설일이 1개 이상이어야 합니다",
  })
  .refine((v) => new Set(v.meals.map((m) => m.mealKind)).size === v.meals.length, {
    message: "식사 종류가 중복되었습니다",
  })
  .refine(withinAcademicYear, { message: YEAR_SPAN_MESSAGE });

export const studentRegisterSchema = z.object({
  signature: z.string().min(1).max(200_000),
  meals: z
    .array(
      z.object({
        mealKind,
        applied: z.boolean(),
        exempt: z.boolean().default(false),
        selectedDates: z.array(dateKey).optional(),
        weekdaysByMonth: z
          .record(
            z.string().regex(/^\d{4}-\d{2}$/),
            z.array(z.number().int().min(0).max(6)),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(3),
});

export type AdminApplicationInput = z.infer<typeof adminApplicationSchema>;
export type StudentRegisterInput = z.infer<typeof studentRegisterSchema>;
