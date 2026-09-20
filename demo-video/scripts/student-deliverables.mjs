import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve("out");
await mkdir(out, { recursive: true });
const bundled = resolve(out, ".student-timeline.mjs");
await build({
  stdin: { contents: 'export {NARRATION} from "./src/student/narration"; export {sceneFrames,captionsFor,lineAt} from "./src/student/timing"; export {FPS} from "./src/theme"; export {TRANSITION_FRAMES} from "./src/scenes";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: bundled,
});
const { NARRATION, sceneFrames, captionsFor, lineAt, FPS, TRANSITION_FRAMES } = await import(pathToFileURL(bundled).href);
const titles = {
  AndroidInstall: "안드로이드 Chrome에서 앱 설치", IphoneInstall: "아이폰 Safari에서 홈 화면에 추가",
  Intro: "포산밀 학생 사용안내", Address: "접속 주소 meal.posan.kr", Login: "등록된 계정으로 로그인", Recovery: "잘못 로그인했을 때", Tabs: "학생 메뉴와 신청 탭", Menu: "식단 확인", Apply: "공고 신청과 식사 선택", Sign: "서명과 제출 확인", Manage: "신청 수정과 취소", Qr: "QR 사용과 보안", Print: "담임 선생님께 QR 인쇄 요청", FaceOption: "휴대가 어렵다면 얼굴 인식 베타", Enroll: "얼굴 등록과 선택 동의", Kiosk: "얼굴 체크인과 본인 확인", History: "체크인 기록 확인", Closing: "핵심 정리와 물음표 도움말",
};
const stamp = (seconds, srt = false) => {
  const ms = Math.round(seconds * 1000);
  const base = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return `${base}${srt ? "," : "."}${String(ms % 1000).padStart(3, "0")}`;
};
let offset = 0;
const chapters = [];
const captions = [];
for (const [index, scene] of NARRATION.entries()) {
  const duration = sceneFrames(scene.id);
  const previewLine = { Closing: 3, AndroidInstall: 2, IphoneInstall: 4 }[scene.id] ?? Math.min(1, scene.lines.length - 1);
  const previewRatio = scene.id === "IphoneInstall" ? 0.72 : 0.5;
  chapters.push({ id: scene.id, title: titles[scene.id], startFrame: offset, durationFrames: duration, previewFrame: offset + lineAt(scene.id, previewLine, previewRatio) });
  for (const caption of captionsFor(scene.id)) captions.push({ start: (offset + caption.from) / FPS, end: (offset + caption.from + caption.durationInFrames) / FPS, text: caption.text });
  offset += duration - (index < NARRATION.length - 1 ? TRANSITION_FRAMES : 0);
}
await writeFile(resolve(out, "PosanMeal-student-guide.srt"), captions.map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${c.text}\n`).join("\n"));
await writeFile(resolve(out, "student-chapters.ffmetadata"), ";FFMETADATA1\ntitle=PosanMeal 학생 이용 안내\n" + chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/${FPS}\nSTART=${c.startFrame}\nEND=${chapters[i + 1]?.startFrame ?? offset}\ntitle=${c.title}\n`).join(""));
await writeFile(resolve(out, "student-timeline.json"), JSON.stringify({ fps: FPS, totalFrames: offset, duration: offset / FPS, chapters, captions }, null, 2));
await writeFile(resolve(out, "PosanMeal-student-guide-chapters.txt"), chapters.map((c) => `${stamp(c.startFrame / FPS).slice(0, 8)} ${c.title}`).join("\n") + "\n");
console.log(`${chapters.length} scenes, ${captions.length} captions, ${offset} frames, ${(offset / FPS).toFixed(3)} seconds`);
