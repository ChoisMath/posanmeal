import React, { useContext } from "react";
import type { Caption } from "./timing";

export type GuideConfig = {
  // staticFile 기준 오디오 폴더 (끝에 슬래시 없음)
  audioDir: string;
  captionsFor: (id: string) => Caption[];
  stepTotal: number;
};

export const GuideContext = React.createContext<GuideConfig | null>(null);

// 장면 컴포지션은 Root.tsx 의 withConfig 로, 본편은 createGuideVideo 로 감싸야 오디오 경로·자막을 안다.
export const useGuideConfig = () => {
  const config = useContext(GuideContext);
  if (!config) throw new Error("GuideScene must be rendered inside GuideContext.Provider");
  return config;
};
