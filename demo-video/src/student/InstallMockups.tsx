import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { FONT } from "../fonts";
import { tween } from "../anim";
import { LockIcon } from "../components/icons";
import { LandingMock } from "./StudentMockups";
import { PHONE_POSITION } from "./style";

const BROWSER = {
  ink: "#202124", muted: "#64676B", line: "#E3E5E9", surface: "#F2F4F8",
  white: "#FFFFFF", blue: "#1967D2", blueSoft: "#E8F0FE", iosBlue: "#007AFF",
  green: "#34C759", black: "#111216", shadow: "rgba(0,0,0,0.24)",
} as const;
const flex: React.CSSProperties = { display: "flex", alignItems: "center" };
const screenPoint = (x: number, y: number) => ({ x: PHONE_POSITION.x + 12 + x, y: PHONE_POSITION.y + 12 + y });

export const INSTALL_POINTS = {
  androidMenu: screenPoint(362, 72), androidInstallMenu: screenPoint(228, 393),
  androidInstall: screenPoint(220, 420), androidConfirm: screenPoint(297, 522),
  androidApp: screenPoint(87, 191), iphoneShare: screenPoint(195, 788),
  iphoneHomeOption: screenPoint(195, 636), iphoneEdit: screenPoint(195, 688),
  iphoneEnableOption: screenPoint(43, 462), iphoneToggle: screenPoint(322, 386),
  iphoneEditDone: screenPoint(345, 245), iphoneAdd: screenPoint(342, 102), iphoneApp: screenPoint(87, 191),
} as const;

type IconName = "more" | "share" | "plus" | "arrow" | "download" | "home" | "bookmark" | "copy" | "check" | "tabs" | "refresh" | "search";
export function InstallIcon({ name, size = 24, color = "currentColor" }: { name: IconName; size?: number; color?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    more: <><circle cx="12" cy="4" r="1.8" fill={color} stroke="none" /><circle cx="12" cy="12" r="1.8" fill={color} stroke="none" /><circle cx="12" cy="20" r="1.8" fill={color} stroke="none" /></>,
    share: <><path d="M8 8H4v13h16V8h-4M12 15V2m-4 4 4-4 4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    download: <><path d="M12 2v13m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    home: <><path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-8h6v8" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    tabs: <><rect x="6" y="6" width="15" height="15" rx="3" /><path d="M16 3H3v13" /></>,
    refresh: <><path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{paths[name]}</svg>;
}

function AppIcon({ size = 60, label = false }: { size?: number; label?: boolean }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
    <Img src={staticFile("posanmeal-app-icon.png")} style={{ width: size, height: size, borderRadius: size * 0.23, boxShadow: "0 3px 10px rgba(0,0,0,0.13)" }} />
    {label && <span style={{ color: BROWSER.white, fontSize: 13, fontWeight: 500, textShadow: "0 1px 4px #0007", whiteSpace: "nowrap" }}>PosanMeal</span>}
  </div>;
}

function StatusBar({ platform, home }: { platform: "android" | "iphone"; home: boolean }) {
  const color = home ? BROWSER.white : BROWSER.black;
  return <div style={{ ...flex, justifyContent: "space-between", position: "absolute", left: 0, right: 0, top: 0, height: 44, padding: "0 25px", color, zIndex: 5 }}>
    <span style={{ fontSize: 15, fontWeight: 700 }}>9:41</span>
    <div style={{ position: "absolute", top: platform === "iphone" ? 10 : 13, left: "50%", transform: "translateX(-50%)", width: platform === "iphone" ? 110 : 13, height: platform === "iphone" ? 26 : 13, background: BROWSER.black, borderRadius: 20 }} />
    <div style={{ ...flex, gap: 6 }}>
      <div style={{ ...flex, alignItems: "end", gap: 2, height: 10 }}>{[4, 6, 8, 10].map((height) => <span key={height} style={{ width: 3, height, borderRadius: 1, background: color }} />)}</div>
      <svg width={15} height={12} viewBox="0 0 16 12" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round"><path d="M1 4C5 1 11 1 15 4M4 7c2-2 6-2 8 0" /><circle cx="8" cy="10" r="1" fill={color} stroke="none" /></svg>
      <span style={{ width: 22, height: 11, border: `1px solid ${color}`, borderRadius: 3, padding: 1.5, boxSizing: "border-box" }}><span style={{ display: "block", width: "80%", height: "100%", background: color, borderRadius: 1 }} /></span>
    </div>
  </div>;
}

function HomeScreen() {
  return <div style={{ position: "absolute", inset: 0, background: "linear-gradient(150deg,#5E748A 0%,#ACAC9D 49%,#D4B494 100%)" }}>
    <div style={{ position: "absolute", left: -95, top: 266, width: 380, height: 620, borderRadius: "50%", background: "#DAA588", rotate: "-25deg" }} />
    <div style={{ position: "absolute", left: 138, top: 422, width: 430, height: 520, borderRadius: "50%", background: "#81999C", rotate: "28deg" }} />
    <div style={{ position: "absolute", left: 44, top: 160, width: 86 }}><AppIcon size={60} label /></div>
    <div style={{ position: "absolute", bottom: 108, left: 0, right: 0, ...flex, justifyContent: "center", gap: 7 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 4, background: i === 0 ? "#fff" : "#fff5" }} />)}</div>
    <div style={{ ...flex, justifyContent: "space-around", position: "absolute", left: 22, right: 22, bottom: 37, height: 68, borderRadius: 24, background: "#ffffff38" }}>
      {[BROWSER.green, BROWSER.iosBlue, "#F9FAFC", "#444D5C"].map((background, index) => <div key={background} style={{ width: 45, height: 45, borderRadius: 12, background, ...flex, justifyContent: "center", color: index === 2 ? BROWSER.blue : "white" }}><InstallIcon name={(["home", "search", "copy", "tabs"] as const)[index]} size={24} /></div>)}
    </div>
  </div>;
}

