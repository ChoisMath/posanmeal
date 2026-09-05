import { describe, expect, it } from "vitest";
import { cosineSimilarity, decideMatch, findBestMatch, rankCandidates, scoreSummary, type FaceCandidate } from "@/lib/face-match";

function unitVec(dim: number, axis: number): Float32Array {
  const v = new Float32Array(dim);
  v[axis] = 1;
  return v;
}

// 테스트는 4차원으로 충분 — 알고리즘은 차원 무관
const A = unitVec(4, 0);
const B = unitVec(4, 1);
const NEAR_A = Float32Array.from([0.95, 0.05, 0, 0]);

const candidates: FaceCandidate[] = [
  { userId: 1, embeddings: [A] },
  { userId: 2, embeddings: [B] },
];

describe("cosineSimilarity", () => {
  it("동일 벡터는 1", () => {
    expect(cosineSimilarity(A, A)).toBeCloseTo(1);
  });
  it("직교 벡터는 0", () => {
    expect(cosineSimilarity(A, B)).toBeCloseTo(0);
  });
  it("영벡터는 0 (NaN 금지)", () => {
    expect(cosineSimilarity(new Float32Array(4), A)).toBe(0);
  });
});

describe("findBestMatch", () => {
  const opts = { threshold: 0.55, margin: 0.05 };

  it("임계값 이상 + 마진 충족 시 최고 후보 반환", () => {
    const m = findBestMatch(NEAR_A, candidates, opts);
    expect(m?.userId).toBe(1);
    expect(m!.similarity).toBeGreaterThan(0.9);
  });

  it("임계값 미달이면 null", () => {
    expect(findBestMatch(Float32Array.from([0.3, 0.3, 0.9, 0]), candidates, { threshold: 0.9, margin: 0 })).toBeNull();
  });

  it("1·2위 격차가 마진 미달이면 null", () => {
    const ambiguous: FaceCandidate[] = [
      { userId: 1, embeddings: [Float32Array.from([1, 0.9, 0, 0])] },
      { userId: 2, embeddings: [Float32Array.from([0.9, 1, 0, 0])] },
    ];
    expect(findBestMatch(Float32Array.from([1, 1, 0, 0]), ambiguous, { threshold: 0.5, margin: 0.05 })).toBeNull();
  });

  it("등록자가 1명이면 마진 조건 생략", () => {
    const solo = [{ userId: 7, embeddings: [A] }];
    const m = findBestMatch(NEAR_A, solo, { threshold: 0.55, margin: 0.99 });
    expect(m?.userId).toBe(7);
  });

  it("사용자별 유사도는 임베딩들 중 최대값", () => {
    const multi: FaceCandidate[] = [
      { userId: 1, embeddings: [B, A] }, // A가 더 가까움 → max 사용
      { userId: 2, embeddings: [B] },
    ];
    const m = findBestMatch(NEAR_A, multi, opts);
    expect(m?.userId).toBe(1);
  });

  it("후보가 없으면 null", () => {
    expect(findBestMatch(A, [], opts)).toBeNull();
  });
});

describe("rankCandidates / decideMatch / scoreSummary", () => {
  it("사용자별 최고 유사도로 내림차순 정렬", () => {
    const ranked = rankCandidates(NEAR_A, candidates);
    expect(ranked.map((r) => r.userId)).toEqual([1, 2]);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });

  it("차원이 다른(구 모델) 임베딩은 비교에서 제외", () => {
    const legacy: FaceCandidate[] = [
      { userId: 1, embeddings: [Float32Array.from([1, 0, 0, 0, 0, 0])] },
      { userId: 2, embeddings: [B] },
    ];
    const ranked = rankCandidates(NEAR_A, legacy);
    expect(ranked.map((r) => r.userId)).toEqual([2]);
    // 비교 가능한 후보가 1명뿐이면 마진 조건도 생략된다
    expect(decideMatch(ranked, { threshold: 0, margin: 0.99 })?.userId).toBe(2);
  });

  it("전 후보가 구 모델이면 매칭 없음", () => {
    const legacyOnly: FaceCandidate[] = [{ userId: 1, embeddings: [Float32Array.from([1, 0, 0, 0, 0, 0])] }];
    expect(rankCandidates(NEAR_A, legacyOnly)).toEqual([]);
    expect(findBestMatch(NEAR_A, legacyOnly, { threshold: 0, margin: 0 })).toBeNull();
  });

  it("scoreSummary는 1·2위를 소수 3자리로", () => {
    expect(scoreSummary([{ userId: 1, similarity: 0.98765 }, { userId: 2, similarity: 0.12344 }])).toEqual({
      similarity: 0.988,
      runnerUp: 0.123,
    });
    expect(scoreSummary([])).toEqual({});
  });
});
