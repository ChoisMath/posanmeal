import type { Db } from "./db";
import { rosterMode, type RosterMode } from "./registration-context";

const CACHE_TTL_MS = 30_000;

let cached: RosterMode | null = null;
let cachedAt = 0;

/**
 * 식당 줄에서 1초에 여러 번 지나가는 경로(QR·얼굴 체크인) 전용. PREPARING→READY는
 * 운영 중 한 번뿐이므로 짧게 캐시한다. 같은 프로세스의 `enableAcademicMode`는
 * 즉시 무효화하지만 별도 CLI 전환은 앱 재시작 또는 TTL 만료 후 반영된다.
 * 쓰기 경로는 캐시를 쓰지 않는다.
 */
export async function getCachedRosterMode(db: Db): Promise<RosterMode> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  cached = await rosterMode(db);
  cachedAt = Date.now();
  return cached;
}

export function invalidateRosterModeCache(): void {
  cached = null;
  cachedAt = 0;
}
