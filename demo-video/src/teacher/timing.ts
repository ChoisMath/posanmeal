import durations from "./narration-durations.json";
import { createTiming, type SceneDurations } from "../guide/timing";
import { LINE_GAP_SECONDS, NARRATION, type TeacherSceneId } from "./narration";

export const {
  sceneFrames,
  lineStart,
  lineFrames,
  lineEnd,
  lineAt,
  captionsFor,
} = createTiming(
  NARRATION,
  durations as Record<TeacherSceneId, SceneDurations>,
  LINE_GAP_SECONDS,
);
