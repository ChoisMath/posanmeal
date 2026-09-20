import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT } from "../fonts";
import { colors } from "../theme";
import { tween } from "../anim";

export const StepBadge: React.FC<{ step: number; total?: number; label: string }> = ({
  step,
  total = 8,
  label,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 60,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: FONT,
        opacity: tween(frame, [0, 12], [0, 1]),
      }}
    >
      <div
        style={{
          background: colors.blue600,
          color: "#fff",
          fontWeight: 800,
          fontSize: 20,
          padding: "6px 14px",
          borderRadius: 999,
          letterSpacing: 1,
          whiteSpace: "nowrap",
        }}
      >
        STEP {step}/{total}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: colors.gray700, whiteSpace: "nowrap" }}>
        {label}
      </div>
    </div>
  );
};
