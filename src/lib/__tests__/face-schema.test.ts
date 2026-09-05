import { describe, expect, it } from "vitest";
import { faceEnrollSchema, faceCheckSchema } from "@/lib/schemas/face";
import { FACE_EMBEDDING_DIM } from "@/lib/face-constants";

const validEmbedding = Array.from({ length: FACE_EMBEDDING_DIM }, () => 0.1);

describe("faceEnrollSchema", () => {
  it("3~5개의 FACE_EMBEDDING_DIM차원 임베딩 + consentVersion 허용", () => {
    const r = faceEnrollSchema.safeParse({
      embeddings: [validEmbedding, validEmbedding, validEmbedding],
      consentVersion: "2026-09-v1",
    });
    expect(r.success).toBe(true);
  });

  it("2개 이하 거부", () => {
    expect(
      faceEnrollSchema.safeParse({ embeddings: [validEmbedding, validEmbedding], consentVersion: "v" }).success,
    ).toBe(false);
  });

  it("차원이 다르면 거부", () => {
    expect(
      faceEnrollSchema.safeParse({
        embeddings: [validEmbedding, validEmbedding, [1, 2, 3]],
        consentVersion: "v",
      }).success,
    ).toBe(false);
  });

  it("NaN/Infinity 거부", () => {
    const bad = [...validEmbedding];
    bad[0] = Infinity;
    expect(
      faceEnrollSchema.safeParse({
        embeddings: [validEmbedding, validEmbedding, bad],
        consentVersion: "v",
      }).success,
    ).toBe(false);
  });
});

describe("faceCheckSchema", () => {
  it("embedding만 허용 (type 생략 가능)", () => {
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding }).success).toBe(true);
  });
  it("type WORK/PERSONAL 허용, 그 외 거부", () => {
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding, type: "WORK" }).success).toBe(true);
    expect(faceCheckSchema.safeParse({ embedding: validEmbedding, type: "STUDENT" }).success).toBe(false);
  });
});
