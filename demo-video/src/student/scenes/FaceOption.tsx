import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Phone, Reveal, InfoCard, currentLine } from "../SceneLayout";
import { Avatar, MockQr, StudentAppMock } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const FaceOption: React.FC = () => {
  const line = currentLine("FaceOption", useCurrentFrame());
  const optionCard: React.CSSProperties = { width: 202, height: 222, boxSizing: "border-box", border: `1.5px solid ${P.line}`, borderRadius: 22, background: P.white, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 17 };
  return <Stage id="FaceOption" chapter="또 하나의 체크인 방법">
    <Headline size={68}>가지고 다니기 어렵다면,<br /><span style={{ color: P.orange }}>얼굴 체크인</span>도 있어요.</Headline>
    <Reveal delay={12} style={{ position: "absolute", left: 124, top: 392, display: "flex", alignItems: "center", gap: 17 }}>
      <span style={{ background: P.orange, color: P.white, padding: "8px 16px", borderRadius: 10, fontSize: 23, fontWeight: 800, letterSpacing: 1.5, whiteSpace: "nowrap" }}>BETA</span>
      <span style={{ color: P.muted, fontSize: 26, fontWeight: 500, whiteSpace: "nowrap" }}>원하는 학생이 선택해서 이용해요.</span>
    </Reveal>
    <div style={{ position: "absolute", left: 124, top: 477, display: "flex", alignItems: "center", gap: 19 }}>
      <Reveal delay={18}>
        <div style={{ ...optionCard, opacity: line > 0 ? 0.65 : 1 }}>
          <div style={{ width: 66, height: 105, background: P.ink, padding: 6, borderRadius: 13, boxSizing: "border-box" }}>
            <div style={{ width: "100%", height: "100%", background: P.paper, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><MockQr size={43} /></div>
          </div>
          <span style={{ fontSize: 25, fontWeight: 700, whiteSpace: "nowrap" }}>휴대전화</span>
        </div>
      </Reveal>
      <Reveal delay={24}>
        <div style={{ ...optionCard, opacity: line > 0 ? 0.65 : 1 }}>
          <div style={{ padding: 9, background: P.paper, border: `1px solid ${P.line}`, borderRadius: 8 }}><MockQr size={87} /></div>
          <span style={{ fontSize: 25, fontWeight: 700, whiteSpace: "nowrap" }}>인쇄한 QR</span>
        </div>
      </Reveal>
      <Reveal delay={30} style={{ margin: "0 13px" }}>
        <svg width="62" height="38" viewBox="0 0 62 38" fill="none"><path d="M3 19h53M43 4l15 15-15 15" stroke={P.orange} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Reveal>
      <Reveal delay={36}>
        <div style={{ ...optionCard, width: 354, height: 252, border: `2px solid ${P.orange}`, background: P.orangeSoft, boxShadow: `0 15px 35px ${P.shadow}` }}>
          <Avatar size={125} />
          <span style={{ fontSize: 30, fontWeight: 800, whiteSpace: "nowrap" }}>얼굴 인식으로 체크인</span>
        </div>
      </Reveal>
    </div>
    <Reveal delay={42} style={{ position: "absolute", left: 124, top: 768, width: 1020 }}>
      <InfoCard title={line > 0 ? "개인정보 → 얼굴 등록하기" : "얼굴 등록과 개인정보 이용 동의가 필요해요."} text={line > 0 ? "지금부터 얼굴을 등록하는 방법을 알아볼게요." : "정확도에 제한이 있는 베타 기능입니다."} />
    </Reveal>
    <Phone><StudentAppMock tab="profile" faceState="idle" /></Phone>
  </Stage>;
};
