const NEIS_API_URL = "https://open.neis.go.kr/hub/mealServiceDietInfo";
const OFFICE_CODE = "D10";
const SCHOOL_CODE = "7240189";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

export interface Dish {
  name: string;
  allergies: string[];
}

export interface Meal {
  type: string;       // "1"=조식, "2"=중식, "3"=석식
  typeName: string;
  dishes: Dish[];
  calories: string;
  nutrition: string[];
}

export interface MealResponse {
  success: boolean;
  date: string;
  meals: Meal[];
  message?: string;
  error?: string;
}

export const ALLERGY_MAP: Record<string, string> = {
  "1": "난류", "2": "우유", "3": "메밀", "4": "땅콩", "5": "대두",
  "6": "밀", "7": "고등어", "8": "게", "9": "새우", "10": "돼지고기",
  "11": "복숭아", "12": "토마토", "13": "아황산류", "14": "호두",
  "15": "닭고기", "16": "쇠고기", "17": "오징어",
  "18": "조개류(굴,전복,홍합 포함)", "19": "잣",
};

function parseDishes(dishString: string): Dish[] {
  if (!dishString) return [];
  return dishString.split("<br/>").map((raw) => {
    const trimmed = raw.trim();
    const match = trimmed.match(/(.+?)\s*\(?([\d.]+)\)?$/);
    if (match) {
      return {
        name: match[1].trim(),
        allergies: match[2].split(".").filter(Boolean),
      };
    }
    return { name: trimmed, allergies: [] };
  });
}

function parseNutrition(nutritionString: string): string[] {
  if (!nutritionString) return [];
  return nutritionString.split("<br/>").map((s) => s.trim()).filter(Boolean);
}

const cache = new Map<string, { data: MealResponse; fetchedAt: number }>();

export async function fetchMeals(date: string): Promise<MealResponse> {
  if (!/^\d{8}$/.test(date)) {
    return { success: false, date, meals: [], error: "잘못된 날짜 형식입니다" };
  }

  const cached = cache.get(date);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const apiKey = process.env.NEIS_API_KEY;
  if (!apiKey) {
    console.warn("[neis-meal] NEIS_API_KEY is not set");
    return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
  }

  try {
    const params = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: "1",
      pSize: "10",
      ATPT_OFCDC_SC_CODE: OFFICE_CODE,
      SD_SCHUL_CODE: SCHOOL_CODE,
      MLSV_YMD: date,
    });

    const res = await fetch(`${NEIS_API_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
    }

    const data = await res.json();

    if (data.RESULT) {
      if (data.RESULT.CODE === "INFO-200") {
        const result: MealResponse = { success: true, date, meals: [], message: "급식 정보가 없습니다" };
        cache.set(date, { data: result, fetchedAt: Date.now() });
        return result;
      }
      return { success: false, date, meals: [], error: data.RESULT.MESSAGE || "API 오류" };
    }

    const rows = data?.mealServiceDietInfo?.[1]?.row;
    if (!rows || rows.length === 0) {
      const result: MealResponse = { success: true, date, meals: [], message: "급식 정보가 없습니다" };
      cache.set(date, { data: result, fetchedAt: Date.now() });
      return result;
    }

    const meals: Meal[] = rows.map((row: Record<string, string>) => ({
      type: row.MMEAL_SC_CODE,
      typeName: row.MMEAL_SC_NM || (row.MMEAL_SC_CODE === "1" ? "조식" : row.MMEAL_SC_CODE === "2" ? "중식" : "석식"),
      dishes: parseDishes(row.DDISH_NM),
      calories: row.CAL_INFO || "",
      nutrition: parseNutrition(row.NTR_INFO),
    }));

    const result: MealResponse = { success: true, date, meals };
    cache.set(date, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    console.error("[neis-meal] fetch error:", err);
    return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
  }
}
