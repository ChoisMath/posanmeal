import type { Db } from "./db";
import { rosterMode, type RosterMode } from "./registration-context";

const CACHE_TTL_MS = 30_000;

let cached: RosterMode | null = null;
let cachedAt = 0;

/**
 * 식당 줄에서 1초에 여러 번 지나가는 경로(QR·얼굴 체크인) 전용. PREPARING→READY는
 * 운영 중 단 한 번뿐이고 그 전환은 `enableAcademicMode`가 이 값을 바로 버리므로,
 * 매 프레임 `RosterControl`을 다시 읽을 이유가 없다. 쓰기 경로는 캐시를 쓰지 않는다.
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
