import type React from "react";
import type { DemoProps } from "./props";

export type SceneDef = {
  id: string;
  component: React.FC<DemoProps>;
  durationInFrames: number;
};

export const TRANSITION_FRAMES = 12;

// createGuideVideo 는 첫 장면 뒤 모든 장면 사이에 페이드를 넣고, 페이드만큼 앞뒤 장면이 겹친다.
export const totalFrames = (scenes: SceneDef[]) =>
  scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) - TRANSITION_FRAMES * Math.max(scenes.length - 1, 0);
