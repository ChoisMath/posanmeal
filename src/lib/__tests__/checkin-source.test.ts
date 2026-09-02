import { describe, expect, it } from "vitest";
import { sourceLabel } from "@/lib/checkin-source";

describe("sourceLabel", () => {
  it("출처별 한국어 라벨", () => {
    expect(sourceLabel("QR")).toBe("QR");
    expect(sourceLabel("ADMIN_MANUAL")).toBe("관리자");
    expect(sourceLabel("LOCAL_SYNC")).toBe("로컬");
    expect(sourceLabel("FACE")).toBe("안면");
  });

  it("null/undefined는 대시", () => {
    expect(sourceLabel(null)).toBe("—");
    expect(sourceLabel(undefined)).toBe("—");
  });
});
