import React from "react";
import { CanvasImage, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, MONO } from "../fonts";
import { APPLICATION, APP_COLORS as C, HISTORY_TIMES, MOCK_DATE, MOCK_DISHES, STUDENT } from "./data";

const row: React.CSSProperties = { display: "flex", alignItems: "center" };
const card: React.CSSProperties = { background: C.card, borderRadius: 16, boxShadow: "0 1px 3px #0000000a, 0 6px 24px #0000000f" };
const button: React.CSSProperties = { ...row, justifyContent: "center", minHeight: 44, padding: "0 16px", borderRadius: 12, background: C.orange, color: "white", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", gap: 7 };

function Glyph({ name, size = 20, color = "currentColor" }: { name: "arrow" | "face" | "camera" | "check" | "logout" | "trash" | "moon" | "sun" | "utensils" | "qr"; size?: number; color?: string }) {
  const paths: Record<typeof name, React.ReactNode> = {
    arrow: <path d="m9 5 7 7-7 7" />,
    face: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" /><path d="M8 10h.01M16 10h.01M8 15q4 4 8 0" /></>,
    camera: <><path d="M8 5 6 8H3v12h18V8h-3l-2-3z" /><circle cx="12" cy="13" r="3.5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    logout: <><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    utensils: <><path d="m4 3 17 18M3 7l4-4m-1 7 4-4M3 3l5 5m4 6-8 7M20 3c-6 0-8 4-6 7l2 2 5-5V3z" /></>,
    qr: <><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3M3 12h3m6-3v6m0 6v-3m6-6h3" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{paths[name]}</svg>;
}

function Brand({ dark = false, label = "PosanMeal" }: { dark?: boolean; label?: string }) {
  return <div style={{ ...row, gap: 9, whiteSpace: "nowrap", fontWeight: 700, fontSize: 16, color: dark ? C.ink : "white" }}>
    <span style={{ ...row, justifyContent: "center", height: 30, width: 30, background: dark ? "#fff9" : "#ffffff26", border: "1px solid #ffffff4d", borderRadius: 8 }}><CanvasImage src={staticFile("meal.png")} style={{ width: 28, height: 28 }} /></span>{label}
  </div>;
}

export function Avatar({ size = 96 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 160 160" style={{ display: "block", flexShrink: 0 }} aria-label="가상 학생 일러스트">
    <rect width="160" height="160" rx="35" fill="#e6eef2" />
    <path d="M18 160c3-31 28-48 62-48s59 17 62 48" fill="#314d62" />
    <path d="m57 116 23 21 24-21-12-9H68z" fill="#fff" />
    <path d="M68 97h24v24l-12 10-12-10z" fill="#e7b794" />
    <ellipse cx="80" cy="71" rx="34" ry="43" fill="#efc8a8" />
    <path d="M45 74c-9-32 7-51 33-52 28-1 45 17 39 46-15-1-30-9-38-21-6 15-18 23-34 27" fill="#283238" />
    <ellipse cx="66" cy="76" rx="2.4" ry="3.1" fill="#30373a" /><ellipse cx="94" cy="76" rx="2.4" ry="3.1" fill="#30373a" />
    <path d="M73 94q7 6 14 0" fill="none" stroke="#ad7359" strokeWidth="2.6" strokeLinecap="round" />
    <path d="m80 137-8 8 8 15 8-15z" fill="#d28952" />
  </svg>;
}

export function MockQr({ size = 280 }: { size?: number }) {
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) {
    const finder = (x < 8 && y < 8) || (x > 20 && y < 8) || (x < 8 && y > 20);
    const center = x >= 10 && x <= 18 && y >= 12 && y <= 16;
    if (!finder && !center && ((x * 17 + y * 13 + x * y * 3) % 7 < 3)) cells.push(<rect key={`${x}-${y}`} x={x + 2} y={y + 2} width={1} height={1} />);
  }
  return <svg width={size} height={size} viewBox="0 0 33 33" style={{ background: "white", border: `1px solid ${C.line}`, borderRadius: 12, display: "block" }} aria-label="스캔할 수 없는 안내용 QR 목업">
    <g fill="#151515">{cells}{[[2, 2], [24, 2], [2, 24]].map(([x, y]) => <g key={`${x}-${y}`}><rect x={x} y={y} width={7} height={7} /><rect x={x + 1} y={y + 1} width={5} height={5} fill="white" /><rect x={x + 2} y={y + 2} width={3} height={3} /></g>)}</g>
    <text x="16.5" y="17" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="2.5" fontWeight="700" fill="#7c746d">DEMO</text>
  </svg>;
}

export function LandingMock({ resetHighlight = false }: { resetHighlight?: boolean }) {
  return <div style={{ width: 390, height: 752, background: C.warm, fontFamily: FONT, color: C.ink, position: "relative" }}>
    <div style={{ position: "absolute", left: 16, top: 16, zIndex: 1, padding: "6px 10px", borderRadius: 50, background: "#ffffffb3", boxShadow: "0 2px 8px #0001" }}><Brand dark /></div>
    <div style={{ height: 463, background: "linear-gradient(135deg, oklch(0.72 0.17 55), oklch(0.65 0.20 35))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", textAlign: "center" }}>
      <div style={{ paddingTop: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 50, background: "#ffffff26", padding: "7px 16px", fontSize: 13, marginBottom: 24 }}><span style={{ width: 8, height: 8, background: "#86efac", borderRadius: 50 }} />SMART-QR 석식 관리</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1.5, whiteSpace: "nowrap" }}>포산고등학교</div>
        <div style={{ color: "#ffffffcc", fontSize: 18, marginTop: 8 }}>석식 체크인 시스템</div>
      </div>
    </div>
    <div style={{ position: "absolute", top: 423, left: 24, right: 24, ...card, padding: 24, background: "#ffffffed" }}>
      <div style={{ ...button, height: 49, fontSize: 16 }}><span style={{ fontFamily: "Arial", fontWeight: 700, fontSize: 23 }}>G</span> Google로 로그인</div>
      <div style={{ ...row, gap: 12, margin: "20px 0", color: C.muted, fontSize: 12 }}><div style={{ height: 1, background: C.line, flex: 1 }} />또는<div style={{ height: 1, background: C.line, flex: 1 }} /></div>
      <div style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>관리자 로그인 →</div>
    </div>
    <div style={{ position: "absolute", top: 635, width: "100%", textAlign: "center", color: C.muted, fontSize: 12 }}><span style={{ textDecoration: "underline", textUnderlineOffset: 4, padding: 8, borderRadius: 8, background: resetHighlight ? "#ffedd5" : "transparent", outline: resetHighlight ? "3px solid #f59e0b" : undefined }}>앱이 안 풀려요? 초기화</span></div>
  </div>;
}

