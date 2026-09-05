import { describe, expect, it } from "vitest";
import { UnmatchedTracker } from "@/lib/unmatched-tracker";

const OPTS = { sameFaceSimilarity: 0.6, confirmWindowMs: 3000, suppressMs: 10_000 };
const A = [1, 0, 0, 0];
const A_NEXT_FRAME = [0.95, 0.3, 0, 0];
const B = [0, 1, 0, 0];

describe("UnmatchedTracker", () => {
  it("처음 본 얼굴은 pending, 같은 얼굴이 확인 창 안에 다시 보이면 confirm", () => {
    const t = new UnmatchedTracker(OPTS);
    expect(t.observe(A, 0)).toBe("pending");
    expect(t.observe(A_NEXT_FRAME, 500)).toBe("confirm");
  });

  it("확정 뒤 같은 얼굴은 suppressMs 동안 suppressed, 지나면 다시 pending", () => {
    const t = new UnmatchedTracker(OPTS);
    t.observe(A, 0);
    t.observe(A, 500);
    expect(t.observe(A_NEXT_FRAME, 3000)).toBe("suppressed");
    expect(t.observe(A, 10_600)).toBe("pending");
  });

  it("다른 얼굴은 확정으로 이어지지 않고 pending을 교체한다", () => {
    const t = new UnmatchedTracker(OPTS);
    expect(t.observe(A, 0)).toBe("pending");
    expect(t.observe(B, 500)).toBe("pending");
    expect(t.observe(B, 900)).toBe("confirm");
  });

  it("확인 창이 지나면 같은 얼굴도 다시 pending", () => {
    const t = new UnmatchedTracker(OPTS);
    t.observe(A, 0);
    expect(t.observe(A, 3500)).toBe("pending");
  });

  it("억제 중인 얼굴과 다른 얼굴은 독립적으로 확정된다", () => {
    const t = new UnmatchedTracker(OPTS);
    t.observe(A, 0);
    t.observe(A, 100);
    expect(t.observe(B, 200)).toBe("pending");
    expect(t.observe(B, 400)).toBe("confirm");
    expect(t.observe(A, 500)).toBe("suppressed");
  });
});
