import { describe, expect, it } from "vitest";
import { qualityIssue } from "@/lib/human-client";
import { enrollmentQualityIssue, type FacePose } from "@/lib/face-quality";

const radians = (degrees: number) => degrees * Math.PI / 180;

describe("enrollmentQualityIssue", () => {
  it("충분히 크고 프레임 안에 있으며 정면인 얼굴은 화면 중심이 아니어도 통과시킨다", () => {
    expect(enrollmentQualityIssue({
      frame: { width: 1280, height: 720 },
      box: { x: 40, y: 90, width: 180, height: 190 },
      pose: { yaw: radians(8), pitch: radians(-6), roll: radians(4) },
    })).toBeNull();
  });

  it("해상도에 비해 작은 얼굴은 저장 후보에서 제외한다", () => {
    expect(enrollmentQualityIssue({
      frame: { width: 1280, height: 720 },
      box: { x: 560, y: 280, width: 72, height: 78 },
      pose: { yaw: 0, pitch: 0, roll: 0 },
    })).toBe("tooSmall");
  });

  it("얼굴 상자가 프레임 경계를 넘으면 저장 후보에서 제외한다", () => {
    expect(enrollmentQualityIssue({
      frame: { width: 640, height: 480 },
      box: { x: -3, y: 130, width: 130, height: 150 },
      pose: { yaw: 0, pitch: 0, roll: 0 },
    })).toBe("clipped");
  });

  it("Human이 프레임 모서리까지 자른 상자는 저장 후보에서 제외한다", () => {
    expect(enrollmentQualityIssue({
      frame: { width: 640, height: 480 },
      box: { x: 0, y: 130, width: 130, height: 150 },
      pose: { yaw: 0, pitch: 0, roll: 0 },
    })).toBe("clipped");
  });

  it.each([
    { x: 0, y: 100, width: 130, height: 150 },
    { x: 510, y: 100, width: 130, height: 150 },
    { x: 200, y: 0, width: 130, height: 150 },
    { x: 200, y: 330, width: 130, height: 150 },
  ])("모델이 얼굴 상자를 영상 끝에서 잘라 반환해도 등록하지 않는다: %o", (box) => {
    expect(enrollmentQualityIssue({
      frame: { width: 640, height: 480 },
      box,
      pose: { yaw: 0, pitch: 0, roll: 0 },
    })).toBe("clipped");
  });

  it.each<[FacePose]>([
    [{ yaw: radians(29), pitch: 0, roll: 0 }],
    [{ yaw: 0, pitch: radians(-23), roll: 0 }],
    [{ yaw: 0, pitch: 0, roll: radians(19) }],
  ])("Human이 반환하는 라디안 각도가 허용 범위를 넘으면 정면을 안내한다: %o", (pose) => {
    expect(enrollmentQualityIssue({
      frame: { width: 640, height: 480 },
      box: { x: 220, y: 120, width: 130, height: 150 },
      pose,
    })).toBe("turned");
  });

  it.each([
    [{ width: 640, height: 480 }, { x: 12, y: 20, width: 110, height: 120 }],
    [{ width: 1920, height: 1080 }, { x: 1650, y: 80, width: 200, height: 215 }],
  ] as const)("서로 다른 카메라 해상도에서도 화면 대비 충분한 얼굴은 통과시킨다", (frame, box) => {
    expect(enrollmentQualityIssue({
      frame,
      box,
      pose: { yaw: 0, pitch: 0, roll: 0 },
    })).toBeNull();
  });
});

describe("qualityIssue", () => {
  it("기존 실제얼굴·라이브니스 차단은 등록 품질 판정과 별도로 유지한다", () => {
    expect(qualityIssue({
      embedding: [0.1],
      real: 0.49,
      live: 0.9,
      score: 0.99,
      geometry: null,
    })).toBe("spoof");
  });
});
