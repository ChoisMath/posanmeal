import { createGuideVideo } from "../guide/GuideVideo";
import type { GuideConfig } from "../guide/GuideContext";
import { TEACHER_SCENES } from "./scenes";
import { captionsFor } from "./timing";
import type { TeacherSceneId } from "./narration";

export const TEACHER_CONFIG: GuideConfig = {
  audioDir: "narration/teacher",
  captionsFor: (id) => captionsFor(id as TeacherSceneId),
  stepTotal: TEACHER_SCENES.length,
};
export const TeacherGuideVideo = createGuideVideo(
  TEACHER_SCENES,
  TEACHER_CONFIG,
);
