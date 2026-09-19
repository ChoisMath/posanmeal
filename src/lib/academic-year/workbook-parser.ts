import type ExcelJSType from "exceljs";
import type { Profile, RowIssue } from "./contracts";
import { DomainError } from "./errors";
import { normalizeGender } from "@/lib/gender";
import { normalizeEmail, studentProfileSchema, teacherProfileSchema } from "./profile-schema";
import {
  EMAIL_HEADER,
  META_SHEET_NAME,
  ROW_TOKEN_HEADER,
  SHEET_NAMES,
  STUDENT_PROFILE_COLUMNS,
  TEACHER_PROFILE_COLUMNS,
  WORKBOOK_SCHEMA_VERSION,
  type SheetName,
} from "./workbook";

export interface ParsedRosterRow {
  sheet: SheetName;
  row: number;
  email: string;
  profile: Profile;
  rowToken?: string;
}

export interface ParsedRosterWorkbook {
  fileId: string;
  year: number;
  templateOnly: boolean;
  rows: ParsedRosterRow[];
  issues: RowIssue[];
  coveredRoles: Profile["role"][];
}

type CellReadResult = { ok: true; text: string } | { ok: false; code: string; message: string };

/**
 * 셀 값을 화면에 보이는 문자열로만 좁힌다. 수식은 값을 감추므로 거절하고,
 * 날짜·불리언·오류 타입은 이 명부 열에 나타날 이유가 없으므로 함께 거절한다.
 */
function readCellText(cell: ExcelJSType.Cell): CellReadResult {
  const value = cell.value;
  if (value === null || value === undefined) return { ok: true, text: "" };

  if (typeof value === "string") return { ok: true, text: value.trim() };
  if (typeof value === "number") {
    return { ok: true, text: Number.isInteger(value) ? String(value) : String(value) };
  }
  if (typeof value === "boolean") {
    return { ok: false, code: "UNSUPPORTED_CELL_TYPE", message: "지원하지 않는 셀 형식입니다." };
  }
  if (value instanceof Date) {
    return { ok: false, code: "UNSUPPORTED_CELL_TYPE", message: "날짜 형식은 지원하지 않습니다." };
  }

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as { richText: unknown }).richText)) {
      const parts = (value as { richText: Array<{ text?: string }> }).richText;
      return { ok: true, text: parts.map((p) => p.text ?? "").join("").trim() };
    }
    if ("hyperlink" in value) {
      const hv = value as { text?: unknown; hyperlink?: string };
      const raw = typeof hv.text === "string" ? hv.text : String(hv.text ?? "");
      const stripped = raw.replace(/^mailto:/i, "");
      return { ok: true, text: stripped.trim() };
    }
    if ("formula" in value || "sharedFormula" in value) {
      return {
        ok: false,
        code: "FORMULA_NOT_ALLOWED",
        message: "수식이 들어 있는 셀입니다. 값을 붙여넣기(값만) 한 뒤 다시 올려주세요.",
      };
    }
    if ("error" in value) {
      return { ok: false, code: "UNSUPPORTED_CELL_TYPE", message: "셀에 오류 값이 있습니다." };
    }
  }

  return { ok: false, code: "UNSUPPORTED_CELL_TYPE", message: "지원하지 않는 셀 형식입니다." };
}

function headerIndexOf(headerRow: ExcelJSType.Row, header: string): number | null {
  const count = headerRow.cellCount;
  for (let i = 1; i <= count; i++) {
    const cell = headerRow.getCell(i);
    const value = cell.value;
    if (typeof value === "string" && value.trim() === header) return i;
  }
  return null;
}

function requireColumn(headerRow: ExcelJSType.Row, header: string, sheetLabel: string): number {
  const idx = headerIndexOf(headerRow, header);
  if (idx === null) {
    throw new DomainError(
      "INVALID_FILE",
      `${sheetLabel} 시트에 "${header}" 열이 없습니다. 표준 양식을 새로 내려받아 사용하세요.`,
    );
  }
  return idx;
}

