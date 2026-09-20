import React from "react";
import { useCurrentFrame } from "remotion";
import { tween } from "../../anim";
import { Stage, Reveal, currentLine } from "../SceneLayout";
import { lineStart } from "../timing";
import { PALETTE as P } from "../style";

export const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const line = currentLine("Closing", frame);
  const helpEnter = tween(frame, [lineStart("Closing", 2), lineStart("Closing", 2) + 20], [0, 1]);
  const farewell = tween(frame, [lineStart("Closing", 3), lineStart("Closing", 3) + 20], [0, 1]);
  return <Stage id="Closing" chapter={line < 2 ? "이 네 가지만 기억하세요" : "필요할 때 다시 확인하세요"} dark>
    <div style={{ opacity: 1 - helpEnter, translate: `0 ${-22 * helpEnter}px` }}>
      <Reveal delay={4} style={{ position: "absolute", left: 124, top: 231, width: 1670 }}>
        <div style={{ fontSize: 104, color: P.orangeSoft, fontWeight: 800, letterSpacing: -4 }}>meal.posan.kr</div>
        <div style={{ fontSize: 42, marginTop: 28, fontWeight: 600 }}>안전한 이용을 위한 네 가지 약속</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 22, marginTop: 85 }}>
          {[["01", "등록된 계정", "내 계정으로 로그인"], ["02", "QR 보안", "내 코드는 나만 사용"], ["03", "본인 확인", "얼굴 인식 후 확인"], ["04", "기록 확인", "낯선 기록은 문의"]].map(([number, title, sub], index) => <Reveal key={title} delay={14 + index * 6}>
            <div style={{ borderTop: `2px solid ${P.orange}`, padding: "25px 0" }}><div style={{ color: P.orange, fontSize: 22, fontWeight: 700 }}>{number}</div><div style={{ fontSize: 36, fontWeight: 700, marginTop: 18, whiteSpace: "nowrap" }}>{title}</div><div style={{ fontSize: 25, color: P.line, marginTop: 12, whiteSpace: "nowrap" }}>{sub}</div></div>
          </Reveal>)}
        </div>
      </Reveal>
    </div>
    <div style={{ opacity: helpEnter, translate: `0 ${28 * (1 - helpEnter)}px` }}>
      <div style={{ position: "absolute", left: 124, top: 229, fontSize: 59, fontWeight: 800, letterSpacing: -2, whiteSpace: "nowrap" }}>사용 방법이 다시 궁금할 때</div>
      <div style={{ position: "absolute", left: 124, top: 373, width: 226, textAlign: "center" }}>
        <div style={{ height: 226, borderRadius: 58, background: P.orangeSoft, color: P.orange, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 162, fontWeight: 800, boxShadow: `0 18px 42px ${P.shadow}` }}>?</div>
        <div style={{ fontSize: 29, color: P.line, fontWeight: 600, marginTop: 24, whiteSpace: "nowrap" }}>물음표 아이콘</div>
      </div>
      <svg style={{ position: "absolute", left: 402, top: 465 }} width="65" height="40" viewBox="0 0 65 40" fill="none"><path d="M3 20h55M45 4l16 16-16 16" stroke={P.orange} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div style={{ position: "absolute", left: 523, top: 347, width: 1263, height: 362, boxSizing: "border-box", border: `1.5px solid ${P.orange}`, borderRadius: 30, padding: "43px 54px", background: P.paper, color: P.ink }}>
        <div style={{ color: P.orange, fontSize: 23, fontWeight: 800, letterSpacing: 1.8 }}>STUDENT GUIDE</div>
        <div style={{ fontSize: 63, fontWeight: 800, letterSpacing: -2.6, marginTop: 12, whiteSpace: "nowrap" }}>학생 안내 페이지</div>
        <div style={{ fontSize: 31, color: P.muted, marginTop: 15, whiteSpace: "nowrap" }}>이 영상과 안내 내용을 언제든 다시 확인하세요.</div>
        <div style={{ display: "flex", gap: 16, marginTop: 27 }}>
          {["급식 신청", "QR · 얼굴 체크인", "식사 기록 확인"].map((label) => <span key={label} style={{ fontSize: 23, fontWeight: 600, border: `1px solid ${P.line}`, padding: "9px 16px", borderRadius: 10, background: P.white, whiteSpace: "nowrap" }}>{label}</span>)}
        </div>
      </div>
      <div style={{ position: "absolute", left: 124, top: 786, opacity: farewell, translate: `0 ${18 * (1 - farewell)}px`, fontSize: 39, fontWeight: 600, color: P.orangeSoft, whiteSpace: "nowrap" }}>안전하게 이용하고, 맛있게 식사하세요.</div>
    </div>
  </Stage>;
};
