import { Easing, interpolate } from "remotion";

export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
export const backOut = Easing.out(Easing.back(1.4));

export const tween = (
  frame: number,
  range: [number, number],
  output: [number, number],
  easing: (t: number) => number = easeOut,
) =>
  interpolate(frame, range, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

export const fadeInOut = (frame: number, duration: number, edge = 8) => {
  const safeEdge = Math.min(edge, Math.floor(duration / 2) - 1);
  return interpolate(
    frame,
    [0, safeEdge, duration - safeEdge, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
};

export const pulse = (frame: number, period = 30) =>
  0.5 + 0.5 * Math.sin((frame / period) * Math.PI * 2);

export const isBetween = (frame: number, from: number, to: number) =>
  frame >= from && frame < to;
