// 사용: node scripts/doctor.mjs
//   안내 영상 파이프라인(Remotion · mlx-audio Qwen3-TTS 클론 음성 · Whisper 검수 · WebP 스틸)에 필요한 도구와 캐시를 점검한다.
//   경로 기본값은 narrate.mjs 와 같은 환경변수를 따른다.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TTS_PYTHON = process.env.TTS_PYTHON ?? join(ROOT, ".venv-tts", "bin", "python");
const TTS_MODEL = process.env.TTS_MODEL ?? "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16";
const TTS_PROFILE = process.env.TTS_PROFILE ?? "Chois";
const VOICEBOX_DB = process.env.VOICEBOX_DB ?? join(homedir(), "Library/Application Support/sh.voicebox.app/voicebox.db");
// narrate.mjs 는 TTS 워커에서 HF_HUB_CACHE 를 지우므로 TTS 모델은 HF 기본 캐시에서 읽힌다.
const TTS_CACHE = join(process.env.HF_HOME ?? join(homedir(), ".cache/huggingface"), "hub");
const STT_CACHE = process.env.HF_HUB_CACHE ?? "/Volumes/Chois_SD2/dev/hf-cache";
const STT_MODEL = "mlx-community/whisper-large-v3-turbo";
const MLX_AUDIO_VERSION = readFileSync(join(ROOT, "requirements-tts.txt"), "utf8").match(/mlx-audio==([\d.]+)/)?.[1];

const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail });
  } catch (error) {
    results.push({ ok: false, name, detail: error.message });
  }
};
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (r.error) throw new Error(`${cmd} 실행 불가: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → exit ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  return r.stdout.trim();
};
const snapshotDir = (cache, repo) => {
  const base = join(cache, `models--${repo.replace("/", "--")}`, "snapshots");
  if (!existsSync(base)) throw new Error(`캐시 없음: ${base}`);
  const [snapshot] = readdirSync(base);
  if (!snapshot) throw new Error(`스냅샷 없음: ${base}`);
  return join(base, snapshot);
};
const requireFiles = (dir, files) => {
  const missing = files.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) throw new Error(`${dir} 에 없음: ${missing.join(", ")}`);
};

// .ts 타입 스트리핑이 플래그 없이 켜진 버전부터 narrate.mjs 가 원고(.ts)를 직접 import 할 수 있다.
check("node ≥ 22.18 / 23.6 (narrate.mjs 가 .ts 원고를 플래그 없이 import)", () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!(major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18))) throw new Error(`node ${process.versions.node}`);
  return `node ${process.versions.node}`;
});
for (const tool of ["ffmpeg", "ffprobe"]) check(tool, () => run(tool, ["-version"]).split("\n")[0]);
check("cwebp", () => `cwebp ${run("cwebp", ["-version"]).split("\n")[0]}`);
check("npm 의존성 (remotion · esbuild)", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const installed = JSON.parse(readFileSync(join(ROOT, "node_modules/remotion/package.json"), "utf8")).version;
  if (installed !== pkg.dependencies.remotion) throw new Error(`remotion ${installed} ≠ package.json ${pkg.dependencies.remotion} — npm ci`);
  requireFiles(join(ROOT, "node_modules/.bin"), ["remotion", "esbuild"]);
  return `remotion ${installed}`;
});
check(`mlx-audio ${MLX_AUDIO_VERSION} (.venv-tts)`, () => {
  if (!existsSync(TTS_PYTHON)) throw new Error(`${TTS_PYTHON} 없음 — README 「설치 (한 번만)」`);
  const out = run(TTS_PYTHON, ["-c", "import importlib.metadata as m; print(m.version('mlx-audio'), m.version('mlx'))"]);
  const [audio, mlx] = out.split(" ");
  if (audio !== MLX_AUDIO_VERSION) throw new Error(`mlx-audio ${audio} ≠ ${MLX_AUDIO_VERSION}`);
  return `mlx-audio ${audio}, mlx ${mlx}`;
});
check(`TTS 모델 캐시 ${TTS_MODEL}`, () => {
  const dir = snapshotDir(TTS_CACHE, TTS_MODEL);
  requireFiles(dir, ["config.json"]);
  if (!readdirSync(dir).some((f) => f.endsWith(".safetensors"))) throw new Error(`${dir} 에 safetensors 없음`);
  return dir;
});
check(`Voicebox 프로필 "${TTS_PROFILE}" (참조 음성·문장)`, () => {
  if (!existsSync(VOICEBOX_DB)) throw new Error(`${VOICEBOX_DB} 없음`);
  const script = [
    "import sys, json; sys.path.insert(0, sys.argv[1]); import tts_mlx",
    "audio, text = tts_mlx.load_reference(sys.argv[2], sys.argv[3])",
    "print(json.dumps({'audio': str(audio), 'exists': audio.exists(), 'chars': len(text)}))",
  ].join("\n");
  const ref = JSON.parse(run(TTS_PYTHON, ["-c", script, join(ROOT, "scripts"), VOICEBOX_DB, TTS_PROFILE]));
  if (!ref.exists) throw new Error(`참조 음성 파일 없음: ${ref.audio}`);
  if (ref.chars === 0) throw new Error("참조 문장이 비어 있음");
  return `${ref.audio} · 참조 문장 ${ref.chars}자`;
});
check(`검수 STT 캐시 ${STT_MODEL} + openai 토크나이저`, () => {
  const dir = snapshotDir(STT_CACHE, STT_MODEL);
  requireFiles(dir, ["weights.safetensors", "config.json", "tokenizer.json", "vocab.json", "merges.txt", "preprocessor_config.json"]);
  return dir;
});

for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name}\n     ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? `\n모든 점검 통과 (${results.length}항목)` : `\n실패 ${failed}/${results.length}항목`);
process.exit(failed === 0 ? 0 : 1);
