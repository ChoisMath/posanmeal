import React from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../fonts";
import { colors } from "../theme";
import { fadeInOut, pulse } from "../anim";

const AnnotationBody: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color: string;
  labelPosition: "top" | "bottom" | "left" | "right";
  labelGap: number;
  labelAlign: "start" | "end";
}> = ({ x, y, width, height, label, color, labelPosition, labelGap, labelAlign }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = fadeInOut(frame, durationInFrames, 8);
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, opacity, pointerEvents: "none", fontFamily: FONT }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 12,
          border: `4px solid ${color}`,
          boxShadow: `0 0 0 ${4 + pulse(frame, 28) * 8}px ${color}33`,
        }}
      />
      {label ? (
        <div
          style={{
            position: "absolute",
            ...(labelAlign === "end" ? { right: 0 } : { left: 0 }),
            ...(labelPosition === "top"
              ? { bottom: height + labelGap }
              : labelPosition === "bottom"
                ? { top: height + labelGap }
                : labelPosition === "left"
                  ? { left: "auto", right: width + labelGap, top: "50%", translate: "0px -50%" }
                  : { left: width + labelGap, top: "50%", translate: "0px -50%" }),
            background: color,
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            padding: "8px 16px",
            borderRadius: 10,
            whiteSpace: "nowrap",
            boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

export const Annotation: React.FC<{
  from: number;
  durationInFrames: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  labelPosition?: "top" | "bottom" | "left" | "right";
  // 상자와 라벨 사이 거리. 기본값은 위·아래 12, 좌우 14.
  labelGap?: number;
  // top/bottom 라벨을 상자 왼쪽 끝(start) 또는 오른쪽 끝(end)에 맞춘다.
  labelAlign?: "start" | "end";
}> = ({ from, durationInFrames, color = colors.red600, labelPosition = "top", labelGap, labelAlign = "start", ...rest }) => (
  <Sequence from={from} durationInFrames={durationInFrames} layout="none" name="Annotation">
    <AnnotationBody
      {...rest}
      color={color}
      labelPosition={labelPosition}
      labelGap={labelGap ?? (labelPosition === "top" || labelPosition === "bottom" ? 12 : 14)}
      labelAlign={labelAlign}
    />
  </Sequence>
);