export function AccountPickerMock({ selected = "registered" }: { selected?: "registered" | "other" }) {
  return <div style={{ width: 390, height: 752, background: "#fff", fontFamily: FONT, color: "#202124", padding: "48px 25px", boxSizing: "border-box" }}>
    <div style={{ fontFamily: "Arial", fontSize: 32, fontWeight: 700, color: "#4285f4", textAlign: "center", marginBottom: 24 }}>G</div>
    <div style={{ textAlign: "center", fontSize: 25, fontWeight: 500 }}>계정 선택</div>
    <div style={{ textAlign: "center", fontSize: 14, margin: "10px 0 35px" }}><span style={{ color: "#1a73e8" }}>PosanMeal</span>(으)로 이동</div>
    {([['registered', STUDENT.email], ['other', STUDENT.otherEmail]] as const).map(([key, email]) => <div key={key} style={{ ...row, gap: 12, padding: "17px 10px", borderBottom: "1px solid #dadce0", background: selected === key ? "#e8f0fe" : "white", borderRadius: 8 }}>
      <div style={{ width: 36, height: 36, ...row, justifyContent: "center", borderRadius: 50, background: key === "registered" ? "#226b52" : "#a35433", color: "white", fontSize: 18 }}>이</div>
      <div><div style={{ fontSize: 15, fontWeight: 600 }}>{STUDENT.name}</div><div style={{ fontSize: 11.5, marginTop: 3, whiteSpace: "nowrap" }}>{email}</div></div>
    </div>)}
    <div style={{ ...row, gap: 14, padding: "20px 13px", borderBottom: "1px solid #dadce0", fontSize: 14 }}><span style={{ border: "1px solid #777", borderRadius: 50, width: 22, height: 22, display: "grid", placeItems: "center" }}>+</span>다른 계정 사용</div>
    <p style={{ fontSize: 11.5, lineHeight: 1.8, color: "#5f6368", marginTop: 27, wordBreak: "keep-all" }}>계속하려면 Google에서 이름, 이메일 주소, 프로필 사진을 PosanMeal과 공유합니다.</p>
  </div>;
}

