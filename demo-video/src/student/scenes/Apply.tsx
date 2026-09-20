import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine, ActionCue } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { lineAt } from "../timing";

export const Apply: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("Apply", frame);
  return <Stage id="Apply" chapter="신청 · 공고와 식사 선택">
    <Headline size={71} subtitle="신청 기간과 내 이름·학번부터 확인합니다.">공고를 열고,<br />먹을 식사를 선택해요.</Headline>
    <div style={{ position: "absolute", left: 124, top: 484, width: 1010, display: "grid", gap: 17 }}>
      <InfoCard title="신청 탭 → 공고의 ‘신청하기’" number="01" active={line === 0} />
      <InfoCard title="신청함 또는 요일·날짜 선택" text="선택 방식은 공고마다 다를 수 있어요." number="02" active={line === 1} />
      <InfoCard title="면제 항목은 실제 대상인 경우만" text="공고 설정에 따라 해당 항목이 보일 수 있어요." number="03" active={line === 2} />
    </div>
    <Phone><StudentAppMock tab="apply" hasApplication applicationStage={frame < lineAt("Apply", 0, 0.5) ? "list" : "select"} /></Phone>
    <ActionCue x={1650} y={470} at={lineAt("Apply", 0, 0.5) - 4} />
  </Stage>;
};
