import {
  MEAL_LABEL,
  WEEKDAY_LABELS,
  weekdayOf,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

// 일괄신청 양식 컬럼의 단일 진실 — 다운로드(export)와 업로드(import)가 공유한다.
export type TemplateColumn =
  | { kind: MealKind; type: "YN" }
  | { kind: MealKind; type: "DATE"; date: string } // "YYYY-MM-DD"
  | { kind: MealKind; type: "WEEKDAY"; weekday: number }; // 0=일 ~ 6=토

const MEAL_KINDS_ORDER: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];

export function buildTemplateColumns(
  meals: { mealKind: MealKind; method: MealApplyMethod }[],
  openDatesUnion: Partial<Record<MealKind, string[]>>,
): TemplateColumn[] {
  const cols: TemplateColumn[] = [];
  for (const kind of MEAL_KINDS_ORDER) {
    const meal = meals.find((m) => m.mealKind === kind);
    if (!meal || meal.method === "NONE") continue;
    const open = [...(openDatesUnion[kind] ?? [])].sort();

    if (meal.method === "YN") {
      cols.push({ kind, type: "YN" });
    } else if (meal.method === "DATE") {
      for (const date of open) cols.push({ kind, type: "DATE", date });
    } else {
      const weekdays = [...new Set(open.map(weekdayOf))].sort((a, b) => a - b);
      for (const weekday of weekdays) cols.push({ kind, type: "WEEKDAY", weekday });
    }
  }
  return cols;
}

export function columnHeader(col: TemplateColumn): string {
  const label = MEAL_LABEL[col.kind];
  if (col.type === "YN") return label;
  if (col.type === "DATE") {
    const [, m, d] = col.date.split("-");
    return `${label}-${Number(m)}월 ${Number(d)}일`;
  }
  return `${label}-${WEEKDAY_LABELS[col.weekday]}요일`;
}

const LABEL_TO_KIND = new Map<string, MealKind>(
  (Object.entries(MEAL_LABEL) as [MealKind, string][]).map(([k, v]) => [v, k]),
);

/**
 * 헤더 문자열을 컬럼으로 역파싱. months(공고 대상 월 목록)로 연도를 복원한다.
 * 인식할 수 없는 헤더는 null (해당 컬럼 무시).
 */
export function parseColumnHeader(
  header: string,
  months: { year: number; month: number }[],
): TemplateColumn | null {
  const text = header.trim();
  const dashIdx = text.indexOf("-");

  if (dashIdx === -1) {
    const kind = LABEL_TO_KIND.get(text);
    return kind ? { kind, type: "YN" } : null;
  }

  const kind = LABEL_TO_KIND.get(text.slice(0, dashIdx));
  if (!kind) return null;
  const rest = text.slice(dashIdx + 1).trim();

  const dateMatch = rest.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
  if (dateMatch) {
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    const found = months.find((m) => m.month === month);
    if (!found) return null;
    return {
      kind,
      type: "DATE",
      date: `${found.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }

  const wdMatch = rest.match(/^([일월화수목금토])요일$/);
  if (wdMatch) {
    return { kind, type: "WEEKDAY", weekday: WEEKDAY_LABELS.indexOf(wdMatch[1]) };
  }

  return null;
}