function readMeta(workbook: ExcelJSType.Workbook): { fileId: string; year: number; templateOnly: boolean } {
  const sheet = workbook.getWorksheet(META_SHEET_NAME);
  if (!sheet) {
    throw new DomainError("INVALID_FILE", "이 파일은 명부 양식이 아닙니다. 표준 양식을 새로 내려받아 사용하세요.");
  }

  const values = new Map<string, string | number | boolean>();
  const rowCount = sheet.actualRowCount;
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const key = row.getCell(1).value;
    const value = row.getCell(2).value;
    if (typeof key === "string" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      values.set(key, value);
    }
  }

  const schemaVersion = values.get("schemaVersion");
  if (schemaVersion !== WORKBOOK_SCHEMA_VERSION) {
    throw new DomainError(
      "INVALID_FILE",
      "이 파일은 예전 버전의 명부 양식입니다. 표준 양식을 새로 내려받아 사용하세요.",
    );
  }

  const year = values.get("year");
  if (typeof year !== "number") {
    throw new DomainError("INVALID_FILE", "이 파일에서 학년도를 확인할 수 없습니다.");
  }

  const fileId = values.get("fileId");
  const templateOnly = values.get("templateOnly");

  return {
    fileId: typeof fileId === "string" ? fileId : "",
    year,
    templateOnly: templateOnly === true,
  };
}

interface SheetParseResult {
  rows: ParsedRosterRow[];
  issues: RowIssue[];
  covered: boolean;
}

function parseSheet(
  workbook: ExcelJSType.Workbook,
  sheetName: SheetName,
  role: Profile["role"],
  profileColumns: typeof STUDENT_PROFILE_COLUMNS,
): SheetParseResult {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    throw new DomainError("INVALID_FILE", `${sheetName} 시트가 없습니다. 표준 양식을 새로 내려받아 사용하세요.`);
  }

  const headerRow = sheet.getRow(1);
  const emailCol = requireColumn(headerRow, EMAIL_HEADER, sheetName);
  const fieldCols = profileColumns.map((col) => ({
    field: col.field,
    header: col.header,
    index: requireColumn(headerRow, col.header, sheetName),
  }));
  const tokenCol = headerIndexOf(headerRow, ROW_TOKEN_HEADER);

  const issues: RowIssue[] = [];
  const rows: ParsedRosterRow[] = [];

  const lastRow = sheet.actualRowCount;
  for (let r = 2; r <= lastRow; r++) {
    const excelRow = sheet.getRow(r);
    if (excelRow.cellCount === 0) continue;

    const emailResult = readCellText(excelRow.getCell(emailCol));
    const fieldResults = fieldCols.map((col) => ({
      ...col,
      result: readCellText(excelRow.getCell(col.index)),
    }));

    const allBlank =
      (emailResult.ok ? emailResult.text.length === 0 : false) &&
      fieldResults.every((f) => (f.result.ok ? f.result.text.length === 0 : false));
    if (allBlank) continue;

    let hadCellIssue = false;
    if (!emailResult.ok) {
      issues.push({ sheet: sheetName, row: r, column: EMAIL_HEADER, code: emailResult.code, message: emailResult.message });
      hadCellIssue = true;
    }
    for (const f of fieldResults) {
      if (!f.result.ok) {
        issues.push({ sheet: sheetName, row: r, column: f.header, code: f.result.code, message: f.result.message });
        hadCellIssue = true;
      }
    }

    const emailText = emailResult.ok ? emailResult.text : "";
    if (emailResult.ok && emailText.length === 0) {
      issues.push({
        sheet: sheetName,
        row: r,
        column: EMAIL_HEADER,
        code: "MISSING_EMAIL",
        message: "이메일이 비어 있습니다.",
      });
      hadCellIssue = true;
    }

    const raw: Record<string, unknown> = { role };
    for (const f of fieldResults) {
      const text = f.result.ok ? f.result.text : "";
      if (f.field === "grade" || f.field === "classNum" || f.field === "number") {
        raw[f.field] = text.length > 0 ? Number(text) : undefined;
      } else if (f.field === "gender") {
        const normalized = normalizeGender(text);
        if (normalized === "INVALID") {
          issues.push({
            sheet: sheetName,
            row: r,
            column: f.header,
            code: "INVALID_GENDER",
            message: "성별 값을 인식할 수 없습니다 (남/여).",
          });
          hadCellIssue = true;
        }
        raw[f.field] = normalized === "INVALID" ? undefined : normalized ?? undefined;
      } else {
        raw[f.field] = text.length > 0 ? text : undefined;
      }
    }

    if (hadCellIssue) continue;

    const headerByField = new Map(fieldCols.map((f) => [f.field, f.header]));
    const schema = role === "STUDENT" ? studentProfileSchema : teacherProfileSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        issues.push({
          sheet: sheetName,
          row: r,
          column: headerByField.get(field as keyof Profile) ?? EMAIL_HEADER,
          code: "INVALID_PROFILE_FIELD",
          message: issue.message,
        });
      }
      continue;
    }
    const profile: Profile = parsed.data;

    const rowToken = tokenCol !== null ? readCellText(excelRow.getCell(tokenCol)) : { ok: true, text: "" };
    const token = rowToken.ok && rowToken.text.length > 0 ? rowToken.text : undefined;

    rows.push({ sheet: sheetName, row: r, email: emailText, profile, rowToken: token });
  }

  return { rows, issues, covered: rows.length > 0 || issues.length > 0 };
}

