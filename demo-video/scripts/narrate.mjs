// 사용: node scripts/narrate.mjs --guide <GUIDES 키>
//         [--measure] [--only Slug-4,Seats-2] [--estimate] [--no-check]
//   engine "say": macOS say 로 문장 mp3 생성 (현재 사용하는 가이드 없음)
//   engine "mlx": 로컬 Qwen3-TTS 클론 음성 — 환경·동작은 demo-video/README.md 「음성」 절
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audioEndingFilter, checkEnding, checkSpeech, estimateSeconds, findUnreadable, isCached, lineKey, mergeStt, parseJsonLines, parseOnly, reviewFlag,
  sha1, spokenText, sttTargets, unknownKeys,
} from "./lib/narration-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUIDES = {
  student: { module: "src/student/narration.ts", outDir: "public/narration/student", json: "src/student/narration-durations.json", engine: "mlx" },
  "setup-check": { module: "src/setup-check/narration.ts", outDir: "public/narration/setup-check", json: "src/setup-check/narration-durations.json", engine: "mlx" },
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(name);

const guideName = arg("--guide");
const guide = GUIDES[guideName];
if (!guide) throw new Error(`unknown guide: ${guideName} (가능: ${Object.keys(GUIDES).join(", ")})`);
const {
  NARRATION, LINE_GAP_SECONDS, SPOKEN = {}, TRAILING_SILENCE_SECONDS = 1, FADE_OUT_SECONDS = 0.35,
} = await import(join(ROOT, guide.module));

const OUT_DIR = join(ROOT, guide.outDir);
const TMP_DIR = join(OUT_DIR, ".lines");
const RAW_DIR = join(TMP_DIR, "raw");
const JSON_PATH = join(ROOT, guide.json);
const only = parseOnly(arg("--only"));
const unknownOnly = unknownKeys(only, NARRATION);
if (unknownOnly.length > 0) {
  console.error(`--only 에 없는 문장 키: ${unknownOnly.join(", ")}`);
  process.exit(1);
}
if (only && guide.engine === "say") console.log("--only 는 say 엔진에서 무시됩니다 (전체 문장을 다시 만듭니다).");
mkdirSync(TMP_DIR, { recursive: true });

const probe = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const lineMp3 = (key) => join(TMP_DIR, `${key}.mp3`);
const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

// ---- say ----
const VOICE = process.env.NARRATION_VOICE ?? "Yuna";
const RATE = process.env.NARRATION_RATE ?? "175";
const synthesizeSay = () => {
  for (const scene of NARRATION) {
    scene.lines.forEach((text, index) => {
      const aiff = join(TMP_DIR, `${lineKey(scene.id, index)}.aiff`);
      execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", aiff, text]);
      trimAndPad(lineKey(scene.id, index), aiff);
      rmSync(aiff);
    });
  }
};

// ---- mlx ----
const TTS_PYTHON = process.env.TTS_PYTHON ?? join(ROOT, ".venv-tts", "bin", "python");
const TTS_MODEL = process.env.TTS_MODEL ?? "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16";
const TTS_PROFILE = process.env.TTS_PROFILE ?? "Chois";
const VOICEBOX_DB = process.env.VOICEBOX_DB ?? join(homedir(), "Library/Application Support/sh.voicebox.app/voicebox.db");
const STT_CACHE = process.env.HF_HUB_CACHE ?? "/Volumes/Chois_SD2/dev/hf-cache";
const MAX_ROUNDS = 3;
const MANIFEST = join(TMP_DIR, "manifest.json");
// 앞머리는 -40dB: Qwen3-TTS 가 첫 음절 앞에 -44~-50dB 잡음을 내는 문장이 많아 -45dB 로는 트림이 일찍 멈추고
// 음성이 자막보다 늦게 시작할 수 있다.
const LEADING_TRIM = "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05";
// 뒤 무음 제거는 길이 측정에만 사용한다. 출력 원음까지 자르면 약한 끝음절과 잔향을 잃는다.
const MEASURE_END = "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse";
const AUDIO_PROCESSING = sha1(JSON.stringify({
  version: "preserve-tail-hold-fade-v1", leading: LEADING_TRIM, measureEnd: MEASURE_END, curve: "hsin",
  generator: sha1(readFileSync(join(ROOT, "scripts/tts_mlx.py"), "utf8")),
}));

