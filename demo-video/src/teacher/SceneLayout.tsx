import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { GuideScene } from "../guide/GuideScene";
import { PhoneFrame } from "../components/PhoneFrame";
import { Cursor } from "../components/Cursor";
import { FONT } from "../fonts";
import { tween } from "../anim";
import { PALETTE as P, PHONE_POSITION } from "../student/style";
import { lineStart, sceneFrames } from "./timing";
import { NARRATION, type TeacherSceneId } from "./narration";

export const currentLine = (id: TeacherSceneId, frame: number) => {
  const count = NARRATION.find((scene) => scene.id === id)!.lines.length;
  let line = 0;
  while (line + 1 < count && frame >= lineStart(id, line + 1)) line += 1;
  return line;
};

export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const enter = tween(frame, [delay, delay + 18], [0, 1]);
  return (
    <div
      style={{
        opacity: enter,
        translate: `0 ${28 * (1 - enter)}px`,
        scale: 0.98 + 0.02 * enter,
        transformOrigin: "left center",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Stage: React.FC<{
  id: TeacherSceneId;
  chapter: string;
  children: React.ReactNode;
  dark?: boolean;
}> = ({ id, chapter, children, dark = false }) => {
  const frame = useCurrentFrame();
  const index = NARRATION.findIndex((scene) => scene.id === id);
  const exit = tween(
    frame,
    [sceneFrames(id) - 10, sceneFrames(id) - 1],
    [1, 0],
  );
  return (
    <GuideScene id={id}>
      <AbsoluteFill
        style={{
          background: dark ? P.navy : P.paper,
          fontFamily: FONT,
          color: dark ? P.white : P.ink,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 480,
            bottom: 0,
            background: dark ? P.navy : P.orangeSoft,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 124,
            top: 52,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Img
            src={staticFile("meal.png")}
            style={{ width: 42, height: 42, borderRadius: 12 }}
          />
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.8 }}>
            PosanMeal
          </span>
          <span
            style={{ width: 1, height: 20, background: P.line, marginLeft: 12 }}
          />
          <span style={{ fontSize: 22, color: dark ? P.line : P.muted }}>
            교사 · 담임교사 이용 안내
          </span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 124,
            top: 130,
            display: "flex",
            gap: 16,
            alignItems: "center",
            color: dark ? P.orangeSoft : P.orange,
          }}
        >
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span style={{ height: 1, width: 42, background: P.orange }} />
          <span style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>
            {chapter}
          </span>
        </div>
        <div style={{ opacity: exit }}>{children}</div>
        <div
          style={{
            position: "absolute",
            left: 124,
            bottom: 158,
            display: "flex",
            gap: 6,
          }}
        >
          {NARRATION.map((scene, position) => (
            <div
              key={scene.id}
              style={{
                width: position === index ? 46 : 14,
                height: 5,
                borderRadius: 3,
                background: position <= index ? P.orange : P.line,
              }}
            />
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 124,
            bottom: 128,
            fontSize: 17,
            color: dark ? P.line : P.muted,
          }}
        >
          meal.posan.kr · 화면과 계정 정보는 안내용 예시입니다
        </div>
      </AbsoluteFill>
    </GuideScene>
  );
};

export const Headline: React.FC<{
  children: React.ReactNode;
  subtitle?: string;
  width?: number;
  size?: number;
}> = ({ children, subtitle, width = 1070, size = 76 }) => (
  <Reveal
    delay={3}
    style={{ position: "absolute", left: 124, top: 194, width }}
  >
    <div
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: -3.2,
        lineHeight: 1.2,
        wordBreak: "keep-all",
      }}
    >
      {children}
    </div>
    {subtitle ? (
      <div
        style={{
          fontSize: 28,
          color: P.muted,
          marginTop: 26,
          lineHeight: 1.6,
          wordBreak: "keep-all",
        }}
      >
        {subtitle}
      </div>
    ) : null}
  </Reveal>
);

export const Phone: React.FC<{ children: React.ReactNode; url?: string }> = ({
  children,
  url = "meal.posan.kr/teacher",
}) => (
  <PhoneFrame {...PHONE_POSITION} url={url}>
    {children}
  </PhoneFrame>
);

export const ActionCue: React.FC<{ x: number; y: number; at: number }> = ({
  x,
  y,
  at,
}) => (
  <Cursor
    path={[
      { frame: at - 24, x: x + 44, y: y + 52 },
      { frame: at - 4, x, y },
    ]}
    clicks={[at]}
    hideAfter={at + 10}
  />
);

export const InfoCard: React.FC<{
  title: string;
  text?: string;
  active?: boolean;
  tone?: "orange" | "red" | "green";
  number?: string;
  style?: React.CSSProperties;
}> = ({ title, text, active = true, tone = "orange", number, style }) => {
  const color = P[tone];
  return (
    <div
      style={{
        background: active ? P.white : "transparent",
        border: `1.5px solid ${active ? color : P.line}`,
        borderRadius: 20,
        padding: "23px 28px",
        display: "flex",
        alignItems: "center",
        gap: 22,
        boxShadow: active ? `0 10px 26px ${P.shadow}` : undefined,
        opacity: active ? 1 : 0.6,
        ...style,
      }}
    >
      {number ? (
        <div
          style={{
            fontSize: 25,
            fontWeight: 800,
            color,
            width: 34,
            flexShrink: 0,
          }}
        >
          {number}
        </div>
      ) : null}
      <div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: P.ink,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {text ? (
          <div
            style={{
              fontSize: 23,
              color: P.muted,
              marginTop: 7,
              wordBreak: "keep-all",
              lineHeight: 1.5,
            }}
          >
            {text}
          </div>
        ) : null}
      </div>
    </div>
  );
};
