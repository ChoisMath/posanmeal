import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { tween } from "../../anim";
import { Stage, Phone, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { lineStart } from "../timing";
import { PALETTE as P } from "../style";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("Intro", frame);
  const underline = tween(frame, [5, 35], [0, 1]);
  return <Stage id="Intro" chapter="함께 시작해요">
    <div style={{ position: "absolute", left: 124, top: 222, width: 1110 }}>
      <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 0.5, color: P.muted }}>포산고등학교 학생을 위한 급식 이용 가이드</div>
      <div style={{ fontSize: 126, fontWeight: 800, letterSpacing: -6, lineHeight: 1.16, marginTop: 26, whiteSpace: "nowrap" }}>
        <div style={{ color: P.orange }}>포산밀</div>
        <div>학생 사용안내</div>
      </div>
      <div style={{ height: 6, width: 777 * underline, background: P.orange, borderRadius: 4, marginTop: 25 }} />
      <div style={{ fontSize: 31, color: P.muted, fontWeight: 500, marginTop: 28, whiteSpace: "nowrap" }}>급식 신청부터 체크인, 식사 기록 확인까지</div>
      <div style={{ display: "flex", gap: 18, marginTop: 38 }}>
        {["급식 신청", "QR · 얼굴 체크인", "이용 기록 확인"].map((label, index) => {
          const emphasis = tween(frame, [lineStart("Intro", 1) + index * 6, lineStart("Intro", 1) + index * 6 + 18], [0, 1]);
          return <div key={label} style={{ padding: "20px 25px", borderRadius: 18, background: P.white, border: `1.5px solid ${line === 1 ? P.orange : P.line}`, boxShadow: `0 ${7 * emphasis}px ${20 * emphasis}px ${P.shadow}`, translate: `0 ${-4 * emphasis}px`, fontSize: 27, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>;
        })}
      </div>
      <div style={{ marginTop: 42, fontSize: 39, fontWeight: 800, letterSpacing: -1.2 }}>meal.posan.kr</div>
    </div>
    <Sequence from={-12} layout="none"><Phone><StudentAppMock tab="meal" /></Phone></Sequence>
  </Stage>;
};
