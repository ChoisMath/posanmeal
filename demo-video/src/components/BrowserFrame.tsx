import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT, MONO } from "../fonts";
import { BROWSER, colors } from "../theme";
import { tween } from "../anim";
import { LockIcon } from "./icons";

export const BrowserFrame: React.FC<{
  url: string;
  highlight?: string;
  tabTitle: string;
  children: React.ReactNode;
}> = ({ url, highlight, tabTitle, children }) => {
  const frame = useCurrentFrame();
  const parts = highlight && url.includes(highlight) ? url.split(highlight) : null;
  return (
    <div
      style={{
        position: "absolute",
        left: BROWSER.x,
        top: BROWSER.y,
        width: BROWSER.w,
        height: BROWSER.h,
        borderRadius: 16,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 24px 60px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.08)",
        fontFamily: FONT,
        opacity: tween(frame, [0, 12], [0, 1]),
        translate: `0px ${tween(frame, [0, 14], [16, 0])}px`,
      }}
    >
      <div style={{ height: 40, background: "#DEE1E6", display: "flex", alignItems: "flex-end", paddingLeft: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", height: 40, marginRight: 14 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        <div
          style={{
            height: 32,
            background: "#fff",
            borderRadius: "10px 10px 0 0",
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 15,
            color: colors.gray700,
            minWidth: 220,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 3, background: colors.blue600 }} />
          <span style={{ whiteSpace: "nowrap" }}>{tabTitle}</span>
        </div>
      </div>
      <div
        style={{
          height: 48,
          background: "#fff",
          borderBottom: `1px solid ${colors.gray200}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 14, color: colors.gray500, fontSize: 20, width: 90 }}>
          <span>←</span>
          <span>→</span>
          <span>⟳</span>
        </div>
        <div
          style={{
            flex: 1,
            height: 34,
            background: "#F1F3F4",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 10,
            overflow: "hidden",
          }}
        >
          <LockIcon size={16} />
          <div
            style={{
              fontFamily: MONO,
              fontSize: 16,
              color: colors.gray800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {parts ? (
              <>
                {parts[0]}
                <span style={{ background: colors.amber300, borderRadius: 4, padding: "2px 4px", fontWeight: 700 }}>
                  {highlight}
                </span>
                {parts.slice(1).join(highlight)}
              </>
            ) : (
              url
            )}
          </div>
        </div>
      </div>
      <div style={{ position: "relative", width: BROWSER.w, height: BROWSER.h - BROWSER.chrome, overflow: "hidden", background: "#fff" }}>
        {children}
      </div>
    </div>
  );
};
