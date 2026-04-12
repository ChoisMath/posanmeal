import { prisma } from "@/lib/prisma";

let cache: { operationMode: string; qrGeneration: string } | null = null;
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
  };
  cacheTimestamp = Date.now();
  return cache;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheTimestamp = 0;
}
