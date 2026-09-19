import { describe, expect, it } from "vitest";
import { FaceStabilityTracker } from "@/lib/face-stability";

describe("FaceStabilityTracker", () => {
  it("requires three distinct sufficiently spaced observations of the same candidate", () => {
    const tracker = new FaceStabilityTracker();
    expect(tracker.observe(1, 1000)).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(1, 1000)).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(1, 1100)).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(1, 1200)).toEqual({ ready: false, count: 2 });
    expect(tracker.observe(1, 1400)).toEqual({ ready: true, count: 3 });
  });

  it("restarts when the user or meal context changes", () => {
    const tracker = new FaceStabilityTracker();
    tracker.observe(1, 1000, "2026-09-19:LUNCH");
    tracker.observe(1, 1200, "2026-09-19:LUNCH");
    expect(tracker.observe(2, 1400, "2026-09-19:LUNCH")).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(2, 1600, "2026-09-19:DINNER")).toEqual({ ready: false, count: 1 });
  });

  it("restarts after a long gap, reversed clock or explicit reset", () => {
    const tracker = new FaceStabilityTracker();
    tracker.observe(1, 1000);
    tracker.observe(1, 1200);
    expect(tracker.observe(1, 4201)).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(1, 4000)).toEqual({ ready: false, count: 1 });
    tracker.observe(1, 4200);
    tracker.reset();
    expect(tracker.observe(1, 4400)).toEqual({ ready: false, count: 1 });
  });

  it("supports custom observation count and timing boundaries", () => {
    const tracker = new FaceStabilityTracker(2, 500, 100);
    expect(tracker.observe(1, 0)).toEqual({ ready: false, count: 1 });
    expect(tracker.observe(1, 500)).toEqual({ ready: true, count: 2 });
    expect(tracker.observe(1, 1001)).toEqual({ ready: false, count: 1 });
  });
});
