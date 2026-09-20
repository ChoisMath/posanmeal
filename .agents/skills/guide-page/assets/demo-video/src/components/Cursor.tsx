import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { tween } from "../anim";

export type Waypoint = { frame: number; x: number; y: number };

const positionAt = (path: Waypoint[], frame: number) => {
  if (path.length === 1) {
    return { x: path[0].x, y: path[0].y };
  }
  const frames = path.map((p) => p.frame);
  const options = {
    extrapolateLeft: "clamp" as const,
    extrapolateRight: "clamp" as const,
    easing: Easing.inOut(Easing.cubic),
  };
  return {
    x: interpolate(frame, frames, path.map((p) => p.x), options),
    y: interpolate(frame, frames, path.map((p) => p.y), options),
  };
};

export const Cursor: React.FC<{
  path: Waypoint[];
  clicks?: number[];
  hideAfter?: number;
}> = ({ path, clicks = [], hideAfter }) => {
  const frame = useCurrentFrame();
  if (path.length === 0) {
    return null;
  }
  const { x, y } = positionAt(path, frame);
  const firstFrame = path[0].frame;
  const visible =
    tween(frame, [firstFrame - 10, firstFrame], [0, 1]) *
    (hideAfter === undefined ? 1 : tween(frame, [hideAfter, hideAfter + 8], [1, 0]));
  const pressing = clicks.some((c) => frame >= c && frame < c + 5);

  return (
    <>
      {clicks.map((c) => {
        if (frame < c || frame > c + 16) {
          return null;
        }
        const origin = positionAt(path, c);
        return (
          <div
            key={c}
            style={{
              position: "absolute",
              left: origin.x - 30,
              top: origin.y - 30,
              width: 60,
              height: 60,
              borderRadius: 30,
              border: "3px solid #2563EB",
              background: "rgba(37,99,235,0.18)",
              scale: String(tween(frame, [c, c + 16], [0.2, 1])),
              opacity: tween(frame, [c, c + 16], [0.9, 0]),
              pointerEvents: "none",
            }}
          />
        );
      })}
      <svg
        width={34}
        height={34}
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          left: x - 3,
          top: y - 2,
          opacity: visible,
          scale: pressing ? "0.85" : "1",
          filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))",
          pointerEvents: "none",
        }}
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86h6.92c.44 0 .66-.53.36-.85L6.37 2.86c-.32-.31-.87-.09-.87.35z"
          fill="#111827"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};
