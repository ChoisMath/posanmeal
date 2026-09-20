import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, ActionCue } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { lineAt } from "../timing";
import { PALETTE as P } from "../style";

export const Sign: React.FC = () => {
  const complete = useCurrentFrame() > lineAt("Sign", 1, 0.45);
  return <Stage id="Sign" chapter="신청 · 서명하고 제출하기">
    <Headline subtitle="식사·날짜·급식비를 다시 확인하세요.">직접 서명하고,<br /><span style={{ color: P.orange }}>신청완료</span>까지 확인!</Headline>
    <div style={{ position: "absolute", left: 124, top: 490, width: 1000, display: "grid", gap: 20 }}>
      <InfoCard title="총 급식비 확인 → 서명란에 직접 서명" number="01" active={!complete} />
      <InfoCard title="‘신청하기’를 눌러 제출" number="02" active={!complete} />
      <InfoCard title="‘신청완료’ 표시와 ‘신청내역’ 확인" number="03" active={complete} tone="green" />
    </div>
    <Phone><StudentAppMock tab="apply" hasApplication applicationStage={complete ? "complete" : "signature"} /></Phone>
    <ActionCue x={1672} y={842} at={lineAt("Sign", 1, 0.45) - 4} />
  </Stage>;
};
