export class FaceStabilityTracker {
  private userId: number | null = null;
  private context = "";
  private lastObservedAt: number | null = null;
  private lastCountedAt: number | null = null;
  private count = 0;

  constructor(
    private readonly requiredObservations = 3,
    private readonly maxGapMs = 3000,
    private readonly minGapMs = 200,
  ) {}

  observe(userId: number, now: number, context = ""): { ready: boolean; count: number } {
    if (
      this.userId !== userId || this.context !== context ||
      (this.lastObservedAt !== null && (now < this.lastObservedAt || now - this.lastObservedAt > this.maxGapMs))
    ) {
      this.reset();
    }
    this.userId = userId;
    this.context = context;
    this.lastObservedAt = now;
    if (this.lastCountedAt === null || (now > this.lastCountedAt && now - this.lastCountedAt >= this.minGapMs)) {
      this.count = Math.min(this.count + 1, this.requiredObservations);
      this.lastCountedAt = now;
    }
    return { ready: this.count >= this.requiredObservations, count: this.count };
  }

  reset(): void {
    this.userId = null;
    this.context = "";
    this.lastObservedAt = null;
    this.lastCountedAt = null;
    this.count = 0;
  }
}
