import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, InfoCard, currentLine, ActionCue } from "../SceneLayout";
import { KioskMock } from "../StudentMockups";
import { lineAt } from "../timing";
import { PALETTE as P } from "../style";

export const Kiosk: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("Kiosk", frame);
  const switchAt = lineAt("Kiosk", 1, 0.7);
  const confirmAt = lineAt("Kiosk", 3, 0.75);
  const cancelAt = lineAt("Kiosk", 4, 0.55);
  const mode = frame < switchAt ? "qr" : line === 1 ? "face" : line === 3 && frame > confirmAt ? "success" : line === 4 && frame > cancelAt ? "qr" : "confirm";
  return <Stage id="Kiosk" chapter="급식실 기기 · 얼굴로 체크인">
    <Headline size={66} width={1550}>얼굴로 전환하고, <span style={{ color: P.orange }}>본인 확인은 꼭.</span></Headline>
    <div style={{ position: "absolute", left: 124, top: 351, width: 485, display: "grid", gap: 24 }}>
      <InfoCard title={line <= 1 ? "오른쪽 아래" : line === 3 ? "본인이 맞을 때만" : "베타 기능"} text={line <= 1 ? "‘얼굴로 체크인’을 누르세요." : line === 3 ? "학번·이름 확인 후 ‘확인’" : "다른 사람으로 인식하거나 인식에 실패할 수 있어요."} tone={line === 2 ? "red" : "orange"} />
      <InfoCard title={line === 4 ? "다르면 ‘취소’" : "QR로도 이용 가능"} text={line === 4 ? "다시 시도하거나 QR로 체크인하세요." : "학생 휴대폰이 아닌, 급식실 기기의 화면입니다."} active={line === 4} />
      <div style={{ fontSize: 22, color: P.muted, lineHeight: 1.6 }}>아무것도 선택하지 않으면<br />10초 후 취소됩니다.</div>
    </div>
    <div style={{ position: "absolute", left: 675, top: 303, borderRadius: 24, overflow: "hidden", boxShadow: `0 22px 55px ${P.shadow}`, border: `8px solid ${P.ink}` }}><KioskMock mode={mode} mismatch={line === 2 || line === 4} /></div>
    <ActionCue x={1700} y={887} at={switchAt - 4} />
    <ActionCue x={1112} y={746} at={confirmAt - 4} />
    <ActionCue x={1354} y={746} at={cancelAt - 4} />
  </Stage>;
};
