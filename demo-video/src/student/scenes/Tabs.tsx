import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, InfoCard, currentLine } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";
import { lineAt, lineStart } from "../timing";
import { PALETTE as P } from "../style";

export const Tabs: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("Tabs", frame);
  const tabs = ["meal", "qr", "profile", "history"] as const;
  const active = Math.min(3, Math.max(0, Math.floor((frame - lineStart("Tabs", 0)) / Math.max(1, (lineAt("Tabs", 0, 0.9) - lineStart("Tabs", 0)) / 4))));
  return <Stage id="Tabs" chapter="학생 화면 살펴보기">
    <Headline subtitle="로그인하면 식단 화면이 먼저 열립니다.">네 가지 탭으로<br />간편하게 이용해요.</Headline>
    <div style={{ position: "absolute", left: 124, top: 485, width: 1030, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {[["식단", "오늘의 메뉴"], ["QR", "급식 체크인"], ["개인정보", "내 정보 · 얼굴 등록"], ["확인", "월별 체크인 기록"]].map(([title, text], index) => <InfoCard key={title} title={title} text={text} active={active === index} />)}
      {line > 0 ? <div style={{ gridColumn: "1 / -1", color: P.orange, fontSize: 27, fontWeight: 700, marginTop: 8 }}>신청 공고가 열리면 ‘신청’ 탭이 추가됩니다.</div> : null}
    </div>
    <Phone><StudentAppMock tab={line > 0 ? "apply" : tabs[active]} hasApplication={line > 0} /></Phone>
  </Stage>;
};
