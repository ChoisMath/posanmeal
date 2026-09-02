export interface FaceCandidate {
  userId: number;
  embeddings: Float32Array[];
}

export interface FaceMatch {
  userId: number;
  similarity: number;
  runnerUp: number;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function findBestMatch(
  embedding: ArrayLike<number>,
  candidates: FaceCandidate[],
  opts: { threshold: number; margin: number },
): FaceMatch | null {
  let best: { userId: number; similarity: number } | null = null;
  let second = 0;

  for (const candidate of candidates) {
    let sim = -1;
    for (const emb of candidate.embeddings) {
      const s = cosineSimilarity(embedding, emb);
      if (s > sim) sim = s;
    }
    if (!best || sim > best.similarity) {
      if (best) second = best.similarity;
      best = { userId: candidate.userId, similarity: sim };
    } else if (sim > second) {
      second = sim;
    }
  }

  if (!best) return null;
  if (best.similarity < opts.threshold) return null;
  if (candidates.length >= 2 && best.similarity - second < opts.margin) return null;
  return { userId: best.userId, similarity: best.similarity, runnerUp: second };
}
