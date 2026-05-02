export type MealKind = "BREAKFAST" | "DINNER";

export interface MealWindow {
  start: string;
  end: string;
}

export interface MealWindows {
  breakfast: MealWindow;
  dinner: MealWindow;
}

export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner: { start: "15:00", end: "21:00" },
};

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

export function resolveMealKindLocal(now: Date, windows: MealWindows): MealKind | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inWindow = (window: MealWindow) =>
    minutes >= toMinutes(window.start) && minutes < toMinutes(window.end);

  if (inWindow(windows.breakfast)) return "BREAKFAST";
  if (inWindow(windows.dinner)) return "DINNER";
  return null;
}
