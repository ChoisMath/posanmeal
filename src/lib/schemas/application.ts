import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseApplicationFields = {
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  applyStart: dateString,
  applyEnd: dateString,
};

export const dinnerApplicationSchema = z.object({
  type: z.literal("DINNER"),
  ...baseApplicationFields,
  mealStart: dateString,
  mealEnd: dateString,
});

export const breakfastApplicationSchema = z.object({
  type: z.literal("BREAKFAST"),
  ...baseApplicationFields,
  allowedDates: z.array(dateString).min(1),
});

export const otherApplicationSchema = z.object({
  type: z.literal("OTHER"),
  ...baseApplicationFields,
});

export const applicationSchema = z.discriminatedUnion("type", [
  dinnerApplicationSchema,
  breakfastApplicationSchema,
  otherApplicationSchema,
]);

export const breakfastRegistrationSchema = z.object({
  signature: z.string().min(1),
  selectedDates: z.array(dateString).min(1),
});

export const dinnerRegistrationSchema = z.object({
  signature: z.string().min(1),
});

export const patchRegistrationDatesSchema = z
  .object({
    addDates: z.array(dateString).optional(),
    removeDates: z.array(dateString).optional(),
  })
  .refine(
    (value) => (value.addDates?.length ?? 0) + (value.removeDates?.length ?? 0) > 0,
    { message: "addDates or removeDates is required" },
  );
