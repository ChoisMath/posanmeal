import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FONT } from "../fonts";
import { SCENE_BACKGROUND } from "../theme";
import { StepBadge } from "../components/StepBadge";
import { GuideCaption } from "./GuideCaption";
import { LEAD_FRAMES } from "./timing";
import { useGuideConfig } from "./GuideContext";

export const GuideScene: React.FC<{
  id: string;
  step?: number;
  label?: string;
  children: React.ReactNode;
}> = ({ id, step, label, children }) => {
  const { audioDir, captionsFor, stepTotal } = useGuideConfig();
  return (
    <AbsoluteFill style={{ background: SCENE_BACKGROUND, fontFamily: FONT }}>
      {children}
      {step !== undefined && label ? <StepBadge step={step} total={stepTotal} label={label} /> : null}
      <Sequence from={LEAD_FRAMES} layout="none" name={`narration-${id}`}>
        <Audio src={staticFile(`${audioDir}/${id}.mp3`)} />
      </Sequence>
      {captionsFor(id).map((c) => (
        <GuideCaption key={c.from} from={c.from} durationInFrames={c.durationInFrames} text={c.text} />
      ))}
    </AbsoluteFill>
  );
};
