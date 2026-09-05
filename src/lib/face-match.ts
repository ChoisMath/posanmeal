export interface FaceCandidate {
  userId: number;
  embeddings: Float32Array[];
}

export interface FaceScore {
  userId: number;
  similarity: number;
}

export interface FaceMatch {
  userId: number;
  similarity: number;
  runnerUp: number;
}

export interface MatchScore {
  similarity?: number;
  runnerUp?: number;
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

// 사용자별 최고 유사도를 내림차순으로. 차원이 다른 임베딩(구 모델로 등록된 프로필)은 비교에서 제외한다.
export function rankCandidates(embedding: ArrayLike<number>, candidates: FaceCandidate[]): FaceScore[] {
  const scores: FaceScore[] = [];
  for (const candidate of candidates) {
    let best = -Infinity;
    for (const emb of candidate.embeddings) {
      if (emb.length !== embedding.length) continue;
      const s = cosineSimilarity(embedding, emb);
      if (s > best) best = s;
    }
    if (best > -Infinity) scores.push({ userId: candidate.userId, similarity: best });
  }
  return scores.sort((x, y) => y.similarity - x.similarity);
}

export function decideMatch(ranked: FaceScore[], opts: { threshold: number; margin: number }): FaceMatch | null {
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1]?.similarity ?? 0;
  if (best.similarity < opts.threshold) return null;
  if (ranked.length >= 2 && best.similarity - second < opts.margin) return null;
  return { userId: best.userId, similarity: best.similarity, runnerUp: second };
}

export function findBestMatch(
  embedding: ArrayLike<number>,
  candidates: FaceCandidate[],
  opts: { threshold: number; margin: number },
): FaceMatch | null {
  return decideMatch(rankCandidates(embedding, candidates), opts);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// 응답에 실어 현장에서 임계값을 조정할 수 있게 하는 1·2위 점수 요약
export function scoreSummary(ranked: FaceScore[]): MatchScore {
  const summary: MatchScore = {};
  if (ranked[0]) summary.similarity = round3(ranked[0].similarity);
  if (ranked[1]) summary.runnerUp = round3(ranked[1].similarity);
  return summary;
}
