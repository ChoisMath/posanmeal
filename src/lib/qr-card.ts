const CARD_TYPE = "STUDENT";

/** 카드에 인쇄되는 고정 로컬 QR 문자열. mealKind 생략(4-part) → 조/중/석 무관, 스캔 시각으로 식사 판정. */
export function buildCardQrString(studentId: number, generation: string): string {
  return `posanmeal:${studentId}:${generation}:${CARD_TYPE}`;
}

/** items 를 size 개씩 끊어 페이지 배열로. 빈 입력은 빈 배열. */
export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}
