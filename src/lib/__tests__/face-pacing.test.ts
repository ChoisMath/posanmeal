import { describe, expect, it } from "vitest";
import { nextDetectDelay, resolveFaceBackends } from "@/lib/face-pacing";

describe("resolveFaceBackends", () => {
  it("override webgl → webgl만", () => {
    expect(resolveFaceBackends("webgl", true)).toEqual(["webgl"]);
  });
  it("override webgpu → webgpu 후 webgl 폴백", () => {
    expect(resolveFaceBackends("webgpu", false)).toEqual(["webgpu", "webgl"]);
  });
  it("override 없음 + WebGPU 지원 → webgpu 우선", () => {
    expect(resolveFaceBackends(null, true)).toEqual(["webgpu", "webgl"]);
  });
  it("override 없음 + WebGPU 미지원 → webgl만", () => {
    expect(resolveFaceBackends(undefined, false)).toEqual(["webgl"]);
    expect(resolveFaceBackends("garbage", false)).toEqual(["webgl"]);
  });
});

describe("nextDetectDelay", () => {
  it("검출 시간의 1/3, 30~200ms 클램프", () => {
    expect(nextDetectDelay(0)).toBe(30);
    expect(nextDetectDelay(40)).toBe(30);
    expect(nextDetectDelay(300)).toBe(100);
    expect(nextDetectDelay(900)).toBe(200);
    expect(nextDetectDelay(5000)).toBe(200);
  });
  it("비정상 입력은 최소값", () => {
    expect(nextDetectDelay(Number.NaN)).toBe(30);
    expect(nextDetectDelay(-50)).toBe(30);
  });
});
