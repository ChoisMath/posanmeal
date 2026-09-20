import "./index.css";
import React from "react";
import { Composition, Folder } from "remotion";
import { defaultDemoProps, demoPropsSchema, type DemoProps } from "./props";
import { totalFrames, type SceneDef } from "./scenes";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { GuideContext, type GuideConfig } from "./guide/GuideContext";
import { SETUP_CHECK_CONFIG, SetupCheckVideo } from "./setup-check/SetupCheckVideo";
import { SETUP_CHECK_SCENES } from "./setup-check/scenes";
// 단일 장면 컴포지션도 본편과 같은 오디오 경로·자막 설정으로 감싼다.
const withConfig = (Component: React.FC<DemoProps>, config: GuideConfig): React.FC<DemoProps> => {
  const Wrapped: React.FC<DemoProps> = (props) => (
    <GuideContext.Provider value={config}>
      <Component {...props} />
    </GuideContext.Provider>
  );
  Wrapped.displayName = `WithConfig(${Component.displayName ?? Component.name})`;
  return Wrapped;
};

const SceneCompositions: React.FC<{ scenes: SceneDef[]; prefix: string; config: GuideConfig }> = ({ scenes, prefix, config }) => (
  <>
    {scenes.map((scene) => (
      <Composition
        key={scene.id}
        id={`${prefix}-${scene.id}`}
        component={withConfig(scene.component, config)}
        durationInFrames={scene.durationInFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        schema={demoPropsSchema}
        defaultProps={defaultDemoProps}
      />
    ))}
  </>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="SetupCheck"
      component={SetupCheckVideo}
      durationInFrames={totalFrames(SETUP_CHECK_SCENES)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      schema={demoPropsSchema}
      defaultProps={defaultDemoProps}
    />
    <Folder name="SetupCheck">
      <SceneCompositions scenes={SETUP_CHECK_SCENES} prefix="SetupCheck" config={SETUP_CHECK_CONFIG} />
    </Folder>
  </>
);
