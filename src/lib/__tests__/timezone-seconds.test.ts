// src/lib/__tests__/timezone-seconds.test.ts
import { describe, expect, it } from "vitest";
import { formatDateTimeSecondsKST } from "@/lib/timezone";

describe("formatDateTimeSecondsKST", () => {
  it("formats a UTC ISO date as KST 'YYYY-MM-DD HH:MM:SS'", () => {
    // 2026-05-10T01:23:45Z is 2026-05-10 10:23:45 KST (UTC+9)
    const date = new Date("2026-05-10T01:23:45.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 10:23:45");
  });

  it("formats midnight UTC as 09:00:00 KST same day", () => {
    const date = new Date("2026-05-10T00:00:00.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 09:00:00");
  });

  it("crosses date boundary correctly (15:30 UTC = 00:30 KST next day)", () => {
    const date = new Date("2026-05-09T15:30:00.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 00:30:00");
  });
});
