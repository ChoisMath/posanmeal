import React from "react";
import { Stage, Headline, Phone, Reveal, InfoCard } from "../SceneLayout";
import { StudentAppMock, MockQr } from "../StudentMockups";
import { PALETTE as P } from "../style";

export const Print: React.FC = () => <Stage id="Print" chapter="휴대폰으로 보여주기 어렵다면">
  <Headline size={70}>담임 선생님께<br /><span style={{ color: P.orange }}>QR 인쇄</span>를 요청하세요.</Headline>
  <Reveal delay={20} style={{ position: "absolute", left: 124, top: 432, display: "flex", gap: 35, alignItems: "center" }}>
    <div style={{ width: 352, background: P.white, padding: "24px 28px", borderRadius: 20, border: `1px solid ${P.line}`, boxShadow: `0 18px 40px ${P.shadow}`, textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: P.orange, marginBottom: 12 }}>PosanMeal · 학생 QR 카드</div>
      <div style={{ display: "flex", justifyContent: "center" }}><MockQr size={175} /></div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 10 }}>1학년 2반 7번 이가온</div>
      <div style={{ fontSize: 16, color: P.muted, marginTop: 4 }}>안내용 예시 · 실제 사용 불가</div>
    </div>
    <div style={{ width: 600, display: "grid", gap: 22 }}>
      <InfoCard title="휴대폰이 없을 때도" text="또는 화면의 QR을 인식하기 어려울 때" />
      <InfoCard title="출력물도 본인만 보관" text="분실하면 바로 담임 선생님께 알려 주세요." tone="red" />
    </div>
  </Reveal>
  <Phone><StudentAppMock tab="qr" fixed /></Phone>
</Stage>;
