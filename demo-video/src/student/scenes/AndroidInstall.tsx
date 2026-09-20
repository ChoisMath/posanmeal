import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Reveal, InfoCard, ActionCue, currentLine } from "../SceneLayout";
import { AndroidInstallMock, INSTALL_POINTS as POINTS, type AndroidInstallState } from "../InstallMockups";
import { PALETTE as P } from "../style";
import { lineAt } from "../timing";

export const AndroidInstall: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("AndroidInstall", frame);
  const menuAt = lineAt("AndroidInstall", 1, 0.68);
  const submenuAt = lineAt("AndroidInstall", 2, 0.28);
  const installAt = lineAt("AndroidInstall", 2, 0.72);
  const confirmAt = lineAt("AndroidInstall", 4, 0.62);
  const homeAt = lineAt("AndroidInstall", 5, 0.04);
  const launchAt = lineAt("AndroidInstall", 5, 0.73);
  const state: AndroidInstallState = frame >= launchAt ? "app" : frame >= homeAt ? "home" : frame >= confirmAt ? "installing" : frame >= installAt ? "dialog" : frame >= submenuAt ? "installMenu" : frame >= menuAt ? "menu" : "page";
  const active = line < 2 ? 0 : line < 4 ? 1 : line === 4 ? 2 : 3;
  const rows = [
    ["Chrome에서 주소 오른쪽 ⋮ 누르기", "meal.posan.kr에 접속한 화면에서 시작해요."],
    ["설치 및 바로가기 만들기 → 설치", "메뉴 이름은 Chrome 버전에 따라 다를 수 있어요."],
    ["주소 확인 → 설치 → 완료 기다리기", "설치 창에 meal.posan.kr이 맞는지 확인하세요."],
    ["PosanMeal 아이콘으로 바로 접속", "홈 화면 또는 앱 목록에서 아이콘을 찾아보세요."],
  ];
  return <Stage id="AndroidInstall" chapter="안드로이드 · 앱으로 설치하기">
    <Headline size={70}>안드로이드라면,<br />Chrome에서 설치해요.</Headline>
    <Reveal delay={12} style={{ position: "absolute", left: 124, top: 410, display: "flex", gap: 12, alignItems: "center", fontSize: 22, fontWeight: 600, color: P.muted }}><span style={{ background: P.blueSoft, color: P.blue, borderRadius: 50, padding: "10px 20px" }}>Android · Chrome</span><span>홈 화면에서 더 빠르게 시작</span></Reveal>
    <div style={{ position: "absolute", left: 124, top: 475, width: 1030, display: "grid", gap: 12 }}>{rows.map(([title, text], index) => <InfoCard key={title} title={title} text={active === index ? text : undefined} active={active === index} number={String(index + 1).padStart(2, "0")} style={{ padding: "15px 23px", lineHeight: 1.2 }} />)}</div>
    {line === 3 && <Reveal delay={lineAt("AndroidInstall", 3, 0.04)} style={{ position: "absolute", left: 145, top: 850, color: P.blue, fontSize: 24, fontWeight: 700, whiteSpace: "nowrap" }}>‘앱 설치’ 또는 ‘홈 화면에 추가’로 보일 수도 있어요.</Reveal>}
    <AndroidInstallMock state={state} />
    <ActionCue {...POINTS.androidMenu} at={menuAt} />
    <ActionCue {...POINTS.androidInstallMenu} at={submenuAt} />
    <ActionCue {...POINTS.androidInstall} at={installAt} />
    <ActionCue {...POINTS.androidConfirm} at={confirmAt} />
    <ActionCue {...POINTS.androidApp} at={launchAt} />
  </Stage>;
};
