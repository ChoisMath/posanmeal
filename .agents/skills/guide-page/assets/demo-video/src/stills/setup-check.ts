import { lineAt } from "../setup-check/timing";
import { BROWSER } from "../theme";

export type Crop = { x: number; y: number; w: number; h: number };
export type GuideStill = { composition: string; file: string; frame: number; crop?: Crop; resize?: number };
export const DEFAULT_CROP: Crop = { x: BROWSER.x, y: BROWSER.y, w: BROWSER.w, h: BROWSER.h };

export const STILLS: GuideStill[] = [
  { composition: "SetupCheck-Check", file: "01-environment-check", frame: lineAt("Check", 1, 0.5) },
];
