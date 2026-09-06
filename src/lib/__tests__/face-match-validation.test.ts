import { describe, expect, it } from "vitest";
import { parseFaceMatchForm, toFaceMatchForm } from "@/lib/face-match-validation";

describe("parseFaceMatchForm", () => {
  it("정상 값은 소수 둘째 자리로 반올림해 반환", () => {
    expect(parseFaceMatchForm({ threshold: "0.555", margin: "0.05" })).toEqual({ values: { threshold: 0.56, margin: 0.05 } });
  });

  it("빈 값·숫자 아님은 오류", () => {
    expect(parseFaceMatchForm({ threshold: "", margin: "0.05" })).toEqual({ error: "숫자를 입력해주세요" });
    expect(parseFaceMatchForm({ threshold: "abc", margin: "0.05" })).toEqual({ error: "숫자를 입력해주세요" });
  });

  it("임계값 범위 0.30~0.90 밖은 오류", () => {
    expect(parseFaceMatchForm({ threshold: "0.29", margin: "0" })).toEqual({ error: "임계값은 0.30~0.90 사이여야 합니다" });
    expect(parseFaceMatchForm({ threshold: "0.91", margin: "0" })).toEqual({ error: "임계값은 0.30~0.90 사이여야 합니다" });
    expect(parseFaceMatchForm({ threshold: "0.9", margin: "0" })).toEqual({ values: { threshold: 0.9, margin: 0 } });
  });

  it("마진 범위 0~0.30 밖은 오류", () => {
    expect(parseFaceMatchForm({ threshold: "0.55", margin: "-0.01" })).toEqual({ error: "2위와 차이는 0.00~0.30 사이여야 합니다" });
    expect(parseFaceMatchForm({ threshold: "0.55", margin: "0.31" })).toEqual({ error: "2위와 차이는 0.00~0.30 사이여야 합니다" });
  });
});

describe("toFaceMatchForm", () => {
  it("숫자를 두 자리 문자열로", () => {
    expect(toFaceMatchForm({ threshold: 0.55, margin: 0.05 })).toEqual({ threshold: "0.55", margin: "0.05" });
    expect(toFaceMatchForm({ threshold: 0.6, margin: 0 })).toEqual({ threshold: "0.60", margin: "0.00" });
  });
});
