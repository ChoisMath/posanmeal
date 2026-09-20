import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { AccountPickerMock, StudentAppMock } from "../StudentMockups";

export const Recovery: React.FC = () => {
  const line = currentLine("Recovery", useCurrentFrame());
  const rows = [
    ["오른쪽 위 로그아웃 → 다시 로그인", "학생 화면에 들어온 경우 로그아웃 아이콘을 누르세요."],
    ["등록된 계정 / 다른 계정 사용 선택", "앱 로그아웃과 Google 계정 로그아웃은 별개예요."],
    ["계속 같다면, 새 시크릿 창에서 접속", "meal.posan.kr을 다시 입력하고 등록된 계정으로 로그인"],
    ["그래도 어렵다면, 담임 선생님께 확인", "학교에 등록된 본인 이메일을 확인하세요."],
  ];
  return <Stage id="Recovery" chapter="다른 계정으로 접속했다면">
    <Headline size={69}>로그인이 잘못됐을 때,<br />이 순서로 해결해요.</Headline>
    <div style={{ position: "absolute", left: 124, top: 415, width: 1030, display: "grid", gap: 12 }}>
      {rows.map(([title, text], index) => <InfoCard key={title} title={title} text={line === index ? text : undefined} number={String(index + 1).padStart(2, "0")} active={line === index} style={{ padding: "16px 23px" }} />)}
    </div>
    <Phone url={line === 0 ? "meal.posan.kr/student" : line === 2 ? "meal.posan.kr · 시크릿 창" : "accounts.google.com"}>
      {line === 0 ? <StudentAppMock tab="meal" /> : <AccountPickerMock />}
    </Phone>
  </Stage>;
};
