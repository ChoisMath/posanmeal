import React from "react";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { TRANSITION_FRAMES, type SceneDef } from "../scenes";
import { GuideContext, type GuideConfig } from "./GuideContext";
import type { DemoProps } from "../props";

export const createGuideVideo = (scenes: SceneDef[], config: GuideConfig): React.FC<DemoProps> => {
  const Video: React.FC<DemoProps> = (props) => (
    <GuideContext.Provider value={config}>
      <TransitionSeries>
        {scenes.flatMap((scene, index) => {
          const Scene = scene.component;
          const sequence = (
            <TransitionSeries.Sequence key={scene.id} durationInFrames={scene.durationInFrames} name={scene.id}>
              <Scene {...props} />
            </TransitionSeries.Sequence>
          );
          if (index === 0) return [sequence];
          return [
            <TransitionSeries.Transition
              key={`${scene.id}-t`}
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />,
            sequence,
          ];
        })}
      </TransitionSeries>
    </GuideContext.Provider>
  );
  return Video;
};
