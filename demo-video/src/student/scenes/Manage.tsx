import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const Manage: React.FC = () => {
  const line = currentLine("Manage", useCurrentFrame());
  return <Stage id="Manage" chapter="신청 · 수정과 취소">
    <Headline>계획이 바뀌었다면,<br /><span style={{ color: P.orange }}>신청 기간 안에.</span></Headline>
    <div style={{ position: "absolute", left: 124, top: 439, width: 1010, display: "grid", gap: 22 }}>
      <InfoCard title="신청한 공고에서 ‘수정/취소’" text="변경한 내용을 확인하고 다시 서명해 신청 수정" active={line < 2} />
      <InfoCard title="취소하려면 ‘신청 취소’" text="취소할 신청이 맞는지 확인하세요." active={line === 1} />
      <InfoCard title="마감 전, 식사와 날짜를 한 번 더 확인" text="신청 기간이 끝나면 수정·취소가 제한됩니다." tone="red" active={line === 2} />
    </div>
    <Phone><StudentAppMock tab="apply" hasApplication applicationStage={line === 0 ? "complete" : "edit"} /></Phone>
  </Stage>;
};
