import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, Reveal, InfoCard } from "../SceneLayout";
import { LandingMock } from "../StudentMockups";
import { PALETTE as P } from "../style";
import { lineStart } from "../timing";
import { tween } from "../../anim";

export const Address: React.FC = () => {
  const frame = useCurrentFrame();
  const start = lineStart("Address", 1);
  const characters = Math.floor(tween(frame, [start, start + 34], [0, 13]));
  return <Stage id="Address" chapter="주소창에서 시작하기">
    <Headline subtitle="포산고등학교 학생을 위한 급식 체크인">급식 체크인,<br />이 주소만 기억하세요.</Headline>
    <Reveal delay={start} style={{ position: "absolute", left: 124, top: 466, width: 1040 }}>
      <div style={{ fontSize: 98, fontWeight: 800, color: P.orange, letterSpacing: -4, whiteSpace: "nowrap" }}>{"meal.posan.kr".slice(0, characters)}<span style={{ opacity: frame % 30 < 16 ? 1 : 0, fontWeight: 400 }}>|</span></div>
      <div style={{ height: 7, width: tween(frame, [start + 25, start + 55], [0, 696]), background: P.orange, marginTop: 18 }} />
      <InfoCard title="검색창 대신, 브라우저 주소창에 입력" style={{ marginTop: 45 }} />
    </Reveal>
    <Phone url="meal.posan.kr"><LandingMock /></Phone>
  </Stage>;
};