function BrowserFrame({ platform, home = false, standalone = false, children }: { platform: "android" | "iphone"; home?: boolean; standalone?: boolean; children?: React.ReactNode }) {
  const frame = useCurrentFrame();
  const enter = tween(frame, [0, 12], [0, 1]);
  return <div style={{ position: "absolute", left: PHONE_POSITION.x, top: PHONE_POSITION.y, width: 414, height: 868, opacity: enter, fontFamily: FONT }}>
    <div style={{ position: "absolute", inset: 0, borderRadius: 54, background: BROWSER.black, boxShadow: `0 30px 70px ${BROWSER.shadow}` }} />
    <div style={{ position: "absolute", left: 12, top: 12, width: 390, height: 844, borderRadius: 42, overflow: "hidden", background: BROWSER.white, color: BROWSER.ink }}>
      {home ? <HomeScreen /> : <>
        <div style={{ position: "absolute", left: 0, right: 0, top: standalone ? 44 : 100, bottom: standalone ? 28 : platform === "iphone" ? 84 : 24, overflow: "hidden", zIndex: 0 }}><LandingMock /></div>
        {!standalone && <div style={{ ...flex, gap: 11, position: "absolute", top: 44, left: 0, right: 0, height: 56, padding: "0 13px", background: BROWSER.white, borderBottom: `1px solid ${BROWSER.line}` }}>
          {platform === "android" && <InstallIcon name="home" size={21} />}
          <div style={{ ...flex, justifyContent: "center", flex: 1, gap: 6, height: 38, borderRadius: platform === "android" ? 25 : 13, background: BROWSER.surface, fontSize: 15, whiteSpace: "nowrap" }}><LockIcon size={13} />meal.posan.kr{platform === "iphone" && <span style={{ marginLeft: 30 }}><InstallIcon name="refresh" size={17} /></span>}</div>
          {platform === "android" && <><span style={{ border: `1.7px solid ${BROWSER.ink}`, width: 17, height: 18, borderRadius: 4, textAlign: "center", fontSize: 10, lineHeight: "18px", fontWeight: 700 }}>1</span><InstallIcon name="more" size={23} /></>}
        </div>}
        {!standalone && platform === "iphone" && <div style={{ ...flex, justifyContent: "space-around", position: "absolute", left: 0, right: 0, top: 760, height: 56, background: "#FAFAFC", borderTop: `1px solid ${BROWSER.line}`, color: BROWSER.iosBlue }}>
          <span style={{ rotate: "180deg" }}><InstallIcon name="arrow" size={22} /></span><span style={{ opacity: 0.4 }}><InstallIcon name="arrow" size={22} /></span><InstallIcon name="share" size={26} /><InstallIcon name="bookmark" size={23} /><InstallIcon name="tabs" size={25} />
        </div>}
      </>}
      <StatusBar platform={platform} home={home} />
      {children}
      <div style={{ position: "absolute", bottom: 8, left: 129, width: 132, height: 5, borderRadius: 4, background: home ? "#fff" : BROWSER.black, zIndex: 8 }} />
    </div>
  </div>;
}

