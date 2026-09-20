import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve("out");
await mkdir(out, { recursive: true });
const bundled = resolve(out, ".teacher-timeline.mjs");
await build({
  stdin: { contents: 'export {NARRATION} from "./src/teacher/narration"; export {sceneFrames,captionsFor,lineAt} from "./src/teacher/timing"; export {FPS} from "./src/theme"; export {TRANSITION_FRAMES} from "./src/scenes";', resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: bundled,
});
const { NARRATION, sceneFrames, captionsFor, lineAt, FPS, TRANSITION_FRAMES } = await import(pathToFileURL(bundled).href);
const titles = {
  Intro: "교사 및 담임교사 사용 안내", Address: "접속 주소", AndroidInstall: "안드로이드 앱 설치", IphoneInstall: "아이폰 앱 설치", Login: "등록 계정 로그인", Tabs: "교사와 담임 메뉴", Qr: "개인정산과 근무", History: "본인 체크인 기록", Students: "학급 월별 체크인", Print: "학생 선택과 QR출력", Applications: "우리 반 신청자와 신청시간", Profile: "개인정보와 얼굴등록", Face: "얼굴 체크인 본인 확인", Closing: "물음표 도움말",
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
  const previewLine = { Closing: 1, AndroidInstall: 2, IphoneInstall: 4, Qr: 2, Print: 2 }[scene.id] ?? Math.min(1, scene.lines.length - 1);
  const previewRatio = scene.id === "IphoneInstall" ? 0.72 : 0.5;
  chapters.push({ id: scene.id, title: titles[scene.id], startFrame: offset, durationFrames: duration, previewFrame: offset + lineAt(scene.id, previewLine, previewRatio) });
  for (const caption of captionsFor(scene.id)) captions.push({ start: (offset + caption.from) / FPS, end: (offset + caption.from + caption.durationInFrames) / FPS, text: caption.text });
  offset += duration - (index < NARRATION.length - 1 ? TRANSITION_FRAMES : 0);
}
await writeFile(resolve(out, "PosanMeal-teacher-guide.srt"), captions.map((c, i) => `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${c.text}\n`).join("\n"));
await writeFile(resolve(out, "teacher-chapters.ffmetadata"), ";FFMETADATA1\ntitle=PosanMeal 교사 · 담임교사 이용 안내\n" + chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/${FPS}\nSTART=${c.startFrame}\nEND=${chapters[i + 1]?.startFrame ?? offset}\ntitle=${c.title}\n`).join(""));
await writeFile(resolve(out, "teacher-timeline.json"), JSON.stringify({ fps: FPS, totalFrames: offset, duration: offset / FPS, chapters, captions }, null, 2));
await writeFile(resolve(out, "PosanMeal-teacher-guide-chapters.txt"), chapters.map((c) => `${stamp(c.startFrame / FPS).slice(0, 8)} ${c.title}`).join("\n") + "\n");
console.log(`${chapters.length} scenes, ${captions.length} captions, ${offset} frames, ${(offset / FPS).toFixed(3)} seconds`);

await writeFile(resolve(out, "teacher-guide.vtt"), "WEBVTT\n\n" + captions.map(c => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim()}\n`).join("\n"));
