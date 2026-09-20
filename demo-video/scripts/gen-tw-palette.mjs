// 앱(저장소 루트)의 Tailwind 테마에서 색 변수를 읽어 목업용 tw.ts 를 만든다. 앱과 같은 버전·같은 oklch 값을 쓰기 위함.
// 사용: node scripts/gen-tw-palette.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const themeCss = join(ROOT, "..", "node_modules", "tailwindcss", "theme.css");
const version = JSON.parse(readFileSync(join(ROOT, "..", "node_modules", "tailwindcss", "package.json"), "utf8")).version;
const css = readFileSync(themeCss, "utf8");

const palette = {};
for (const [, family, shade, value] of css.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
  (palette[family] ??= {})[shade] = value.trim();
}
const black = css.match(/--color-black:\s*([^;]+);/)?.[1].trim() ?? "#000";
const white = css.match(/--color-white:\s*([^;]+);/)?.[1].trim() ?? "#fff";

const body = Object.entries(palette)
  .map(([family, shades]) => `  ${family}: {\n${Object.entries(shades).map(([s, v]) => `    ${s}: "${v}",`).join("\n")}\n  },`)
  .join("\n");
mkdirSync(join(ROOT, "src", "app-mocks"), { recursive: true });
writeFileSync(
  join(ROOT, "src", "app-mocks", "tw.ts"),
  `// 생성 파일 — node scripts/gen-tw-palette.mjs (앱 tailwindcss ${version} theme.css). 직접 고치지 말 것.\nexport const tw = {\n${body}\n  black: "${black}",\n  white: "${white}",\n} as const;\n`,
);
console.log(`tw.ts: ${Object.keys(palette).length} families (tailwindcss ${version})`);
