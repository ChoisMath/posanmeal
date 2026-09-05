import { prisma } from "@/lib/prisma";
import type { FaceCandidate } from "@/lib/face-match";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";

let cache: FaceCandidate[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

export async function getFaceCandidates(): Promise<FaceCandidate[]> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL) return cache;

  const rows = await prisma.faceProfile.findMany({
    where: { modelVersion: FACE_MODEL_VERSION },
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
