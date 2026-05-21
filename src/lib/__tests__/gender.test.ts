import { describe, it, expect } from "vitest";
import { normalizeGender, genderLabel, GENDER_LABEL } from "@/lib/gender";

describe("normalizeGender", () => {
  it("한글 남/여를 매핑한다", () => {
    expect(normalizeGender("남")).toBe("MALE");
    expect(normalizeGender("여")).toBe("FEMALE");
  });

  it("영문 약어 M/F를 매핑한다", () => {
    expect(normalizeGender("M")).toBe("MALE");
    expect(normalizeGender("F")).toBe("FEMALE");
    expect(normalizeGender("m")).toBe("MALE");
    expect(normalizeGender("f")).toBe("FEMALE");
  });

  it("영문 단어 MALE/FEMALE/BOY/GIRL을 매핑한다", () => {
    expect(normalizeGender("MALE")).toBe("MALE");
    expect(normalizeGender("FEMALE")).toBe("FEMALE");
    expect(normalizeGender("Male")).toBe("MALE");
    expect(normalizeGender("female")).toBe("FEMALE");
    expect(normalizeGender("BOY")).toBe("MALE");
    expect(normalizeGender("girl")).toBe("FEMALE");
  });

  it("공백 패딩을 무시한다", () => {
    expect(normalizeGender("  남  ")).toBe("MALE");
    expect(normalizeGender("\t여\n")).toBe("FEMALE");
  });

  it("빈 값/공백/null/undefined는 null을 반환한다", () => {
    expect(normalizeGender("")).toBe(null);
    expect(normalizeGender("   ")).toBe(null);
    expect(normalizeGender(null)).toBe(null);
    expect(normalizeGender(undefined)).toBe(null);
  });

  it("인식 불가 값은 INVALID를 반환한다", () => {
    expect(normalizeGender("?")).toBe("INVALID");
    expect(normalizeGender("남자")).toBe("INVALID");
    expect(normalizeGender("X")).toBe("INVALID");
    expect(normalizeGender("기타")).toBe("INVALID");
  });
});

describe("genderLabel", () => {
  it("enum 값을 한글로 변환한다", () => {
    expect(genderLabel("MALE")).toBe("남");
    expect(genderLabel("FEMALE")).toBe("여");
  });

  it("null/undefined는 dash를 반환한다", () => {
    expect(genderLabel(null)).toBe("—");
    expect(genderLabel(undefined)).toBe("—");
  });
});

describe("GENDER_LABEL", () => {
  it("enum 키 매핑이 일관된다", () => {
    expect(GENDER_LABEL.MALE).toBe("남");
    expect(GENDER_LABEL.FEMALE).toBe("여");
  });
});
