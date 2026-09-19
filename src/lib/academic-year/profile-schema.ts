/**
 * 같은 주소의 표기 차이(앞뒤 공백·대소문자)만 흡수한다. Gmail의 점·별칭처럼
 * 제공자별 규칙을 추측하면 서로 다른 사람을 한 사람으로 묶을 수 있으므로 하지 않는다.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
