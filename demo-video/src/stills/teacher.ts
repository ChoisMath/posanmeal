import { NARRATION } from "../teacher/narration";
import { lineAt } from "../teacher/timing";
export const DEFAULT_CROP = { x: 0, y: 0, w: 1920, h: 1080 };
export const STILLS = NARRATION.map((scene) => ({
  composition: `Teacher-${scene.id}`,
  file: scene.id,
  frame:
    scene.id === "Intro"
      ? 30
      : lineAt(
          scene.id,
          scene.id === "Print" || scene.id === "Qr"
            ? 2
            : scene.id === "IphoneInstall"
              ? 4
              : Math.min(1, scene.lines.length - 1),
          0.7,
        ),
  resize: 1280,
}));
