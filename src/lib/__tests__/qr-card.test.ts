import { describe, it, expect } from "vitest";
import { buildCardQrString, chunk } from "@/lib/qr-card";

describe("buildCardQrString", () => {
  it("4-part posanmeal 문자열을 만든다 (mealKind 없음)", () => {
    expect(buildCardQrString(42, "3")).toBe("posanmeal:42:3:STUDENT");
  });

  it("check 페이지 parseLocalQR 4-part 계약과 호환된다", () => {
    // parseLocalQR: parts.length === 4, parts[0]==='posanmeal', mealKind=parts[4](undefined)
    const parts = buildCardQrString(7, "1").split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("posanmeal");
    expect(parts[3]).toBe("STUDENT");
    expect(parts[4]).toBeUndefined();
  });
});

describe("chunk", () => {
  it("16개씩 페이지로 분할한다", () => {
    const arr = Array.from({ length: 35 }, (_, i) => i);
    const pages = chunk(arr, 16);
    expect(pages.length).toBe(3);
    expect(pages[0].length).toBe(16);
    expect(pages[1].length).toBe(16);
    expect(pages[2].length).toBe(3);
  });

  it("빈 배열은 빈 결과", () => {
    expect(chunk<number>([], 16)).toEqual([]);
  });
});
