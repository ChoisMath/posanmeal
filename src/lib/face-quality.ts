export interface FaceFrame {
  width: number;
  height: number;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FacePose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface EnrollmentFaceGeometry {
  frame: FaceFrame;
  box: FaceBox;
  pose: FacePose;
}

export type EnrollmentQualityIssue = "tooSmall" | "clipped" | "turned" | null;

export const ENROLLMENT_FACE_QUALITY = {
  minShortEdgePx: 96,
  minShortEdgeRatio: 0.18,
  frameInsetPx: 2,
  maxYawRadians: 28 * Math.PI / 180,
  maxPitchRadians: 22 * Math.PI / 180,
  maxRollRadians: 18 * Math.PI / 180,
} as const;

function isWithinFrame(box: FaceBox, frame: FaceFrame): boolean {
  // Human의 box는 영상 끝에서 잘리고 정수화되므로 경계에 닿는 얼굴도 제외한다.
  const inset = ENROLLMENT_FACE_QUALITY.frameInsetPx;
  return box.x >= inset
    && box.y >= inset
    && box.x + box.width <= frame.width - inset
    && box.y + box.height <= frame.height - inset;
}

export function enrollmentQualityIssue(geometry: EnrollmentFaceGeometry): EnrollmentQualityIssue {
  const { box, frame, pose } = geometry;
  if (!isWithinFrame(box, frame)) return "clipped";

  // 저해상도 카메라에서는 절대 픽셀 하한을, 고해상도 카메라에서는 화면 대비 크기를 적용한다.
  const requiredShortEdge = Math.max(
    ENROLLMENT_FACE_QUALITY.minShortEdgePx,
    Math.min(frame.width, frame.height) * ENROLLMENT_FACE_QUALITY.minShortEdgeRatio,
  );
  if (Math.min(box.width, box.height) < requiredShortEdge) return "tooSmall";

  if (Math.abs(pose.yaw) > ENROLLMENT_FACE_QUALITY.maxYawRadians
    || Math.abs(pose.pitch) > ENROLLMENT_FACE_QUALITY.maxPitchRadians
    || Math.abs(pose.roll) > ENROLLMENT_FACE_QUALITY.maxRollRadians) return "turned";

  return null;
}
