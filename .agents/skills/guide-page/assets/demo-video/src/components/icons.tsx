import React from "react";
import { colors } from "../theme";

export const CheckIcon: React.FC<{ size?: number; color?: string }> = ({
  size = 16,
  color = "#fff",
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5 13l4 4L19 7" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LockIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="5" y="11" width="14" height="10" rx="2" fill={colors.gray500} />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke={colors.gray500} strokeWidth="2" fill="none" />
  </svg>
);
