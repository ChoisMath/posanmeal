import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT, MONO } from "../fonts";
import { colors } from "../theme";
import { tween } from "../anim";
import { LockIcon } from "./icons";

export const PHONE = { w: 390, h: 844, statusH: 44, urlH: 48 } as const;

const BEZEL = 12;
const BEZEL_RADIUS = 54;
const SCREEN_RADIUS = BEZEL_RADIUS - BEZEL;

export const PhoneFrame: React.FC<{
  x: number;
  y: number;
  scale?: number;
  url: string;
  children: React.ReactNode;
}> = ({ x, y, scale = 1, url, children }) => {
  const frame = useCurrentFrame();
  const enter = tween(frame, [0, 12], [0, 1]);
  const contentH = PHONE.h - PHONE.statusH - PHONE.urlH;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: PHONE.w + BEZEL * 2,
        height: PHONE.h + BEZEL * 2,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        opacity: enter,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: BEZEL_RADIUS,
          background: "#0B0B0F",
          boxShadow: "0 30px 70px rgba(0,0,0,0.4)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: BEZEL,
          top: BEZEL,
          width: PHONE.w,
          height: PHONE.h,
          borderRadius: SCREEN_RADIUS,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <div
          style={{
            position: "relative",
            width: PHONE.w,
            height: PHONE.statusH,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 22px 0 26px",
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: "#000", whiteSpace: "nowrap" }}>9:41</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 10 }}>
              {[4, 6, 8, 10].map((h) => (
                <div key={h} style={{ width: 3, height: h, borderRadius: 1, background: "#000" }} />
              ))}
            </div>
            <svg width={15} height={11} viewBox="0 0 16 12" fill="none">
              <path d="M1 4.5C4.8 1 11.2 1 15 4.5" stroke="#000" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M3.5 7.2C6 5 10 5 12.5 7.2" stroke="#000" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <circle cx="8" cy="10" r="1.3" fill="#000" />
            </svg>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 22, height: 11, border: "1px solid #000", borderRadius: 3, padding: 1.5, boxSizing: "border-box" }}>
                <div style={{ width: "80%", height: "100%", background: "#000", borderRadius: 1 }} />
              </div>
              <div style={{ width: 2, height: 4, background: "#000", borderRadius: 1, marginLeft: 1 }} />
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            width: 110,
            height: 26,
            borderRadius: 16,
            background: "#000",
          }}
        />
        <div
          style={{
            width: PHONE.w,
            height: PHONE.urlH,
            background: "#fff",
            borderBottom: `1px solid ${colors.gray200}`,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              flex: 1,
              height: 32,
              background: colors.gray100,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 10px",
              overflow: "hidden",
            }}
          >
            <LockIcon size={13} />
            <span
              style={{
                fontFamily: MONO,
                fontSize: 13,
                color: colors.gray700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {url}
            </span>
          </div>
        </div>
        <div style={{ position: "relative", width: PHONE.w, height: contentH, overflow: "hidden", background: "#fff" }}>
          {children}
        </div>
      </div>
    </div>
  );
};
