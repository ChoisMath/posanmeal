import { prisma } from "@/lib/prisma";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind";
import {
  DEFAULT_FACE_MATCH_MARGIN,
  DEFAULT_FACE_MATCH_THRESHOLD,
} from "@/lib/face-constants";

let cache: {
  operationMode: string;
  qrGeneration: string;
  mealWindows: MealWindows;
  faceMatch: { threshold: number; margin: number };
} | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 seconds

export async function getCachedSettings() {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL) return cache;

  const settings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  cache = {
    operationMode: map.operationMode || "online",
    qrGeneration: map.qrGeneration || "1",
    mealWindows: {
      breakfast: {
        start: map.breakfast_window_start || DEFAULT_MEAL_WINDOWS.breakfast.start,
        end: map.breakfast_window_end || DEFAULT_MEAL_WINDOWS.breakfast.end,
      },
      lunch: {
        start: map.lunch_window_start || DEFAULT_MEAL_WINDOWS.lunch.start,
        end: map.lunch_window_end || DEFAULT_MEAL_WINDOWS.lunch.end,
      },
      dinner: {
        start: map.dinner_window_start || DEFAULT_MEAL_WINDOWS.dinner.start,
        end: map.dinner_window_end || DEFAULT_MEAL_WINDOWS.dinner.end,
      },
    },
    faceMatch: {
      threshold: parseSetting(map.face_match_threshold, DEFAULT_FACE_MATCH_THRESHOLD),
      margin: parseSetting(map.face_match_margin, DEFAULT_FACE_MATCH_MARGIN),
    },
  };
  cacheTimestamp = Date.now();
  return cache;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheTimestamp = 0;
}

function parseSetting(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
