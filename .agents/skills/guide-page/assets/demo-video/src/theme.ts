export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const colors = {
  white: "#FFFFFF",
  blue50: "#EFF6FF",
  blue100: "#DBEAFE",
  blue600: "#2563EB",
  blue700: "#1D4ED8",
  indigo600: "#4F46E5",
  gray50: "#F9FAFB",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray300: "#D1D5DB",
  gray400: "#9CA3AF",
  gray500: "#6B7280",
  gray600: "#4B5563",
  gray700: "#374151",
  gray800: "#1F2937",
  gray900: "#111827",
  green50: "#F0FDF4",
  green600: "#16A34A",
  red50: "#FEF2F2",
  red600: "#DC2626",
  purple50: "#FAF5FF",
  purple600: "#9333EA",
  yellow50: "#FEFCE8",
  amber300: "#FCD34D",
} as const;

export const SCENE_BACKGROUND =
  "linear-gradient(160deg, #EEF2FF 0%, #F8FAFC 55%, #F1F5F9 100%)";

// 가이드 스틸의 기본 크롭(src/stills/*.ts 의 DEFAULT_CROP)도 이 영역이다.
export const BROWSER = { x: 180, y: 70, w: 1560, h: 800, chrome: 88 } as const;
