import { createGuideVideo } from "../guide/GuideVideo";
import type { GuideConfig } from "../guide/GuideContext";
import { SETUP_CHECK_SCENES } from "./scenes";
import { captionsFor } from "./timing";
import type { SetupCheckSceneId } from "./narration";

export const SETUP_CHECK_CONFIG: GuideConfig = {
  audioDir: "narration/setup-check",
  captionsFor: (id) => captionsFor(id as SetupCheckSceneId),
  stepTotal: 1,
};

export const SetupCheckVideo = createGuideVideo(SETUP_CHECK_SCENES, SETUP_CHECK_CONFIG);
