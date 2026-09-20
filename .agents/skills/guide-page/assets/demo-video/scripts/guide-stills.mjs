// 사용: node scripts/guide-stills.mjs --page <page> [--only 03-add-drag] [--scale 2 --max-kb 400] [--out ../public/guide]
//   src/stills/<page>.ts 의 목록대로 장면 컴포지션 프레임을 PNG로 렌더하고,
//   브라우저 프레임 영역만 잘라 1280px 폭 WebP로 <out>/<page>/ 에 저장한다(기본: Next.js public/guide/<page>/).
//   더 큰 폭으로 쓰일 목업은 2배(--scale 2)로 렌더해야 축소 없이 선명하다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const page = arg("--page", null);
if (!page) throw new Error("--page is required");
const only = arg("--only", null);
const outRoot = resolve(ROOT, arg("--out", "../public/guide"));
const scale = Number(arg("--scale", "1"));
const MAX_BYTES = Number(arg("--max-kb", "150")) * 1024;
const WIDTH = 1280;
const QUALITY = "82";

const listSource = join(ROOT, "src", "stills", `${page}.ts`);
if (!existsSync(listSource)) throw new Error(`stills list missing: ${listSource}`);

// timing.ts 가 JSON 을 속성 없이 import 하므로 Node 의 타입 스트리핑 대신 esbuild 로 번들해 읽는다.
const pngDir = join(ROOT, "out", "guide-stills", page);
mkdirSync(pngDir, { recursive: true });
const bundled = join(pngDir, `.${page}.list.mjs`);
execFileSync(join(ROOT, "node_modules", ".bin", "esbuild"), [listSource, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundled}`], { stdio: "inherit" });
const { STILLS, DEFAULT_CROP } = await import(bundled);

const outDir = join(outRoot, page);
mkdirSync(outDir, { recursive: true });

const targets = STILLS.filter((s) => !only || s.file === only);
if (targets.length === 0) throw new Error(`no still named ${only}`);

for (const still of targets) {
  const png = join(pngDir, `${still.file}.png`);
  const webp = join(outDir, `${still.file}.webp`);
  const base = still.crop ?? DEFAULT_CROP;
  const crop = { x: base.x * scale, y: base.y * scale, w: base.w * scale, h: base.h * scale };
  const width = still.resize ?? WIDTH;
  execFileSync("npx", ["remotion", "still", still.composition, png, "--frame", String(still.frame), "--scale", String(scale)], { cwd: ROOT, stdio: "inherit" });
  execFileSync("cwebp", ["-quiet", "-q", QUALITY, "-crop", String(crop.x), String(crop.y), String(crop.w), String(crop.h), "-resize", String(width), "0", png, "-o", webp]);
  const bytes = statSync(webp).size;
  const flag = bytes > MAX_BYTES ? `  ← ${Math.round(MAX_BYTES / 1024)}KB 초과, 품질을 낮추거나 장면을 단순화할 것` : "";
  console.log(`${still.file}.webp  ${Math.round(bytes / 1024)}KB  (${still.composition} @${still.frame})${flag}`);
}
