import React from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../fonts";
import { fadeInOut, tween } from "../anim";

// 한국어 자막이 단어 중간에서 줄바꿈되지 않도록 keep-all 을 쓴다.
const Body: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const long = text.length > 44;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 52,
        display: "flex",
        justifyContent: "center",
        fontFamily: FONT,
        opacity: fadeInOut(frame, durationInFrames, 8),
        translate: `0px ${tween(frame, [0, 10], [14, 0])}px`,
      }}
    >
      <div
        style={{
          maxWidth: 1560,
          background: "rgba(17,24,39,0.93)",
          color: "#fff",
          fontSize: long ? 31 : 34,
          fontWeight: 600,
          lineHeight: 1.4,
          padding: "16px 34px",
          borderRadius: 18,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          textAlign: "center",
          wordBreak: "keep-all",
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const GuideCaption: React.FC<{ from: number; durationInFrames: number; text: string }> = ({ from, durationInFrames, text }) => (
  <Sequence from={from} durationInFrames={durationInFrames} layout="none" name="Caption">
    <Body text={text} />
  </Sequence>
);
