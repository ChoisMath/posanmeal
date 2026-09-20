import React from "react";
import { useCurrentFrame } from "remotion";
import { Stage, Headline, Reveal, InfoCard, ActionCue, currentLine } from "../SceneLayout";
import { IphoneInstallMock, INSTALL_POINTS as POINTS, InstallIcon, type IphoneInstallState } from "../InstallMockups";
import { Cursor } from "../../components/Cursor";
import { tween } from "../../anim";
import { PALETTE as P } from "../style";
import { lineAt, lineStart } from "../timing";

export const IphoneInstall: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("IphoneInstall", frame);
  const shareAt = lineAt("IphoneInstall", 1, 0.35);
  const scrollFrom = lineAt("IphoneInstall", 2, 0.05);
  const scrollTo = lineAt("IphoneInstall", 2, 0.33);
  const editAt = lineAt("IphoneInstall", 3, 0.32);
  const enableAt = lineAt("IphoneInstall", 3, 0.65);
  const returnAt = lineAt("IphoneInstall", 3, 0.86);
  const addSheetAt = lineAt("IphoneInstall", 4, 0.05);
  const toggleAt = lineAt("IphoneInstall", 4, 0.55);
  const addAt = lineAt("IphoneInstall", 5, 0.37);
  const launchAt = lineAt("IphoneInstall", 6, 0.32);
  const state: IphoneInstallState = frame >= launchAt ? "app" : frame >= addAt ? "home" : frame >= addSheetAt ? "add" : frame >= returnAt ? "share" : frame >= editAt ? "editActions" : frame >= shareAt ? "share" : "page";
  const active = line === 0 ? 0 : line === 1 ? 1 : line < 4 ? 2 : 3;
  const rows = [
    ["Safari에서 meal.posan.kr 접속", "아이폰 기본 브라우저 Safari를 열어 주세요."],
    ["공유 버튼 누르기", "버튼이 보이지 않으면 ‘더 보기 → 공유’를 선택해요."],
    ["공유 메뉴를 올려 ‘홈 화면에 추가’", line === 3 ? "항목이 없다면 ‘동작 편집’에서 추가할 수 있어요." : "공유 메뉴를 위로 올려 아래쪽 항목을 확인하세요."],
    ["이름·주소 확인 → 추가 → 아이콘 실행", line === 4 ? "‘웹 앱으로 열기’가 보이면 켜 둡니다." : line === 5 ? "오른쪽 위 ‘추가’를 누르면 홈 화면에 생겨요." : "아이콘으로 열고 학교에 등록된 계정으로 로그인해요."],
  ];
  return <Stage id="IphoneInstall" chapter="아이폰 · 홈 화면에 추가하기">
    <Headline size={70}>아이폰이라면,<br />Safari에서 추가해요.</Headline>
    <Reveal delay={12} style={{ position: "absolute", left: 124, top: 410, display: "flex", gap: 16, alignItems: "center", color: P.blue, fontSize: 23, fontWeight: 600 }}><span style={{ background: P.blueSoft, borderRadius: 50, padding: "10px 20px" }}>iPhone · Safari</span><InstallIcon name="share" size={30} /><span>공유 → 홈 화면에 추가</span></Reveal>
    <div style={{ position: "absolute", left: 124, top: 475, width: 1030, display: "grid", gap: 12 }}>{rows.map(([title, text], index) => <InfoCard key={title} title={title} text={active === index ? text : undefined} active={active === index} number={String(index + 1).padStart(2, "0")} style={{ padding: "15px 23px", lineHeight: 1.2 }} />)}</div>
    {line === 3 && <Reveal delay={lineStart("IphoneInstall", 3)} style={{ position: "absolute", left: 145, top: 850, color: P.blue, fontSize: 24, fontWeight: 700 }}>항목이 보이지 않을 때만 확인하세요.</Reveal>}
    <IphoneInstallMock state={state} scrollProgress={tween(frame, [scrollFrom, scrollTo], [0, 1])} webApp={frame >= toggleAt} enabled={frame >= enableAt} />
    <ActionCue {...POINTS.iphoneShare} at={shareAt} />
    <Cursor path={[{ frame: scrollFrom, x: 1697, y: 817 }, { frame: scrollTo, x: 1697, y: 633 }]} hideAfter={scrollTo + 8} />
    <ActionCue {...POINTS.iphoneEdit} at={editAt} />
    <ActionCue {...POINTS.iphoneEnableOption} at={enableAt} />
    <ActionCue {...POINTS.iphoneEditDone} at={returnAt} />
    <ActionCue {...POINTS.iphoneHomeOption} at={addSheetAt} />
    <ActionCue {...POINTS.iphoneToggle} at={toggleAt} />
    <ActionCue {...POINTS.iphoneAdd} at={addAt} />
    <ActionCue {...POINTS.iphoneApp} at={launchAt} />
  </Stage>;
};
