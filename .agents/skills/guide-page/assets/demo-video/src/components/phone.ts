import { PHONE } from "./PhoneFrame";

export const PHONE_X = 753;
export const PHONE_Y = 36;
const BEZEL = 12;

// 가이드 스틸의 폰 크롭 — 폰 장면은 모두 이 위치에 폰을 둔다
export const PHONE_CROP = { x: PHONE_X, y: PHONE_Y, w: PHONE.w + BEZEL * 2, h: PHONE.h + BEZEL * 2 };

export const phoneAbs = (p: { x: number; y: number }) => ({
  x: PHONE_X + BEZEL + p.x,
  y: PHONE_Y + BEZEL + PHONE.statusH + PHONE.urlH + p.y,
});

export const phoneRectAbs = (r: { x: number; y: number; w: number; h: number }) => ({
  ...phoneAbs(r),
  width: r.w,
  height: r.h,
});

// 가이드 스틸은 폰(x PHONE_X~)만 잘라 쓰므로, 폰 안 요소의 왼쪽 라벨은 폰 바깥에서 끝나야 한다.
const LEFT_LABEL_EDGE = PHONE_X - 4;
export const phoneLeftLabelGap = (boxX: number) => boxX - LEFT_LABEL_EDGE;
