import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const Qr: React.FC = () => {
  const line = currentLine("Qr", useCurrentFrame());
  return <Stage id="Qr" chapter="QR · 본인만 사용하기">
    <Headline subtitle="오늘 신청된 식사가 있어야 코드가 표시됩니다.">내 QR은<br /><span style={{ color: P.orange }}>내 식사 확인증.</span></Headline>
    <div style={{ position: "absolute", left: 124, top: 485, width: 1010, display: "grid", gap: 18 }}>
      <InfoCard title={line >= 2 ? "로컬 모드에서는 고정 QR 사용" : "온라인 QR은 일정 시간마다 자동 갱신"} text={line >= 2 ? "인터넷이 어려운 환경에서 학교가 설정하는 운영 방식" : "학생이 직접 QR을 고정하는 버튼은 없습니다."} />
      <InfoCard title="캡처·공유·대리 사용 금지" text="고정 QR과 인쇄 카드도 본인만 안전하게 보관하세요." tone="red" active={line >= 3} />
      <div style={{ fontSize: 23, color: P.muted, lineHeight: 1.5 }}>식사 시간 밖에는 ‘현재 식사 시간이 아닙니다.’가<br />표시될 수 있어요.</div>
    </div>
    <Phone><StudentAppMock tab="qr" fixed={line >= 2} /></Phone>
  </Stage>;
};
