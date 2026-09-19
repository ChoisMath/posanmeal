import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const guide = readFileSync(join(process.cwd(), "docs/admin/roster-import.md"), "utf8");
const pageSource = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
const importRoute = readFileSync(
  join(process.cwd(), "src/app/api/admin/import/route.ts"),
  "utf8",
);

describe("Sheet 가져오기 안내", () => {
  it("학년도별 Excel로 대체되었다고 적는다", () => {
    expect(guide).toMatch(/학년도별 Excel로 대체됨/);
  });

  it("두 시트의 열을 가져오기 순서대로 적는다", () => {
    expect(guide).toMatch(/학생[\s\S]*email[\s\S]*grade[\s\S]*classNum[\s\S]*number[\s\S]*name/);
    expect(guide).toMatch(/교사[\s\S]*email[\s\S]*subject[\s\S]*homeroom[\s\S]*position[\s\S]*name/);
  });

  it("관리자 화면에 시트 URL 입력이 남아 있지 않다", () => {
    expect(pageSource).not.toMatch(/studentSheetUrl|teacherSheetUrl|Sheet연결/);
  });

  it("옛 가져오기 API는 410으로 닫혀 있고 아무것도 쓰지 않는다", () => {
    expect(importRoute).toMatch(/status: 410/);
    expect(importRoute).not.toMatch(/withCompatUserWrite|prisma\./);
  });
});
