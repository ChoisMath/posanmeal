export interface FaceMatchForm {
  threshold: string;
  margin: string;
}

export interface FaceMatchValues {
  threshold: number;
  margin: number;
}

// 서버(/api/system/settings)는 threshold 0<x≤1, margin 0≤x≤0.5까지 받지만
// 그 밖의 값은 현장에서 쓸 일이 없어 입력 단계에서 더 좁게 막는다.
export const FACE_THRESHOLD_RANGE = { min: 0.3, max: 0.9 } as const;
export const FACE_MARGIN_RANGE = { min: 0, max: 0.3 } as const;

const ERROR_NUMBER = "숫자를 입력해주세요";
const ERROR_THRESHOLD_RANGE = "임계값은 0.30~0.90 사이여야 합니다";
const ERROR_MARGIN_RANGE = "2위와 차이는 0.00~0.30 사이여야 합니다";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function toFaceMatchForm(values: FaceMatchValues): FaceMatchForm {
  return { threshold: values.threshold.toFixed(2), margin: values.margin.toFixed(2) };
}

export function parseFaceMatchForm(form: FaceMatchForm): { values: FaceMatchValues } | { error: string } {
  const threshold = parseNumber(form.threshold);
  const margin = parseNumber(form.margin);
  if (threshold === null || margin === null) return { error: ERROR_NUMBER };
  if (threshold < FACE_THRESHOLD_RANGE.min || threshold > FACE_THRESHOLD_RANGE.max) return { error: ERROR_THRESHOLD_RANGE };
  if (margin < FACE_MARGIN_RANGE.min || margin > FACE_MARGIN_RANGE.max) return { error: ERROR_MARGIN_RANGE };
  return { values: { threshold: round2(threshold), margin: round2(margin) } };
}