function ChromeMenu({ submenu }: { submenu: boolean }) {
  const items = ["새 탭", "새 시크릿 탭", "방문 기록", "다운로드", "북마크", "설치 및 바로가기 만들기"];
  return <>
    <div style={{ position: "absolute", inset: 0, background: "#0002" }} />
    <div style={{ position: "absolute", left: 84, top: 92, width: 294, borderRadius: 18, background: BROWSER.white, padding: "0 8px 12px", boxSizing: "border-box", boxShadow: `0 8px 30px ${BROWSER.shadow}` }}>
      <div style={{ ...flex, justifyContent: "space-around", height: 48, borderBottom: `1px solid ${BROWSER.line}` }}><InstallIcon name="arrow" size={21} /><InstallIcon name="bookmark" size={21} /><InstallIcon name="download" size={21} /><InstallIcon name="refresh" size={21} /></div>
      {items.map((label, i) => <div key={label} style={{ ...flex, gap: 12, height: 46, padding: "0 11px", borderRadius: 9, fontSize: 15.5, whiteSpace: "nowrap", fontWeight: i === 5 ? 600 : 400, background: i === 5 ? BROWSER.blueSoft : "transparent", color: i === 5 ? BROWSER.blue : BROWSER.ink }}><InstallIcon name={(["plus", "tabs", "refresh", "download", "bookmark", "download"] as const)[i]} size={19} />{label}</div>)}
    </div>
    {submenu && <div style={{ position: "absolute", left: 62, top: 344, width: 314, borderRadius: 18, background: BROWSER.white, boxShadow: `0 8px 30px ${BROWSER.shadow}`, paddingBottom: 10 }}>
      <div style={{ ...flex, gap: 10, height: 46, padding: "0 17px", borderBottom: `1px solid ${BROWSER.line}`, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}><span style={{ rotate: "180deg" }}><InstallIcon name="arrow" size={18} /></span>설치 및 바로가기 만들기</div>
      <div style={{ ...flex, gap: 15, height: 60, padding: "0 23px", margin: "0 8px", color: BROWSER.blue, background: BROWSER.blueSoft, borderRadius: 10, fontSize: 18, fontWeight: 600 }}><InstallIcon name="download" size={23} />설치</div>
      <div style={{ ...flex, gap: 15, height: 52, padding: "0 31px", fontSize: 16 }}><InstallIcon name="plus" size={21} />바로가기 만들기</div>
    </div>}
  </>;
}

export type AndroidInstallState = "page" | "menu" | "installMenu" | "dialog" | "installing" | "home" | "app";
export function AndroidInstallMock({ state }: { state: AndroidInstallState }) {
  return <BrowserFrame platform="android" home={state === "home"} standalone={state === "app"}>
    {(state === "menu" || state === "installMenu") && <ChromeMenu submenu={state === "installMenu"} />}
    {(state === "dialog" || state === "installing") && <>
      <div style={{ position: "absolute", inset: 0, background: "#0006" }} />
      <div style={{ position: "absolute", left: 22, top: 284, width: 346, height: 278, borderRadius: 28, padding: "25px 24px", boxSizing: "border-box", background: BROWSER.white, boxShadow: `0 18px 50px ${BROWSER.shadow}` }}>
        <div style={{ fontSize: 23, fontWeight: 600 }}>{state === "installing" ? "설치 중…" : "앱 설치"}</div>
        <div style={{ ...flex, gap: 16, marginTop: 25 }}><AppIcon size={58} /><div><strong style={{ fontSize: 18 }}>PosanMeal</strong><div style={{ marginTop: 8, fontSize: 14, color: BROWSER.muted }}>meal.posan.kr</div></div></div>
        {state === "installing" ? <div style={{ marginTop: 28, color: BROWSER.blue, fontSize: 15, lineHeight: 1.7 }}>설치가 완료될 때까지<br />잠시 기다려 주세요.</div> : <><div style={{ marginTop: 19, fontSize: 12.5, color: BROWSER.muted }}>설치하면 앱에서 이 사이트를 이용할 수 있습니다.</div><div style={{ ...flex, justifyContent: "flex-end", gap: 30, position: "absolute", right: 24, bottom: 18, color: BROWSER.blue, fontSize: 16, fontWeight: 600 }}><span>취소</span><span style={{ ...flex, justifyContent: "center", height: 44, minWidth: 84, borderRadius: 23, background: BROWSER.blue, color: BROWSER.white }}>설치</span></div></>}
      </div>
    </>}
  </BrowserFrame>;
}

function ShareSheet({ scrollProgress }: { scrollProgress: number }) {
  const actions = ["복사", "책갈피 추가", "읽기 목록에 추가", "페이지에서 찾기", "홈 화면에 추가", "동작 편집…"];
  return <>
    <div style={{ position: "absolute", inset: 0, background: "#0004" }} />
    <div style={{ position: "absolute", left: 0, top: 420 - 184 * scrollProgress, width: 390, height: 680, borderRadius: "24px 24px 0 0", background: "#F2F2F7", boxShadow: `0 -10px 30px ${BROWSER.shadow}` }}>
      <div style={{ position: "absolute", left: 174, top: 7, height: 5, width: 42, borderRadius: 4, background: "#C5C5CB" }} />
      <div style={{ ...flex, gap: 12, height: 76, padding: "10px 20px 0", boxSizing: "border-box" }}><AppIcon size={44} /><div><strong style={{ fontSize: 15 }}>PosanMeal</strong><div style={{ fontSize: 12, color: BROWSER.muted, marginTop: 5 }}>meal.posan.kr</div></div><span style={{ marginLeft: "auto", color: BROWSER.muted, fontSize: 24 }}>×</span></div>
      <div style={{ ...flex, justifyContent: "space-around", height: 90, padding: "0 14px" }}>{[["AirDrop", BROWSER.iosBlue], ["메시지", BROWSER.green], ["Mail", "#3995EE"], ["메모", "#E3C443"]].map(([label, background]) => <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, fontSize: 11 }}><div style={{ ...flex, justifyContent: "center", width: 49, height: 49, borderRadius: 13, background, color: BROWSER.white }}><InstallIcon name={label === "AirDrop" ? "share" : "copy"} /></div>{label}</div>)}</div>
      <div style={{ margin: "0 16px", borderRadius: 14, overflow: "hidden", background: BROWSER.white }}>{actions.map((label, i) => <div key={label} style={{ ...flex, justifyContent: "space-between", height: 52, padding: "0 17px", boxSizing: "border-box", borderBottom: i < 5 ? `1px solid ${BROWSER.line}` : undefined, background: i === 4 && scrollProgress > 0.8 ? BROWSER.blueSoft : BROWSER.white, color: i === 5 ? BROWSER.iosBlue : BROWSER.ink, fontSize: 16, fontWeight: i === 4 ? 600 : 400, whiteSpace: "nowrap" }}>{label}<InstallIcon name={(["copy", "bookmark", "bookmark", "search", "plus", "more"] as const)[i]} size={21} /></div>)}</div>
    </div>
  </>;
}

