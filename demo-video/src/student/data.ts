export const STUDENT = {
  name: "이가온",
  grade: 1,
  classNum: 2,
  number: 7,
  studentNumber: "10207",
  email: "gaon.student@example.com",
  otherEmail: "gaon.personal@example.com",
} as const;

export const MOCK_DATE = {
  year: 2026,
  month: 9,
  day: 18,
  label: "2026년 9월 18일 (금)",
} as const;

export const MOCK_DISHES = [
  { label: "석식", calories: "782.4 Kcal", color: "#4f46e5", dishes: [
    ["현미밥", ""], ["쇠고기미역국", "대두 · 쇠고기"], ["닭갈비", "대두 · 닭고기"],
    ["감자채볶음", ""], ["배추김치", ""], ["사과", ""],
  ] },
  { label: "중식", calories: "725.8 Kcal", color: "#16a34a", dishes: [
    ["차수수밥", ""], ["된장국", "대두"], ["돼지고기수육", "돼지고기"], ["배추김치", ""],
  ] },
  { label: "조식", calories: "638.2 Kcal", color: "#d97706", dishes: [
    ["쌀밥", ""], ["달걀찜", "달걀"], ["우유", "우유"],
  ] },
] as const;

export const HISTORY_TIMES: Readonly<Record<number, readonly string[]>> = {
  1: ["12:21", "18:07"], 2: ["12:23", "18:03"], 3: ["12:20", "18:08"], 4: ["12:24", "18:10"],
  7: ["12:22", "18:04"], 8: ["12:21", "18:06"], 9: ["12:24", "18:05"], 10: ["12:21", "18:08"],
  11: ["12:25", "18:02"], 14: ["12:21", "18:08"], 15: ["12:22", "18:07"],
  16: ["12:20", "18:04"], 17: ["12:23", "18:06"], 18: ["12:22", "18:05"],
};

export const APPLICATION = {
  title: "2026년 10월 석식 신청",
  dateRange: "2026. 9. 18. ~ 2026. 9. 25.",
  period: "09-18 09시00분 ~ 09-25 17시00분",
  price: 5500,
  days: 20,
  total: 110000,
  selectedDays: [1, 2, 5, 6, 7, 8, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29],
} as const;

export const APP_COLORS = {
  ink: "#2b2927",
  muted: "#7d736a",
  line: "#ebe6df",
  orange: "oklch(0.72 0.17 55)",
  header: "linear-gradient(135deg, oklch(0.72 0.17 55) 0%, oklch(0.68 0.19 42) 100%)",
  warm: "linear-gradient(180deg, oklch(0.97 0.01 70) 0%, oklch(0.98 0.004 80) 100%)",
  card: "#ffffff",
  green: "#059669",
} as const;
