import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Profile, RosterRow } from "@/lib/academic-year/contracts";
import { buildRosterWorkbook, type WorkbookManifest } from "@/lib/academic-year/workbook";
import { parseRosterWorkbook } from "@/lib/academic-year/workbook-parser";

function studentProfile(over: Partial<Profile> = {}): Profile {
  return {
    role: "STUDENT",
    name: "학생하나",
    grade: 1,
    classNum: 2,
    number: 3,
    gender: "MALE",
    subject: null,
    homeroom: null,
    position: null,
    ...over,
  };
}

function teacherProfile(over: Partial<Profile> = {}): Profile {
  return {
    role: "TEACHER",
    name: "교사하나",
    grade: null,
    classNum: null,
    number: null,
    gender: null,
    subject: "수학",
    homeroom: "1-2",
    position: "담임",
    ...over,
  };
}

function studentRow(over: Partial<RosterRow> = {}): RosterRow {
  return {
    entryId: "entry-student-1",
    userId: 1,
    email: "student1@posan.hs.kr",
    emailKey: "student1@posan.hs.kr",
    profile: studentProfile(),
    baseUserVersion: 0,
    included: true,
    ...over,
  };
}

function teacherRow(over: Partial<RosterRow> = {}): RosterRow {
  return {
    entryId: "entry-teacher-1",
    userId: 2,
    email: "teacher1@posan.hs.kr",
    emailKey: "teacher1@posan.hs.kr",
    profile: teacherProfile(),
    baseUserVersion: 0,
    included: true,
    ...over,
  };
}

function manifestFor(rows: RosterRow[], year = 2026, fileId = "file-1"): WorkbookManifest {
  const manifest: WorkbookManifest = { schemaVersion: 1, fileId, year, version: 2, rows: {} };
  rows.forEach((row, i) => {
    manifest.rows[`token-${i}`] = {
      entryId: row.entryId,
      userId: row.userId,
      email: row.email,
      version: 1,
    };
  });
  return manifest;
}