function EditActions({ enabled }: { enabled: boolean }) {
  return <>
    <div style={{ position: "absolute", inset: 0, background: "#0005" }} />
    <div style={{ position: "absolute", top: 214, bottom: 0, left: 0, right: 0, background: "#F2F2F7", borderRadius: "24px 24px 0 0" }}>
      <div style={{ ...flex, justifyContent: "space-between", height: 62, padding: "0 23px", background: BROWSER.white, borderRadius: "24px 24px 0 0", fontSize: 16 }}><span style={{ color: BROWSER.iosBlue }}>취소</span><strong>동작 편집</strong><span style={{ color: BROWSER.iosBlue }}>완료</span></div>
      <div style={{ margin: "28px 23px 10px", fontSize: 13, lineHeight: "18px", color: BROWSER.muted }}>기타 동작</div>
      <div style={{ margin: "0 16px", borderRadius: 15, overflow: "hidden", background: BROWSER.white }}>{["읽기 목록에 추가", "페이지에서 찾기", "홈 화면에 추가"].map((label, i) => <div key={label} style={{ ...flex, gap: 14, height: 52, padding: "0 14px", borderBottom: i < 2 ? `1px solid ${BROWSER.line}` : undefined, background: i === 2 ? BROWSER.blueSoft : BROWSER.white, fontSize: 16, whiteSpace: "nowrap" }}><span style={{ width: 23, height: 23, borderRadius: 20, background: BROWSER.green, color: BROWSER.white, ...flex, justifyContent: "center" }}><InstallIcon name={i === 2 && enabled ? "check" : "plus"} size={17} /></span>{label}</div>)}</div>
      <div style={{ padding: "18px 24px", fontSize: 13, color: BROWSER.muted, lineHeight: 1.6, wordBreak: "keep-all" }}>홈 화면에 추가를 사용하도록 설정한 뒤<br />공유 메뉴로 돌아가세요.</div>
    </div>
  </>;
}

