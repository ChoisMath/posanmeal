import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const Enroll: React.FC = () => {
  const line = currentLine("Enroll", useCurrentFrame());
  const states = ["idle", "consent", "camera", "registered"] as const;
  const rows = ["개인정보 → 얼굴 등록하기", "수집·이용 안내를 읽고 선택 동의", "카메라 허용 → 혼자 정면으로 촬영", "동의하지 않아도 QR 이용 가능"];
  return <Stage id="Enroll" chapter="개인정보 · 얼굴 등록은 선택">
    <Headline size={70}>얼굴로 체크인하려면,<br /><span style={{ color: P.orange }}>동의 후 등록하세요.</span></Headline>
    <div style={{ position: "absolute", left: 124, top: 438, width: 1020, display: "grid", gap: 16 }}>
      {rows.map((title, index) => <InfoCard key={title} title={title} number={String(index + 1).padStart(2, "0")} active={line === index} text={index === 3 && line === 3 ? "등록한 얼굴 정보는 개인정보 탭에서 삭제할 수 있어요." : undefined} />)}
    </div>
    <Phone><StudentAppMock tab="profile" faceState={states[line]} /></Phone>
  </Stage>;
};
