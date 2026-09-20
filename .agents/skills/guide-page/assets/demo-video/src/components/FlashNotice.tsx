import React from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../fonts";
import { colors } from "../theme";
import { fadeInOut, tween } from "../anim";

const FlashBody: React.FC<{ text: string; hint: string }> = ({ text, hint }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: fadeInOut(frame, durationInFrames, 8),
        translate: `0px ${tween(frame, [0, 10], [-12, 0])}px`,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderLeft: `4px solid ${colors.green600}`,
          color: "#15803D",
          padding: "12px 22px",
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontSize: 18,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 10,
          whiteSpace: "nowrap",
        }}
      >
        <span>{text}</span>
        <span style={{ color: colors.gray500, fontWeight: 500 }}>({hint})</span>
      </div>
    </div>
  );
};

export const FlashNotice: React.FC<{ from: number; durationInFrames: number; text: string; hint: string }> = ({
  from,
  durationInFrames,
  text,
  hint,
}) => (
  <Sequence from={from} durationInFrames={durationInFrames} layout="none" name="FlashNotice">
    <FlashBody text={text} hint={hint} />
  </Sequence>
);
