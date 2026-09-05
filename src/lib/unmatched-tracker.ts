import { cosineSimilarity } from "@/lib/face-match";

export type UnmatchedVerdict = "pending" | "confirm" | "suppressed";

export interface UnmatchedTrackerOptions {
  sameFaceSimilarity: number;
  confirmWindowMs: number;
  suppressMs: number;
}

interface Sighting {
  embedding: Float32Array;
  at: number;
}

// 미등록 얼굴 거부는 카드·오류음이 나가므로, 한 프레임 스쳐 간 얼굴이 아니라
// 같은 얼굴이 짧은 시간 안에 다시 보일 때만 확정하고, 확정 뒤에는 같은 얼굴에 대해 잠시 억제한다.
export class UnmatchedTracker {
  private pending: Sighting | null = null;
  private rejected: Sighting[] = [];

  constructor(private readonly opts: UnmatchedTrackerOptions) {}

  observe(embedding: ArrayLike<number>, now: number): UnmatchedVerdict {
    const current = Float32Array.from(embedding);
    const { sameFaceSimilarity, confirmWindowMs, suppressMs } = this.opts;
    this.rejected = this.rejected.filter((r) => r.at > now);
    if (this.rejected.some((r) => cosineSimilarity(r.embedding, current) >= sameFaceSimilarity)) return "suppressed";
    const p = this.pending;
    if (p && now - p.at <= confirmWindowMs && cosineSimilarity(p.embedding, current) >= sameFaceSimilarity) {
      this.pending = null;
      this.rejected.push({ embedding: current, at: now + suppressMs });
      return "confirm";
    }
    this.pending = { embedding: current, at: now };
    return "pending";
  }
}
