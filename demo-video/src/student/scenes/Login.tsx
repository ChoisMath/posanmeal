import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, Reveal, InfoCard, currentLine } from "../SceneLayout";
import { AccountPickerMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const Login: React.FC = () => {
  const line = currentLine("Login", useCurrentFrame());
  return <Stage id="Login" chapter="등록된 Google 계정으로 로그인">
    <Headline subtitle="학교 명부에 등록된 이메일과 같아야 합니다.">학교에 등록된<br /><span style={{ color: P.orange }}>본인 계정</span>을 선택하세요.</Headline>
    <Reveal delay={16} style={{ position: "absolute", left: 124, top: 490, width: 990, display: "grid", gap: 22 }}>
      <InfoCard title="Google로 로그인 → 등록된 계정 선택" text="사용 중인 계정의 이메일을 한 번 더 확인해 주세요." number="01" />
      <InfoCard title="등록되지 않은 계정은 이용할 수 없어요" text="계정이 기억나지 않으면 담임 선생님께 확인하세요." active={line >= 1} tone="red" number="02" />
    </Reveal>
    <Phone url="accounts.google.com"><AccountPickerMock /></Phone>
  </Stage>;
};
