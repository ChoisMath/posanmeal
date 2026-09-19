import { prisma } from "@/lib/prisma";
import type { FaceCandidate } from "@/lib/face-match";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";

let cache: FaceCandidate[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

export async function getFaceCandidates(): Promise<FaceCandidate[]> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL) return cache;

  // 이용 중단 시 FaceProfile을 지우지만, 남아 있더라도 후보가 되지 않게 한 번 더 막는다.
  const rows = await prisma.faceProfile.findMany({
    where: { modelVersion: FACE_MODEL_VERSION, user: { accessState: "ACTIVE" } },
    select: { userId: true, embeddings: true },
  });
  cache = rows.map((row) => ({
    userId: row.userId,
    embeddings: (row.embeddings as number[][]).map((e) => Float32Array.from(e)),
  }));
  cacheTimestamp = Date.now();
  return cache;
}

export function invalidateFaceCache() {
  cache = null;
  cacheTimestamp = 0;
}