function AddToHome({ webApp }: { webApp: boolean }) {
  return <>
    <div style={{ position: "absolute", inset: 0, background: "#0004" }} />
    <div style={{ position: "absolute", left: 0, right: 0, top: 72, bottom: 0, borderRadius: "24px 24px 0 0", background: "#F2F2F7" }}>
      <div style={{ ...flex, justifyContent: "space-between", height: 60, padding: "0 24px", background: BROWSER.white, borderRadius: "24px 24px 0 0", fontSize: 16 }}><span style={{ color: BROWSER.iosBlue }}>취소</span><strong style={{ fontSize: 17 }}>홈 화면에 추가</strong><span style={{ color: BROWSER.iosBlue, fontWeight: 700 }}>추가</span></div>
      <div style={{ margin: "28px 16px 0", borderRadius: 15, background: BROWSER.white, overflow: "hidden" }}>
        <div style={{ ...flex, gap: 17, padding: "20px 18px" }}><AppIcon size={58} /><div style={{ flex: 1, fontSize: 17, paddingBottom: 12, borderBottom: `1px solid ${BROWSER.line}` }}>PosanMeal<span style={{ float: "right", color: "#AAA", fontSize: 14 }}>⊗</span></div></div>
        <div style={{ borderTop: `1px solid ${BROWSER.line}`, padding: "16px 18px", fontSize: 14, color: BROWSER.muted, whiteSpace: "nowrap" }}>https://meal.posan.kr/</div>
      </div>
      <div style={{ position: "absolute", top: 284, left: 16, right: 16, padding: "14px 18px", ...flex, justifyContent: "space-between", background: BROWSER.white, borderRadius: 15, height: 60, boxSizing: "border-box", fontSize: 17 }}>웹 앱으로 열기<span style={{ width: 51, height: 31, borderRadius: 19, background: webApp ? BROWSER.green : "#D5D5DA", padding: 2, boxSizing: "border-box", display: "flex", justifyContent: webApp ? "flex-end" : "flex-start" }}><span style={{ width: 27, height: 27, borderRadius: 20, background: BROWSER.white, boxShadow: "0 1px 4px #0003" }} /></span></div>
      <div style={{ position: "absolute", top: 358, left: 31, right: 31, fontSize: 13, lineHeight: 1.6, color: BROWSER.muted, wordBreak: "keep-all" }}>홈 화면 아이콘을 누르면<br />앱처럼 별도의 창에서 열립니다.</div>
    </div>
  </>;
}

export type IphoneInstallState = "page" | "share" | "editActions" | "add" | "home" | "app";
export function IphoneInstallMock({ state, scrollProgress = 0, webApp = true, enabled = false }: { state: IphoneInstallState; scrollProgress?: number; webApp?: boolean; enabled?: boolean }) {
  return <BrowserFrame platform="iphone" home={state === "home"} standalone={state === "app"}>
    {state === "share" && <ShareSheet scrollProgress={scrollProgress} />}
    {state === "editActions" && <EditActions enabled={enabled} />}
    {state === "add" && <AddToHome webApp={webApp} />}
  </BrowserFrame>;
}
