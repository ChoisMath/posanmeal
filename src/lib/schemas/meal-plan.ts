import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mealKind = z.enum(["BREAKFAST", "LUNCH", "DINNER"]);
const method = z.enum(["NONE", "YN", "WEEKDAY", "DATE"]);

export const adminApplicationSchema = z
  .object({
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
  });

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