function MealContent() {
  return <div style={{ ...card, padding: "22px 16px" }}>
    <div style={{ ...row, justifyContent: "space-between", marginBottom: 18 }}><span style={{ rotate: "180deg", padding: 5 }}><Glyph name="arrow" size={19} /></span><strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>{MOCK_DATE.label}</strong><Glyph name="arrow" size={19} /></div>
    <div style={{ display: "grid", gap: 15 }}>{MOCK_DISHES.map((meal) => <div key={meal.label} style={{ border: `1px solid ${C.line}`, borderRadius: 15, overflow: "hidden" }}>
      <div style={{ ...row, justifyContent: "space-between", padding: "12px 14px", background: meal.color, color: "white" }}><span style={{ ...row, gap: 7, fontSize: 14, fontWeight: 700 }}><Glyph name={meal.label === "석식" ? "moon" : meal.label === "중식" ? "utensils" : "sun"} size={16} />{meal.label}</span><span style={{ fontSize: 11, opacity: 0.85 }}>{meal.calories}</span></div>
      <div style={{ padding: "12px 14px", display: "grid", gap: 7 }}>{meal.dishes.map(([dish, allergy]) => <div key={dish} style={{ ...row, gap: 7, fontSize: 13 }}><span style={{ whiteSpace: "nowrap" }}>{dish}</span>{allergy && <span style={{ padding: "2px 6px", borderRadius: 20, fontSize: 9, color: C.muted, background: "#f4f1ec", whiteSpace: "nowrap" }}>{allergy}</span>}</div>)}</div>
      <div style={{ ...row, justifyContent: "space-between", borderTop: `1px solid ${C.line}`, padding: "8px 14px", color: C.muted, fontSize: 11 }}>영양 정보<span style={{ rotate: "90deg" }}><Glyph name="arrow" size={13} /></span></div>
    </div>)}</div>
  </div>;
}

