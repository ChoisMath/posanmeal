import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  faceProfileFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { faceProfile: { findMany: mocks.faceProfileFindMany } },
}));

describe("face-embedding-cache", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { invalidateFaceCache } = await import("@/lib/face-embedding-cache");
    invalidateFaceCache();
  });

  it("DB rows를 Float32Array 후보로 변환", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([
      { userId: 1, embeddings: [[0.1, 0.2], [0.3, 0.4]] },
    ]);
    const { getFaceCandidates } = await import("@/lib/face-embedding-cache");
    const candidates = await getFaceCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].userId).toBe(1);
    expect(candidates[0].embeddings[0]).toBeInstanceOf(Float32Array);
    expect(candidates[0].embeddings[1][1]).toBeCloseTo(0.4);
  });

  it("TTL 내 재호출은 DB 재조회 없음", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([]);
    const { getFaceCandidates } = await import("@/lib/face-embedding-cache");
    await getFaceCandidates();
    await getFaceCandidates();
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidate 후에는 재조회", async () => {
    mocks.faceProfileFindMany.mockResolvedValue([]);
    const { getFaceCandidates, invalidateFaceCache } = await import("@/lib/face-embedding-cache");
    await getFaceCandidates();
    invalidateFaceCache();
    await getFaceCandidates();
    expect(mocks.faceProfileFindMany).toHaveBeenCalledTimes(2);
  });
});
