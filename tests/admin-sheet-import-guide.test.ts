import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");

assert.match(
  pageSource,
  /시트 헤더 안내/,
  "Sheet import dialog should explain the required header row.",
);

assert.match(
  pageSource,
  /학생[\s\S]*email[\s\S]*grade[\s\S]*classNum[\s\S]*number[\s\S]*name/,
  "Student sheet guide should list required columns in import order.",
);

assert.match(
  pageSource,
  /교사[\s\S]*email[\s\S]*subject[\s\S]*homeroom[\s\S]*position[\s\S]*name/,
  "Teacher sheet guide should list required columns in import order.",
);
