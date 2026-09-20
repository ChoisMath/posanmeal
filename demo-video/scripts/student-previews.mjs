import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve("out");
const video = resolve(out, "PosanMeal-student-guide.mp4");
const timeline = JSON.parse(await readFile(resolve(out, "student-timeline.json"), "utf8"));
const frameDir = resolve(out, "final-frames");
const stillDir = resolve(out, "guide-stills/student");
await mkdir(frameDir, { recursive: true });
await mkdir(stillDir, { recursive: true });
const extract = (frame, destination) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(frame / timeline.fps), "-i", video, "-frames:v", "1", "-update", "1", destination]);

const previewFiles = [];
for (const [i, chapter] of timeline.chapters.entries()) {
  const destination = resolve(frameDir, `${String(i + 1).padStart(2, "0")}-${chapter.id}.png`);
  extract(chapter.previewFrame, destination);
  previewFiles.push(destination);
}
extract(12, resolve(out, "PosanMeal-student-guide-thumbnail.png"));
const bundled = resolve(out, ".student-stills.mjs");
await build({ entryPoints: ["src/stills/student.ts"], bundle: true, platform: "node", format: "esm", outfile: bundled });
const { STILLS, DEFAULT_CROP } = await import(pathToFileURL(bundled).href);
for (const still of STILLS) {
  const chapter = timeline.chapters.find((c) => `Student-${c.id}` === still.composition);
  const png = resolve(stillDir, `${still.file}.png`);
  extract(chapter.startFrame + still.frame, png);
  const crop = still.crop ?? DEFAULT_CROP;
  execFileSync("cwebp", ["-quiet", "-q", "82", "-crop", String(crop.x), String(crop.y), String(crop.w), String(crop.h), "-resize", String(still.resize ?? 1280), "0", png, "-o", resolve(stillDir, `${still.file}.webp`)]);
}
// 최종 MP4에서 추출해 목업 스틸과 전달 영상의 차이를 막는다.
await writeFile(resolve(out, "preview-manifest.json"), JSON.stringify({ source: video, frames: timeline.chapters.map((c) => c.previewFrame), previewFiles, thumbnail: "PosanMeal-student-guide-thumbnail.png", stills: STILLS.length }, null, 2));
console.log(`Extracted ${timeline.chapters.length} full frames and ${STILLS.length} guide stills from the final MP4.`);