/**
 * 순수 파서: 버퍼를 읽어 행·이슈·메타만 돌려주고 DB에 닿지 않는다. 토큰이
 * 서버 manifest의 어떤 사람을 가리키는지 판단하는 일은 Task 7의 몫이다.
 */
export async function parseRosterWorkbook(buffer: ArrayBuffer): Promise<ParsedRosterWorkbook> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new DomainError("INVALID_FILE", "이 파일을 열 수 없습니다. 표준 양식을 새로 내려받아 사용하세요.");
  }

  const meta = readMeta(workbook);

  const student = parseSheet(workbook, SHEET_NAMES.STUDENT, "STUDENT", STUDENT_PROFILE_COLUMNS);
  const teacher = parseSheet(workbook, SHEET_NAMES.TEACHER, "TEACHER", TEACHER_PROFILE_COLUMNS);

  const rows = [...student.rows, ...teacher.rows];
  const issues = [...student.issues, ...teacher.issues];

  // 참고_ 열은 requireColumn이 정확한 헤더 이름만 찾으므로 자연히 무시된다
  // (알 수 없는 열 취급).

  const emailKeysSeen = new Map<string, SheetName>();
  for (const row of rows) {
    const key = normalizeEmail(row.email);
    const existingSheet = emailKeysSeen.get(key);
    if (existingSheet && existingSheet !== row.sheet) {
      issues.push({
        sheet: row.sheet,
        row: row.row,
        column: EMAIL_HEADER,
        code: "DUPLICATE_EMAIL_ACROSS_SHEETS",
        message: "같은 이메일이 학생·교사 시트에 모두 있습니다.",
      });
    }
    emailKeysSeen.set(key, row.sheet);
  }

  const tokenSeen = new Map<string, ParsedRosterRow>();
  for (const row of rows) {
    if (!row.rowToken) continue;
    const previous = tokenSeen.get(row.rowToken);
    if (previous) {
      issues.push({
        sheet: row.sheet,
        row: row.row,
        column: ROW_TOKEN_HEADER,
        code: "DUPLICATE_ROW_TOKEN",
        message: "같은 행 토큰이 여러 행에 있습니다. 표를 정리한 뒤 다시 올려주세요.",
      });
      issues.push({
        sheet: previous.sheet,
        row: previous.row,
        column: ROW_TOKEN_HEADER,
        code: "DUPLICATE_ROW_TOKEN",
        message: "같은 행 토큰이 여러 행에 있습니다. 표를 정리한 뒤 다시 올려주세요.",
      });
    } else {
      tokenSeen.set(row.rowToken, row);
    }
  }

  const coveredRoles: Profile["role"][] = [];
  if (student.covered) coveredRoles.push("STUDENT");
  if (teacher.covered) coveredRoles.push("TEACHER");

  return {
    fileId: meta.fileId,
    year: meta.year,
    templateOnly: meta.templateOnly,
    rows,
    issues,
    coveredRoles,
  };
}