const runPython = (script, args, env = {}) => {
  // HF_HUB_CACHE 는 STT 캐시 전용(writeReview 가 명시적으로 넘긴다). 셸에서 export 된 값이 TTS 워커로 새면
  // HF_HUB_OFFLINE=1 이라 HF 기본 캐시에 있는 Qwen3-TTS 모델을 못 찾는다.
  const { HF_HUB_CACHE: _sttOnly, ...inherited } = process.env;
  const result = spawnSync(TTS_PYTHON, [join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...inherited, HF_HUB_OFFLINE: "1", ...env },
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${script} exited with ${result.status}`);
  return parseJsonLines(result.stdout);
};

const trimAndPad = (key, input = join(RAW_DIR, `${key}.wav`)) => {
  const leading = join(TMP_DIR, `${key}.leading.wav`);
  const measured = join(TMP_DIR, `${key}.measure.wav`);
  try {
    ffmpeg(["-i", input, "-af", LEADING_TRIM, leading]);
    ffmpeg(["-i", leading, "-af", MEASURE_END, measured]);
    const speech = probe(measured);
    ffmpeg([
      "-i", leading, "-af", audioEndingFilter(speech, TRAILING_SILENCE_SECONDS, FADE_OUT_SECONDS),
      "-ar", "44100", "-ac", "1", "-b:a", "128k", lineMp3(key),
    ]);
    return speech;
  } finally {
    rmSync(leading, { force: true });
    rmSync(measured, { force: true });
  }
};

const measureRawEnding = (key) => {
  const pcm = execFileSync("ffmpeg", [
    "-v", "error", "-sseof", "-0.02", "-i", join(RAW_DIR, `${key}.wav`), "-ac", "1", "-f", "f32le", "-",
  ]);
  if (!pcm.length) throw new Error(`empty narration ending: ${key}`);
  let energy = 0;
  for (let offset = 0; offset < pcm.length; offset += 4) energy += pcm.readFloatLE(offset) ** 2;
  return 20 * Math.log10(Math.max(Math.sqrt(energy / (pcm.length / 4)), 1e-10));
};

const synthesizeMlx = () => {
  const unreadable = findUnreadable(NARRATION, SPOKEN);
  if (unreadable.length > 0) {
    console.error(`음성용 문장에 숫자·영문이 남아 있습니다 (SPOKEN 에 읽기를 추가하세요): ${unreadable.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(RAW_DIR, { recursive: true });
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const [{ refHash }] = runPython("tts_mlx.py", ["--ref-hash", TTS_PROFILE, VOICEBOX_DB]);
  const lines = NARRATION.flatMap((scene) =>
    scene.lines.map((line, index) => {
      const text = spokenText(SPOKEN, scene.id, index, line);
      return { key: lineKey(scene.id, index), text, textHash: sha1(text) };
    }),
  );
  let pending = lines.filter((l) => {
    const cached = isCached(manifest[l.key], {
        textHash: l.textHash, refHash, model: TTS_MODEL,
        trailing: TRAILING_SILENCE_SECONDS, fade: FADE_OUT_SECONDS, processing: AUDIO_PROCESSING,
      }, existsSync(lineMp3(l.key)));
    if (cached && manifest[l.key].endingRmsDb === undefined && existsSync(join(RAW_DIR, `${l.key}.wav`))) {
      manifest[l.key].endingRmsDb = measureRawEnding(l.key);
    }
    return only?.has(l.key) || !cached || !checkEnding(manifest[l.key].endingRmsDb);
  });
  for (let round = 1; round <= MAX_ROUNDS && pending.length > 0; round += 1) {
    console.log(`생성 ${round}라운드: ${pending.length}문장`);
    const jobPath = join(TMP_DIR, "job.json");
    writeFileSync(jobPath, JSON.stringify({
      profile: TTS_PROFILE, db: VOICEBOX_DB, model: TTS_MODEL,
      jobs: pending.map((l) => ({ key: l.key, text: l.text, out: join(RAW_DIR, `${l.key}.wav`) })),
    }));
    runPython("tts_mlx.py", [jobPath]);
    const failed = [];
    for (const l of pending) {
      const speech = trimAndPad(l.key);
      const verdict = checkSpeech(l.text, speech);
      const endingRmsDb = measureRawEnding(l.key);
      if (verdict.ok && checkEnding(endingRmsDb)) {
        manifest[l.key] = {
          textHash: l.textHash, refHash, model: TTS_MODEL,
          trailing: TRAILING_SILENCE_SECONDS, fade: FADE_OUT_SECONDS, processing: AUDIO_PROCESSING,
          speech: Number(speech.toFixed(3)), cps: Number(verdict.cps.toFixed(2)), attempts: round,
          endingRmsDb,
        };
        console.log(`  ${l.key.padEnd(16)} ${speech.toFixed(2)}s ${verdict.cps.toFixed(1)}자/초, 말끝 ${endingRmsDb.toFixed(1)}dB`);
      } else {
        renameSync(join(RAW_DIR, `${l.key}.wav`), join(RAW_DIR, `${l.key}.fail-${round}.wav`));
        rmSync(lineMp3(l.key), { force: true });
        failed.push(l);
        console.log(`  ${l.key.padEnd(16)} 실패 ${verdict.ok ? "abrupt-ending" : verdict.reason} (${speech.toFixed(2)}s, 말끝 ${endingRmsDb.toFixed(1)}dB)`);
      }
    }
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    pending = failed;
  }
  if (pending.length > 0) {
    console.error(`${MAX_ROUNDS}라운드 뒤에도 검증 실패: ${pending.map((l) => l.key).join(", ")}`);
    process.exit(1);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return { lines, manifest };
};

const rawWav = (key) => join(RAW_DIR, `${key}.wav`);

const writeReview = ({ lines, manifest }) => {
  const targets = flag("--no-check") ? [] : sttTargets(lines, manifest, (key) => existsSync(rawWav(key)));
  if (targets.length > 0) {
    console.log(`전사 검수: ${targets.length}문장`);
    const itemsPath = join(TMP_DIR, "stt.json");
    writeFileSync(itemsPath, JSON.stringify(targets.map((l) => ({ key: l.key, wav: rawWav(l.key), expected: l.text }))));
    mergeStt(manifest, runPython("stt_check.py", [itemsPath], { HF_HUB_CACHE: STT_CACHE }));
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const header = ["flag", "key", "speech", "cps", "attempts", "ending_rms_db", "similarity", "spoken", "transcript"].join("\t");
  const rows = lines.map((l) => {
    const m = manifest[l.key] ?? {};
    return [reviewFlag(m), l.key, m.speech, m.cps, m.attempts, m.endingRmsDb?.toFixed(1) ?? "", m.similarity ?? "", l.text, m.transcript ?? ""].join("\t");
  });
  writeFileSync(join(OUT_DIR, "review.tsv"), `${[header, ...rows].join("\n")}\n`);
  const count = (mark) => rows.filter((row) => row.startsWith(`${mark}\t`)).length;
  console.log(`review.tsv: ${rows.length}문장, CHECK ${count("CHECK")}, NOCHECK ${count("NOCHECK")}`);
};

// ---- 공통 ----
const concatScene = (scene) => {
  const silence = join(TMP_DIR, `gap-${LINE_GAP_SECONDS}.mp3`);
  if (!existsSync(silence)) {
    ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(LINE_GAP_SECONDS), "-b:a", "128k", silence]);
  }
  const entries = scene.lines.flatMap((_, index) => {
    const file = [`file '${lineMp3(lineKey(scene.id, index))}'`];
    return index < scene.lines.length - 1 ? [...file, `file '${silence}'`] : file;
  });
  const list = join(TMP_DIR, `${scene.id}.txt`);
  writeFileSync(list, entries.join("\n"));
  // concat 입력을 libmp3lame 에 바로 물리면 ffmpeg 8.x 가 장면에 따라
  // "inadequate AVFrame plane padding" 으로 죽을 수 있다. PCM 을 한 번
  // 거치면 그 경로를 타지 않는다. 스트림 복사(-c:a copy)는 세그먼트마다 인코더 패딩이 남아
  // 장면 끝에서 자막이 0.45초까지 밀리므로 쓰지 않는다 — wav 경유는 길이가 밀리초까지 맞는다.
  const pcm = join(TMP_DIR, `${scene.id}.wav`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1", pcm]);
  ffmpeg(["-i", pcm, "-c:a", "libmp3lame", "-b:a", "128k", join(OUT_DIR, `${scene.id}.mp3`)]);
  rmSync(pcm);
};

const writeDurations = (measureLine, measureTotal) => {
  const durations = {};
  for (const scene of NARRATION) {
    const lines = scene.lines.map((line, index) => measureLine(scene, index, line));
    const total = measureTotal(scene, lines);
    durations[scene.id] = { total, lines };
    console.log(`${scene.id.padEnd(16)} ${total.toFixed(1)}s  (${lines.map((s) => s.toFixed(1)).join(" / ")})`);
  }
  writeFileSync(JSON_PATH, `${JSON.stringify(durations, null, 2)}\n`);
  console.log(`총 ${Object.values(durations).reduce((sum, d) => sum + d.total, 0).toFixed(1)}s → ${JSON_PATH}`);
};

if (flag("--estimate")) {
  writeDurations(
    (scene, index, line) => estimateSeconds(spokenText(SPOKEN, scene.id, index, line), TRAILING_SILENCE_SECONDS, FADE_OUT_SECONDS),
    (_, lines) => Number((lines.reduce((sum, s) => sum + s, 0) + LINE_GAP_SECONDS * (lines.length - 1)).toFixed(3)),
  );
  process.exit(0);
}

let report = null;
if (!flag("--measure")) {
  if (guide.engine === "mlx") report = synthesizeMlx();
  else synthesizeSay();
  NARRATION.forEach(concatScene);
}
writeDurations(
  (scene, index) => Number(probe(lineMp3(lineKey(scene.id, index))).toFixed(3)),
  (scene) => Number(probe(join(OUT_DIR, `${scene.id}.mp3`)).toFixed(3)),
);
if (report) writeReview(report);
