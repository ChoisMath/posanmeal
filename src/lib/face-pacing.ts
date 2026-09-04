export type FaceBackend = "webgpu" | "webgl";

export function resolveFaceBackends(
  override: string | null | undefined,
  hasWebGpu: boolean,
): FaceBackend[] {
  if (override === "webgl") return ["webgl"];
  if (override === "webgpu") return ["webgpu", "webgl"];
  return hasWebGpu ? ["webgpu", "webgl"] : ["webgl"];
}

const MIN_DETECT_GAP_MS = 30;
const MAX_DETECT_GAP_MS = 200;

// 직전 검출 시간에 비례해 UI에 양보할 시간. 빠른 기기는 거의 연속으로 돌고,
// 느린 기기는 검출 자체가 페이스를 제한하므로 상한만 둔다.
export function nextDetectDelay(lastDetectMs: number): number {
  if (!Number.isFinite(lastDetectMs) || lastDetectMs <= 0) return MIN_DETECT_GAP_MS;
  return Math.min(MAX_DETECT_GAP_MS, Math.max(MIN_DETECT_GAP_MS, lastDetectMs / 3));
}
