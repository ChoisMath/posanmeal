// 사용: node scripts/frame-at.mjs <guide> <SceneId> <line> <ratio>   예: node scripts/frame-at.mjs setup-check Check 1 0.6
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [guide, scene, line, ratio] = process.argv.slice(2);
if (!guide || !scene || line === undefined || ratio === undefined) {
  throw new Error("usage: node scripts/frame-at.mjs <guide> <SceneId> <line> <ratio>");
}
const outDir = join(ROOT, "out", "frame-at");
mkdirSync(outDir, { recursive: true });
const bundled = join(outDir, `${guide}-${process.pid}.timing.mjs`);
execFileSync(join(ROOT, "node_modules", ".bin", "esbuild"), [join(ROOT, "src", guide, "timing.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundled}`, "--log-level=error"]);
const { lineAt, sceneFrames } = await import(bundled);
console.log(`frame ${lineAt(scene, Number(line), Number(ratio))} / scene ${sceneFrames(scene)}`);
