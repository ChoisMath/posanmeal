import React from "react";
import { useCurrentFrame } from "remotion";
import type { SceneDef } from "../scenes";
import { GuideScene } from "../guide/GuideScene";
import { BrowserFrame } from "../components/BrowserFrame";
import { Cursor } from "../components/Cursor";
import { Annotation } from "../components/Annotation";
import { BROWSER, colors } from "../theme";
import { backOut, tween } from "../anim";
import type { DemoProps } from "../props";
import { lineAt, lineEnd, sceneFrames } from "./timing";

const IntroScene: React.FC<DemoProps> = ({ appName }) => {
  const frame = useCurrentFrame();
  return (
    <GuideScene id="Intro">
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          opacity: tween(frame, [0, 14], [0, 1]),
          translate: `0px ${tween(frame, [0, 18], [24, 0], backOut)}px`,
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 600, color: colors.blue700, whiteSpace: "nowrap" }}>{appName}</div>
        <div style={{ fontSize: 76, fontWeight: 800, color: colors.gray900, whiteSpace: "nowrap" }}>안내 영상 환경 점검</div>
      </div>
    </GuideScene>
  );
};

const CHECK_BUTTON = { x: 550, y: 260, w: 460, h: 120 };

const CheckScene: React.FC<DemoProps> = ({ appUrl }) => {
  const frame = useCurrentFrame();
  const clickAt = lineAt("Check", 0, 0.6);
  const checked = frame >= clickAt;
  // 커서·주석 좌표는 1920×1080 화면 기준이라 브라우저 본문 좌표에 프레임 위치를 더한다.
  const screenX = BROWSER.x + CHECK_BUTTON.x + CHECK_BUTTON.w / 2;
  const screenY = BROWSER.y + BROWSER.chrome + CHECK_BUTTON.y + CHECK_BUTTON.h / 2;
  return (
    <GuideScene id="Check" step={1} label="환경 점검 예시">
      <BrowserFrame url={appUrl} tabTitle="PosanMeal · 영상 환경 점검">
        <div style={{ position: "absolute", left: 250, top: 90, fontSize: 30, fontWeight: 700, color: colors.gray800, whiteSpace: "nowrap" }}>
          영상 환경 점검용 목업
        </div>
        <div
          style={{
            position: "absolute",
            left: CHECK_BUTTON.x,
            top: CHECK_BUTTON.y,
            width: CHECK_BUTTON.w,
            height: CHECK_BUTTON.h,
            borderRadius: 14,
            border: `2px solid ${checked ? colors.green600 : colors.blue600}`,
            background: checked ? colors.green50 : colors.blue50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 600,
            color: checked ? colors.green600 : colors.blue700,
            whiteSpace: "nowrap",
          }}
        >
          {checked ? "목업 상태 변경됨" : "점검 버튼"}
        </div>
      </BrowserFrame>
      <Cursor
        path={[
          { frame: lineAt("Check", 0, 0.1), x: 1500, y: 800 },
          { frame: clickAt - 4, x: screenX, y: screenY },
        ]}
        clicks={[clickAt]}
      />
      <Annotation
        from={clickAt + 6}
        durationInFrames={lineEnd("Check", 1) - clickAt}
        x={BROWSER.x + CHECK_BUTTON.x - 10}
        y={BROWSER.y + BROWSER.chrome + CHECK_BUTTON.y - 10}
        width={CHECK_BUTTON.w + 20}
        height={CHECK_BUTTON.h + 20}
        label="커서·음성·자막 확인"
        color={colors.green600}
      />
    </GuideScene>
  );
};

export const SETUP_CHECK_SCENES: SceneDef[] = [
  { id: "Intro", component: IntroScene, durationInFrames: sceneFrames("Intro") },
  { id: "Check", component: CheckScene, durationInFrames: sceneFrames("Check") },
];
