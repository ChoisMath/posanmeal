export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";

export interface MealWindow {
  start: string;
  end: string;
}

export interface MealWindows {
  breakfast: MealWindow;
  lunch: MealWindow;
  dinner: MealWindow;
}

export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  lunch: { start: "10:30", end: "14:00" },
  dinner: { start: "15:00", end: "21:00" },
};

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

export function resolveMealKind(now: Date, windows: MealWindows): MealKind | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inWindow = (window: MealWindow) =>
    minutes >= toMinutes(window.start) && minutes < toMinutes(window.end);

  if (inWindow(windows.breakfast)) return "BREAKFAST";
  if (inWindow(windows.lunch)) return "LUNCH";
  if (inWindow(windows.dinner)) return "DINNER";
  return null;
}

export async function isStudentEligibleToday(
  userId: number,
  mealKind: MealKind,
  todayDate: Date,
): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.mealRegistrationMealDate.findFirst({
    where: {
      mealKind,
      date: todayDate,
      registration: { userId, status: "APPROVED" },
    },
    select: { registrationId: true },
  });
  return row !== null;
}
