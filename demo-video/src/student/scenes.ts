import { Intro } from "./scenes/Intro";
import { Address } from "./scenes/Address";
import { AndroidInstall } from "./scenes/AndroidInstall";
import { IphoneInstall } from "./scenes/IphoneInstall";
import { Login } from "./scenes/Login";
import { Recovery } from "./scenes/Recovery";
import { Tabs } from "./scenes/Tabs";
import { Menu } from "./scenes/Menu";
import { Apply } from "./scenes/Apply";
import { Sign } from "./scenes/Sign";
import { Manage } from "./scenes/Manage";
import { Qr } from "./scenes/Qr";
import { Print } from "./scenes/Print";
import { FaceOption } from "./scenes/FaceOption";
import { Enroll } from "./scenes/Enroll";
import { Kiosk } from "./scenes/Kiosk";
import { History } from "./scenes/History";
import { Closing } from "./scenes/Closing";
import { sceneFrames } from "./timing";
import type { SceneDef } from "../scenes";
import type { StudentSceneId } from "./narration";

const COMPONENTS = { Intro, Address, AndroidInstall, IphoneInstall, Login, Recovery, Tabs, Menu, Apply, Sign, Manage, Qr, Print, FaceOption, Enroll, Kiosk, History, Closing };
export const STUDENT_SCENES: SceneDef[] = Object.entries(COMPONENTS).map(([id, component]) => ({
  id, component, durationInFrames: sceneFrames(id as StudentSceneId),
}));