describe("buildRosterWorkbook / parseRosterWorkbook round trip", () => {
  it("빈 양식은 시트만 있고 데이터·이슈가 없다", async () => {
    const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 2, rows: {} };
    const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });
    const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);

    expect(parsed.rows).toEqual([]);
    expect(parsed.coveredRoles).toEqual([]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.templateOnly).toBe(true);
    expect(parsed.year).toBe(2026);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    expect(book.worksheets.filter((s) => s.state === "visible").map((s) => s.name)).toEqual(["학생", "교사"]);
    expect(book.getWorksheet("학생")!.getCell("A1").text).toBe("이메일");
    const meta = book.getWorksheet("__meta");
    expect(meta?.state).toBe("veryHidden");
  });

  it("학생·교사 데이터를 왕복해도 값이 그대로다", async () => {
    const rows = [studentRow(), teacherRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });
    const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);

    expect(parsed.templateOnly).toBe(false);
    expect(parsed.issues).toEqual([]);
    expect(parsed.coveredRoles.sort()).toEqual(["STUDENT", "TEACHER"]);
    expect(parsed.rows).toHaveLength(2);

    const studentParsed = parsed.rows.find((r) => r.sheet === "학생")!;
    expect(studentParsed.email).toBe("student1@posan.hs.kr");
    expect(studentParsed.profile).toEqual(studentProfile());
    expect(studentParsed.rowToken).toBe("token-0");

    const teacherParsed = parsed.rows.find((r) => r.sheet === "교사")!;
    expect(teacherParsed.profile).toEqual(teacherProfile());
    expect(teacherParsed.rowToken).toBe("token-1");
  });

  it("행을 정렬해도 rowToken으로 원래 행을 다시 찾을 수 있다", async () => {
    const rows = [studentRow({ entryId: "a", email: "a@posan.hs.kr", emailKey: "a@posan.hs.kr" }), studentRow({ entryId: "b", email: "b@posan.hs.kr", emailKey: "b@posan.hs.kr", profile: studentProfile({ number: 9 }) })];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    // 관리자가 Excel에서 행 순서를 뒤바꾼 것을 흉내: 2·3행의 값을 서로 바꾼다.
    const row2 = sheet.getRow(2).values as ExcelJS.CellValue[];
    const row3 = sheet.getRow(3).values as ExcelJS.CellValue[];
    sheet.getRow(2).values = row3;
    sheet.getRow(3).values = row2;

    const swappedBuffer = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(swappedBuffer)).buffer);

    expect(parsed.issues).toEqual([]);
    const tokens = parsed.rows.map((r) => r.rowToken).sort();
    expect(tokens).toEqual(["token-0", "token-1"]);
    const byToken = new Map(parsed.rows.map((r) => [r.rowToken, r]));
    expect(byToken.get("token-0")!.email).toBe("a@posan.hs.kr");
    expect(byToken.get("token-1")!.email).toBe("b@posan.hs.kr");
  });

  it("같은 rowToken이 두 행에 있으면 이슈가 된다", async () => {
    const rows = [studentRow({ entryId: "a" }), studentRow({ entryId: "b", email: "b@posan.hs.kr", emailKey: "b@posan.hs.kr" })];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    const tokenColIndex = (sheet.getRow(1).values as unknown[]).findIndex((v) => v === "__rowToken");
    sheet.getRow(3).getCell(tokenColIndex).value = "token-0";

    const dupBuffer = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(dupBuffer)).buffer);

    expect(parsed.issues.some((i) => i.code === "DUPLICATE_ROW_TOKEN")).toBe(true);
  });

  it("학생·교사 시트에 같은 이메일이 있으면 이슈가 된다", async () => {
    const rows = [studentRow({ email: "same@posan.hs.kr", emailKey: "same@posan.hs.kr" }), teacherRow({ email: "same@posan.hs.kr", emailKey: "same@posan.hs.kr" })];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });
    const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);

    expect(parsed.issues.some((i) => i.code === "DUPLICATE_EMAIL_ACROSS_SHEETS")).toBe(true);
  });

  it("헤더가 없으면 INVALID_FILE 도메인 오류를 던진다", async () => {
    const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 0, rows: {} };
    const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    book.getWorksheet("학생")!.getCell("A1").value = "엉뚱한헤더";
    const broken = await book.xlsx.writeBuffer();

    await expect(parseRosterWorkbook(Uint8Array.from(Buffer.from(broken)).buffer)).rejects.toMatchObject({
      code: "INVALID_FILE",
    });
  });

  it("표준 열 이름이 같은 시트에 중복되면 INVALID_FILE이다", async () => {
    const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 0, rows: {} };
    const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(1).getCell(2).value = "이메일"; // "학년" 자리에 "이메일"을 또 넣어 중복시킨다
    const dupHeaderBuffer = await book.xlsx.writeBuffer();

    await expect(
      parseRosterWorkbook(Uint8Array.from(Buffer.from(dupHeaderBuffer)).buffer),
    ).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("__meta 시트가 없으면 INVALID_FILE이다", async () => {
    const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 0, rows: {} };
    const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    book.removeWorksheet("__meta");
    const withoutMeta = await book.xlsx.writeBuffer();

    await expect(
      parseRosterWorkbook(Uint8Array.from(Buffer.from(withoutMeta)).buffer),
    ).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("schemaVersion이 다르면 INVALID_FILE이다", async () => {
    const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 0, rows: {} };
    const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const meta = book.getWorksheet("__meta")!;
    meta.getRow(1).getCell(2).value = 999;
    const wrongVersionBuffer = await book.xlsx.writeBuffer();

    await expect(
      parseRosterWorkbook(Uint8Array.from(Buffer.from(wrongVersionBuffer)).buffer),
    ).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("정수 열에 소수(1.5)가 들어오면 정확한 열로 이슈가 된다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(2).getCell(2).value = 1.5; // 학년

    const decimalBuffer = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(decimalBuffer)).buffer);

    expect(parsed.rows).toHaveLength(0);
    expect(
      parsed.issues.some((i) => i.sheet === "학생" && i.row === 2 && i.column === "학년"),
    ).toBe(true);
  });

  it("공유 수식(sharedFormula) 셀도 거절한다", async () => {
    const rows = [studentRow(), studentRow({ entryId: "entry-student-2", email: "student2@posan.hs.kr", emailKey: "student2@posan.hs.kr" })];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    // 4번째 컬럼(번호)에 걸쳐 공유 수식을 채운다: 2행이 마스터, 3행이 follower(sharedFormula).
    sheet.fillFormula("D2:D3", "ROW()", [2, 3]);
    expect((sheet.getCell("D3").value as { sharedFormula?: string }).sharedFormula).toBeDefined();

    const sharedFormulaBuffer = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(sharedFormulaBuffer)).buffer);

    expect(
      parsed.issues.some((i) => i.code === "FORMULA_NOT_ALLOWED" && i.sheet === "학생" && i.row === 3),
    ).toBe(true);
  });

  it("부분적으로만 채운 행은 정확한 시트·행·열로 이슈가 된다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(2).getCell(2).value = null; // 학년 비움 (email은 남아 있음)

    const partial = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(partial)).buffer);

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ sheet: "학생", row: 2, column: "학년" }),
    ]);
  });

  it("완전히 빈 행은 조용히 무시된다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(3).getCell(1).value = null;

    const withBlankRow = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(withBlankRow)).buffer);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toEqual([]);
  });

  it("수식·공유 수식 셀은 거절한다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(2).getCell(4).value = { formula: "A2", result: 3 } as unknown as ExcelJS.CellValue;

    const withFormula = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(withFormula)).buffer);

    expect(parsed.issues.some((i) => i.code === "FORMULA_NOT_ALLOWED" && i.row === 2)).toBe(true);
  });

  it("richText와 hyperlink 이메일 셀도 문자열로 읽는다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(2).getCell(1).value = {
      richText: [{ text: "student1" }, { text: "@posan.hs.kr" }],
    };

    const richBuffer = await book.xlsx.writeBuffer();
    const richParsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(richBuffer)).buffer);
    expect(richParsed.rows[0]!.email).toBe("student1@posan.hs.kr");

    const book2 = new ExcelJS.Workbook();
    await book2.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet2 = book2.getWorksheet("학생")!;
    sheet2.getRow(2).getCell(1).value = {
      text: "student1@posan.hs.kr",
      hyperlink: "mailto:student1@posan.hs.kr",
    };
    const linkBuffer = await book2.xlsx.writeBuffer();
    const linkParsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(linkBuffer)).buffer);
    expect(linkParsed.rows[0]!.email).toBe("student1@posan.hs.kr");
  });

  it("숫자 문자열로 저장된 학년·반·번호도 파싱된다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = book.getWorksheet("학생")!;
    sheet.getRow(2).getCell(2).value = "1";
    sheet.getRow(2).getCell(3).value = "2";
    sheet.getRow(2).getCell(4).value = "3";

    const numericStringBuffer = await book.xlsx.writeBuffer();
    const parsed = await parseRosterWorkbook(Uint8Array.from(Buffer.from(numericStringBuffer)).buffer);

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]!.profile).toMatchObject({ grade: 1, classNum: 2, number: 3 });
  });

  it("참고_현재학년/반/번호 열은 무시된다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const currentProfiles = new Map([[1, { grade: 2, classNum: 5, number: 9 }]]);
    const buffer = await buildRosterWorkbook({
      year: 2025,
      rows,
      includeData: true,
      manifest,
      currentProfiles,
    });

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    const headerValues = book.getWorksheet("학생")!.getRow(1).values as unknown[];
    expect(headerValues).toContain("참고_현재학년");
    expect(headerValues).toContain("참고_현재반");
    expect(headerValues).toContain("참고_현재번호");

    const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]!.profile).toEqual(studentProfile());
  });

  it("빈 교사 시트는 역할 미포함으로 반환한다", async () => {
    const rows = [studentRow()];
    const manifest = manifestFor(rows);
    const buffer = await buildRosterWorkbook({ year: 2026, rows, includeData: true, manifest });
    const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);

    expect(parsed.coveredRoles).toEqual(["STUDENT"]);
  });
});
