import { lineAt } from "../student/timing";
import { PHONE_POSITION } from "../student/style";

export const DEFAULT_CROP = { x: PHONE_POSITION.x, y: PHONE_POSITION.y, w: 414, h: 868 };
export const STILLS = [
  { composition: "Student-Intro", file: "00-intro", frame: 12, crop: { x: 0, y: 0, w: 1920, h: 1080 } },
  { composition: "Student-Address", file: "01-address", frame: lineAt("Address", 1, 0.6), crop: { x: 100, y: 175, w: 1650, h: 700 } },
  { composition: "Student-AndroidInstall", file: "01a-android-menu", frame: lineAt("AndroidInstall", 2, 0.2), crop: { x: 90, y: 175, w: 1740, h: 700 } },
  { composition: "Student-AndroidInstall", file: "01b-android-install", frame: lineAt("AndroidInstall", 4, 0.4), resize: 640 },
  { composition: "Student-IphoneInstall", file: "01c-iphone-share", frame: lineAt("IphoneInstall", 2, 0.5), resize: 640 },
  { composition: "Student-IphoneInstall", file: "01d-iphone-add", frame: lineAt("IphoneInstall", 4, 0.72), resize: 640 },
  { composition: "Student-Login", file: "02-login", frame: lineAt("Login", 0, 0.6), resize: 640 },
  { composition: "Student-Recovery", file: "03-recovery", frame: lineAt("Recovery", 2, 0.5), crop: { x: 100, y: 175, w: 1650, h: 700 } },
  { composition: "Student-Menu", file: "04-menu", frame: lineAt("Menu", 0, 0.5), resize: 640 },
  { composition: "Student-Apply", file: "05-apply", frame: lineAt("Apply", 1, 0.5), resize: 640 },
  { composition: "Student-Sign", file: "06-sign", frame: lineAt("Sign", 0, 0.5), resize: 640 },
  { composition: "Student-Manage", file: "07-manage", frame: lineAt("Manage", 1, 0.5), resize: 640 },
  { composition: "Student-Qr", file: "08-qr", frame: lineAt("Qr", 3, 0.5), resize: 640 },
  { composition: "Student-Print", file: "09-print", frame: lineAt("Print", 1, 0.5), crop: { x: 100, y: 175, w: 1650, h: 700 } },
  { composition: "Student-FaceOption", file: "09b-face-option", frame: lineAt("FaceOption", 1, 0.5), crop: { x: 90, y: 175, w: 1740, h: 700 } },
  { composition: "Student-Enroll", file: "10-consent", frame: lineAt("Enroll", 1, 0.5), resize: 640 },
  { composition: "Student-Kiosk", file: "11-confirm", frame: lineAt("Kiosk", 3, 0.45), crop: { x: 675, y: 303, w: 1116, h: 636 } },
  { composition: "Student-History", file: "12-history", frame: lineAt("History", 1, 0.5), resize: 640 },
  { composition: "Student-Closing", file: "13-help", frame: lineAt("Closing", 3, 0.5), crop: { x: 90, y: 180, w: 1740, h: 700 } },
];
