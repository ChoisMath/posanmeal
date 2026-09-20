import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const History: React.FC = () => {
  const line = currentLine("History", useCurrentFrame());
  return <Stage id="History" chapter="확인 · 내 식사 기록 살펴보기">
    <Headline subtitle="날짜별 체크인 시각을 월별 달력에서 확인합니다.">내가 먹은 날과<br /><span style={{ color: P.orange }}>기록이 같은가요?</span></Headline>
    <div style={{ position: "absolute", left: 124, top: 490, width: 1020, display: "grid", gap: 20 }}>
      <InfoCard title="먹었는데 기록이 없다면?" text="누락된 날짜와 식사를 확인하세요." active={line === 1} />
      <InfoCard title="먹지 않았는데 기록이 있다면?" text="타인 사용이 의심되면 그냥 넘기지 마세요." tone="red" active={line >= 1} />
      <InfoCard title="날짜·식사를 담임 선생님께 알리기" tone="green" active={line === 2} />
    </div>
    <Phone><StudentAppMock tab="history" highlightDay={line >= 1 ? 18 : undefined} /></Phone>
  </Stage>;
};