function Calendar({ history = false, highlightDay = 18, compact = false }: { history?: boolean; highlightDay?: number; compact?: boolean }) {
  const firstDay = history ? 2 : 4;
  const days = history ? 30 : 31;
  return <div>
    <div style={{ ...row, justifyContent: "space-between", padding: history ? "2px 0 16px" : "9px 12px", background: history ? "white" : "#fff1f2", fontSize: 15, fontWeight: 700, color: history ? C.ink : "#be123c" }}>{history && <span style={{ rotate: "180deg" }}><Glyph name="arrow" size={17} /></span>}<span style={{ textAlign: "center", flex: 1 }}>2026년 {history ? "9" : "10"}월</span>{history && <Glyph name="arrow" size={17} />}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: history ? 4 : 0 }}>
      {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, padding: "9px 0", color: i === 0 ? "#ef4444" : i === 6 ? "#3b82f6" : C.muted, background: history ? "white" : "#fff1f2" }}>{d}</div>)}
      {Array.from({ length: firstDay + days }, (_, i) => {
        const day = i - firstDay + 1;
        const times = HISTORY_TIMES[day];
        const selected = (APPLICATION.selectedDays as readonly number[]).includes(day);
        return <div key={i} style={{ display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", height: history ? 59 : compact ? 24 : 38, border: history ? "none" : `1px solid ${C.line}`, borderRadius: history ? 6 : 0, background: history ? times ? "#dcfce7" : "white" : selected && day > 0 ? "#fef9c3" : "white", color: history && times ? "#166534" : C.ink, outline: history && day === highlightDay ? "2px solid #059669" : undefined, outlineOffset: -2, fontSize: 12 }}>
          {day > 0 && <><div>{day}{!history && selected && <span style={{ color: "#d97706", fontSize: 10, marginLeft: 2 }}>✓</span>}</div>{history && times?.map((time, j) => <div key={time} style={{ fontSize: 8.5, marginTop: 2, whiteSpace: "nowrap", color: j === 0 ? "#ea580c" : "#047857" }}>{time}</div>)}</>}
        </div>;
      })}
    </div>
  </div>;
}

function ProfileContent({ faceState }: { faceState: "idle" | "consent" | "camera" | "registered" }) {
  return <>
    <div style={{ ...card, padding: "24px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", flexDirection: "column", gap: 12, marginBottom: 18 }}><div style={{ borderRadius: 50, overflow: "hidden" }}><Avatar size={96} /></div><div style={{ ...button, background: "white", border: `1px solid ${C.line}`, color: C.ink, minHeight: 36, fontWeight: 500, fontSize: 12 }}>사진 변경</div></div>
      <div style={{ ...row, justifyContent: "space-between", borderBottom: `1px solid ${C.line}`, padding: "12px 0", fontSize: 14 }}><span style={{ color: C.muted }}>안면인식</span>{faceState === "registered" ? <div style={{ ...row, gap: 6 }}><span style={{ color: C.green, fontSize: 11, fontWeight: 700 }}>등록됨 (2026. 9. 18.)</span><span style={{ ...button, padding: "0 8px", background: "white", color: C.ink, border: `1px solid ${C.line}`, fontSize: 11 }}>재등록</span><Glyph name="trash" size={17} color="#dc2626" /></div> : <div style={{ ...button, fontSize: 12 }}><Glyph name="face" size={17} />얼굴 등록하기</div>}</div>
      {[["학년", "1학년"], ["반", "2반"], ["번호", "7번"], ["이름", STUDENT.name]].map(([key, value]) => <div key={key} style={{ ...row, justifyContent: "space-between", borderBottom: `1px solid ${C.line}`, padding: "15px 0", fontSize: 14 }}><span style={{ color: C.muted }}>{key}</span><strong style={{ fontWeight: 500 }}>{value}</strong></div>)}
    </div>
    {(faceState === "consent" || faceState === "camera") && <div style={{ position: "absolute", inset: 0, background: "#0008", display: "flex", alignItems: "center", padding: 16, boxSizing: "border-box" }}>
      <div style={{ width: "100%", borderRadius: 17, background: "white", padding: 20, boxShadow: "0 20px 55px #0005", boxSizing: "border-box" }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, whiteSpace: "nowrap" }}>{faceState === "consent" ? "안면인식정보 수집·이용 동의" : "얼굴 등록 (2/3)"}</div>
        {faceState === "consent" ? <><div style={{ background: "#f8f6f3", padding: 13, borderRadius: 12, color: C.muted, fontSize: 11.5, lineHeight: 1.75, wordBreak: "keep-all" }}><strong style={{ color: C.ink }}>[민감정보 수집·이용 동의]</strong><p>수집 항목: 얼굴 특징정보<br />얼굴 사진 원본은 서버에 저장하지 않습니다.</p><p>목적: 급식 체크인 시 본인 확인<br />보유: 졸업·전출 또는 삭제 요청 시까지</p><p>동의하지 않아도 QR 체크인을 이용할 수 있습니다.<br />개인정보 탭에서 언제든 삭제·철회할 수 있습니다.</p></div><div style={{ ...row, gap: 8, fontSize: 12, margin: "17px 0" }}><span style={{ width: 16, height: 16, background: C.orange, borderRadius: 3, display: "grid", placeItems: "center" }}><Glyph name="check" size={13} color="white" /></span>위 내용에 동의합니다</div><div style={button}>동의하고 촬영 시작</div></> : <><div style={{ height: 300, background: "#34444d", borderRadius: 12, display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}><Avatar size={245} /><div style={{ position: "absolute", top: 34, left: 54, width: 205, height: 231, border: "2px solid #86efac", borderRadius: 90 }} /></div><div style={{ fontSize: 11, textAlign: "center", color: C.muted, margin: "15px 0", whiteSpace: "nowrap" }}>촬영 2/3 — 고개를 살짝 움직여 주세요</div><div style={{ ...button, color: C.ink, background: "white", border: `1px solid ${C.line}` }}>취소</div></>}
      </div>
    </div>}
  </>;
}

function ApplicationContent({ stage }: { stage: "list" | "select" | "signature" | "edit" | "complete" }) {
  const isSigning = stage === "signature" || stage === "edit";
  if (stage === "list" || stage === "complete") return <div>
    <div style={{ ...row, justifyContent: "flex-end", margin: "2px 0 12px" }}><div style={{ ...button, color: C.ink, background: "white", border: `1px solid ${C.line}`, fontSize: 12, minHeight: 44 }}>신청내역</div></div>
    <div style={{ ...card, padding: 18 }}><div style={{ ...row, justifyContent: "space-between", gap: 6 }}><strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>{APPLICATION.title}</strong><span style={{ background: stage === "complete" ? "#dcfce7" : "#dbeafe", color: stage === "complete" ? "#166534" : "#1e40af", padding: "4px 8px", borderRadius: 30, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{stage === "complete" ? "신청완료" : "미신청"}</span></div><p style={{ fontSize: 12, color: C.muted, margin: "14px 0" }}>{APPLICATION.dateRange}</p><span style={{ display: "inline-block", borderRadius: 20, background: "#fef3c7", color: "#92400e", padding: "5px 9px", fontSize: 11 }}>석식 5,500원</span><div style={{ ...row, justifyContent: "flex-end", marginTop: 15 }}><div style={{ ...button, fontSize: 12, background: stage === "complete" ? "white" : C.orange, color: stage === "complete" ? C.ink : "white", border: stage === "complete" ? `1px solid ${C.line}` : undefined }}>{stage === "complete" ? "수정/취소" : "신청하기"}</div></div></div>
    {stage === "complete" && <div style={{ ...row, gap: 9, padding: "16px 18px", marginTop: 17, borderRadius: 14, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", fontSize: 14, fontWeight: 600 }}><Glyph name="check" size={20} />신청이 완료되었습니다.</div>}
  </div>;
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={{ ...row, gap: 5, height: isSigning ? 20 : 35, color: C.muted, fontSize: 13 }}><span style={{ rotate: "180deg" }}><Glyph name="arrow" size={16} /></span>목록으로</div>
    {stage === "select" && <div style={{ ...card, padding: 16 }}><strong style={{ fontSize: 16 }}>{APPLICATION.title}</strong><div style={{ ...row, justifyContent: "space-between", fontSize: 11, paddingTop: 14, color: C.muted }}><span>신청 기간</span><span>{APPLICATION.period}</span></div><div style={{ ...row, justifyContent: "space-between", fontSize: 12, paddingTop: 12 }}><span style={{ color: C.muted }}>이름 / 학번</span><span>{STUDENT.name} / {STUDENT.studentNumber}</span></div></div>}
    <div style={{ ...card, overflow: "hidden" }}><div style={{ ...row, gap: 7, padding: "12px 14px", background: "#ffe4e6", color: "#be123c", fontSize: 12 }}><strong>석식</strong><span style={{ background: "#fff1f2", borderRadius: 20, padding: "4px 7px", fontSize: 10 }}>신청/미신청</span><span style={{ marginLeft: "auto", ...row, gap: 6, color: C.ink, whiteSpace: "nowrap", fontSize: 11 }}><span style={{ width: 13, height: 13, borderRadius: 20, border: "4px solid #2563eb", background: "white", boxSizing: "border-box" }} />신청함<span style={{ width: 13, height: 13, borderRadius: 20, border: "1px solid #aaa", marginLeft: 4 }} />신청안함</span></div><div style={{ padding: 12 }}><Calendar compact={isSigning} /><div style={{ fontSize: 13, fontWeight: 600, paddingTop: 14 }}>총 급식비 : 110,000원</div></div></div>
    <div style={{ ...card, padding: 16 }}><div style={{ fontSize: 15, fontWeight: 700 }}>총 납부 금액 : 110,000원</div>{isSigning && <><div style={{ fontSize: 13, fontWeight: 500, margin: "16px 0 8px" }}>서명</div><div style={{ height: 82, border: "2px dashed #d1d5db", borderRadius: 10, background: "#f9fafb" }}><svg viewBox="0 0 300 100" width="100%" height="100%"><path d="M81 28c-20-7-29 24-9 30s27-24 9-30M107 19l-6 56M128 30h26l-4 33M171 19l-5 57m4-31h18M218 23c-20-4-24 21-5 25s26-22 5-25m-3 30-1 12m-18 0h40m-40 11-1 13h40M65 84q79 16 184-4" fill="none" stroke="#263849" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" /></svg></div><div style={{ ...row, justifyContent: "flex-end", margin: "6px 0 10px" }}><span style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 10px", fontSize: 10, color: C.ink, whiteSpace: "nowrap" }}>서명 지우기</span></div><div style={{ ...row, justifyContent: "flex-end", gap: 8 }}><div style={{ ...button, color: C.ink, background: "white", border: `1px solid ${C.line}`, fontSize: 12 }}>목록으로</div><>{stage === "edit" && <div style={{ ...button, fontSize: 12, padding: "0 12px", color: "#dc2626", background: "white", border: "1px solid #fca5a5" }}>신청 취소</div>}<div style={{ ...button, fontSize: 12, padding: "0 12px" }}>{stage === "edit" ? "신청 수정" : "신청하기"}</div></></div></>}</div>
  </div>;
}

export function StudentAppMock({ tab, fixed = false, faceState = "idle", hasApplication = false, applicationStage = "list", highlightDay = 18 }: {
  tab: "meal" | "apply" | "qr" | "profile" | "history";
  fixed?: boolean;
  faceState?: "idle" | "consent" | "camera" | "registered";
  hasApplication?: boolean;
  applicationStage?: "list" | "select" | "signature" | "edit" | "complete";
  highlightDay?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeLeft = Math.max(0, 152 - Math.floor(frame / fps));
  const qrCountdown = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")} 남음`;
  const tabs = [{ id: "meal", label: "식단" }, ...((hasApplication || tab === "apply") ? [{ id: "apply", label: "신청" }] : []), { id: "qr", label: "QR" }, { id: "profile", label: "개인정보" }, { id: "history", label: "확인" }];
  return <div style={{ width: 390, height: 752, position: "relative", background: C.warm, overflow: "hidden", fontFamily: FONT, color: C.ink, boxSizing: "border-box" }}>
    <div style={{ ...row, justifyContent: "space-between", height: 58, padding: "0 16px", background: C.header }}><Brand /><Glyph name="logout" size={19} color="#ffffffcc" /></div>
    <div style={{ padding: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length},1fr)`, height: 44, padding: 4, borderRadius: 12, background: "#efebe6", boxSizing: "border-box", marginBottom: 12 }}>{tabs.map((item) => <div key={item.id} style={{ ...row, justifyContent: "center", gap: 3, borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: tab === item.id ? "white" : "transparent", color: tab === item.id ? C.ink : C.muted, boxShadow: tab === item.id ? "0 1px 3px #0001" : undefined }}>{item.label}{item.id === "apply" && applicationStage !== "complete" && applicationStage !== "edit" && <span style={{ width: 14, height: 14, borderRadius: 20, background: "#ef4444", color: "white", display: "grid", placeItems: "center", fontSize: 9 }}>1</span>}</div>)}</div>
      {tab === "meal" && <MealContent />}
      {tab === "apply" && <ApplicationContent stage={applicationStage} />}
      {tab === "qr" && <div style={{ ...card, padding: "26px 20px 27px", textAlign: "center" }}><div style={{ display: "flex", justifyContent: "center" }}><MockQr /></div><div style={{ marginTop: 17, fontSize: 13, fontFamily: fixed ? FONT : MONO, fontWeight: fixed ? 600 : 400, color: fixed ? "#d97706" : C.muted, whiteSpace: "nowrap" }}>{fixed ? "로컬 모드 — 고유 QR코드" : qrCountdown}</div><div style={{ fontSize: 15, fontWeight: 700, marginTop: 20, whiteSpace: "nowrap" }}>1학년 2반 7번 {STUDENT.name}</div><div style={{ fontSize: 12, color: C.muted, marginTop: 7 }}>오늘 식사: 중식 · 석식</div></div>}
      {tab === "profile" && <ProfileContent faceState={faceState} />}
      {tab === "history" && <div style={{ ...card, padding: "24px 15px 22px" }}><Calendar history highlightDay={highlightDay} /></div>}
    </div>
  </div>;
}

export function KioskMock({ mode, mismatch = false }: { mode: "qr" | "face" | "confirm" | "success"; mismatch?: boolean }) {
  const isFace = mode !== "qr";
  const isSuccess = mode === "success";
  return <div style={{ width: 1100, height: 620, background: "#111827", color: "white", position: "relative", fontFamily: FONT, borderRadius: 16, padding: "0 14px 12px", boxSizing: "border-box", boxShadow: "0 24px 60px #0003", overflow: "hidden" }}>
    <div style={{ ...row, height: 52, gap: 20, padding: "0 2px", fontSize: 12 }}><div style={{ padding: "4px 11px 4px 4px", borderRadius: 30, background: "#0006" }}><Brand label="홈으로" /></div>{isFace && <span>안면인식 체크인</span>}<span style={{ color: "#34d399" }}>● 온라인</span><span style={{ color: "#ffffffa8" }}>{isFace ? "" : "온라인 모드"}</span>{isFace && <span style={{ marginLeft: "auto", color: "#ffffffa8" }}>얼굴 인식 · {mode === "confirm" ? "확인 대기" : "인식 중"}</span>}</div>
    <div style={{ height: 439, border: `12px solid ${isSuccess ? "#10b981" : "#e5e7eb"}`, borderRadius: 18, background: "#1c2b34", position: "relative", overflow: "hidden", display: "grid", placeItems: "center", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #42545e 0%, #23313c 100%)" }} />
      <div style={{ position: "absolute", left: 24, top: 20, fontSize: 10, letterSpacing: 2, color: "#ffffff77" }}>DEMO CAMERA</div>
      {isFace ? <div style={{ position: "relative", marginTop: 12 }}><Avatar size={355} /><div style={{ position: "absolute", top: 32, left: 60, width: 231, height: 260, border: "3px solid #34d399", borderRadius: 36 }} /></div> : <div style={{ position: "relative", width: 283, height: 310, borderRadius: 27, padding: 14, background: "#f8fafc", boxSizing: "border-box", boxShadow: "0 12px 24px #0004" }}><MockQr size={253} /><div style={{ color: "#475569", fontSize: 11, textAlign: "center", marginTop: 10 }}>1학년 2반 7번 이가온</div></div>}
      {!isFace && <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 1048 415"><path d="M337 58h-30v30m434-30h30v30M307 327v30h30m434-30v30h-30" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>}
    </div>
    <div style={{ ...row, justifyContent: "center", gap: 12, height: 52, borderRadius: 10, marginTop: 6, background: "white", color: isSuccess ? "#047857" : "#0f172a", fontSize: 17, fontWeight: 600, whiteSpace: "nowrap" }}>{isSuccess ? <><Glyph name="check" size={23} /><span>1학년 2반 7번 이가온 · 석식 체크인 하였습니다.</span></> : isFace ? "학번과 이름을 확인해 주세요" : "QR 코드를 카메라에 보여주세요"}</div>
    <div style={{ ...row, justifyContent: "flex-end", height: 54 }}><div style={{ ...button, background: "#ffffffe6", color: "#111827", minHeight: 38, borderRadius: 50, padding: "0 18px", fontSize: 14 }}><Glyph name={isFace ? "qr" : "face"} size={18} />{isFace ? "QR로 체크인" : "얼굴로 체크인"}</div></div>
    {mode === "confirm" && <div style={{ position: "absolute", inset: 0, background: "#0009", display: "grid", placeItems: "center" }}><div style={{ width: 530, borderRadius: 20, background: "white", color: "#0f172a", padding: "24px 28px", boxSizing: "border-box", textAlign: "center", boxShadow: "0 20px 70px #0006" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Avatar size={84} /></div><div style={{ fontSize: 25, fontWeight: 800, whiteSpace: "nowrap" }}>{mismatch ? "10312 김다온" : `${STUDENT.studentNumber} ${STUDENT.name}`}</div><p style={{ fontSize: 15, margin: "10px 0 6px" }}>위 사용자로 인식했습니다.</p><p style={{ fontSize: 15, color: "#64748b", margin: "0 0 8px" }}>이 이름으로 석식 체크인하시겠습니까?</p><p style={{ fontSize: 13, color: "#64748b", margin: "0 0 23px" }}>선택하지 않으면 8초 후 취소됩니다.</p><div style={{ display: "flex", gap: 10 }}><div style={{ ...button, flex: 1, minHeight: 62, fontSize: 21, background: "#059669" }}>확인</div><div style={{ ...button, flex: 1, minHeight: 62, fontSize: 21, background: "#6b7280" }}>취소</div></div>
    </div></div>}
  </div>;
}
