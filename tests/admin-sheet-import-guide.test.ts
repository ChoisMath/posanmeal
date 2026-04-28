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
  /학생.*email.*grade.*classNum.*number.*name/s,
  "Student sheet guide should list required columns in import order.",
);

assert.match(
  pageSource,
  /교사.*email.*subject.*homeroom.*position.*name/s,
  "Teacher sheet guide should list required columns in import order.",
);
