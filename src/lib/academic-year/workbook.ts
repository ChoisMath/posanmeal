import type ExcelJSType from "exceljs";
import type { Profile, RosterRow } from "./contracts";

export const WORKBOOK_SCHEMA_VERSION = 1;

export const SHEET_NAMES = { STUDENT: "학생", TEACHER: "교사" } as const;
export type SheetName = (typeof SHEET_NAMES)[keyof typeof SHEET_NAMES];

export const META_SHEET_NAME = "__meta";
export const ROW_TOKEN_HEADER = "__rowToken";
export const REFERENCE_HEADER_PREFIX = "참고_";

export const REFERENCE_HEADERS = {
  grade: "참고_현재학년",
  classNum: "참고_현재반",
  number: "참고_현재번호",
} as const;

/** 한 열의 헤더 이름과 Profile 필드 사이의 대응. 빌더·파서가 이 정의 하나만 공유한다. */
export interface ColumnDef {
  header: string;
  field: keyof Profile;
  width: number;
}

// email과 role은 컬럼 정의와 분리해서 다룬다(email은 Profile 필드가 아니고, role은
// 시트로 이미 결정되므로 열이 필요 없다).
export const STUDENT_PROFILE_COLUMNS: ColumnDef[] = [
  { header: "학년", field: "grade", width: 8 },
  { header: "반", field: "classNum", width: 8 },
  { header: "번호", field: "number", width: 8 },
  { header: "이름", field: "name", width: 14 },
  { header: "성별", field: "gender", width: 8 },
];

export const TEACHER_PROFILE_COLUMNS: ColumnDef[] = [
  { header: "과목", field: "subject", width: 14 },
  { header: "담임", field: "homeroom", width: 10 },
  { header: "직책", field: "position", width: 14 },
  { header: "이름", field: "name", width: 14 },
];

export const EMAIL_HEADER = "이메일";
export const EMAIL_COLUMN_WIDTH = 28;

export interface WorkbookManifestRow {
  entryId: string;
  userId: number | null;
  email: string;
  version: number;
}

export interface WorkbookManifest {
  schemaVersion: 1;
  fileId: string;
  year: number;
  version: number;
  rows: Record<string, WorkbookManifestRow>;
}

export interface BuildRosterWorkbookInput {
  year: number;
  rows: RosterRow[];
  includeData: boolean;
  manifest: WorkbookManifest;
  currentProfiles?: Map<number, { grade: number | null; classNum: number | null; number: number | null }>;
}

function profileColumnsFor(role: Profile["role"]) {
  return role === "STUDENT" ? STUDENT_PROFILE_COLUMNS : TEACHER_PROFILE_COLUMNS;
}

function headerRowFor(role: Profile["role"], includeReference: boolean): string[] {
  const headers = [EMAIL_HEADER, ...profileColumnsFor(role).map((c) => c.header)];
  if (includeReference) {
    headers.push(REFERENCE_HEADERS.grade, REFERENCE_HEADERS.classNum, REFERENCE_HEADERS.number);
  }
  headers.push(ROW_TOKEN_HEADER);
  return headers;
}

function widthsFor(role: Profile["role"], includeReference: boolean): number[] {
  const widths = [EMAIL_COLUMN_WIDTH, ...profileColumnsFor(role).map((c) => c.width)];
  if (includeReference) {
    widths.push(10, 10, 10);
  }
  widths.push(4);
  return widths;
}

function fieldValueOf(profile: Profile, field: keyof Profile): string | number | null {
  const value = profile[field];
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

function buildSheet(
  workbook: ExcelJSType.Workbook,
  sheetName: SheetName,
  role: Profile["role"],
  rows: RosterRow[],
  includeData: boolean,
  entryIdToToken: Map<string, string>,
  currentProfiles: BuildRosterWorkbookInput["currentProfiles"],
): void {
  const includeReference = role === "STUDENT" && includeData && currentProfiles !== undefined;
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = headerRowFor(role, includeReference);
  const headerRow = sheet.getRow(1);
  headers.forEach((header, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const widths = widthsFor(role, includeReference);
  widths.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });

  // 이메일 열은 텍스트 형식으로 고정해 Excel이 mailto: 하이퍼링크로 바꾸지 않게 한다.
  sheet.getColumn(1).numFmt = "@";

  const tokenColIndex = headers.length;
  sheet.getColumn(tokenColIndex).hidden = true;

  if (!includeData) return;

  const relevant = rows.filter((row) => row.profile.role === role);
  relevant.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 2);
    excelRow.getCell(1).value = row.email;

    profileColumnsFor(role).forEach((col, colIndex) => {
      excelRow.getCell(2 + colIndex).value = fieldValueOf(row.profile, col.field);
    });

    if (includeReference) {
      const current = row.userId !== null ? currentProfiles?.get(row.userId) : undefined;
      const base = 2 + profileColumnsFor(role).length;
      excelRow.getCell(base).value = current?.grade ?? null;
      excelRow.getCell(base + 1).value = current?.classNum ?? null;
      excelRow.getCell(base + 2).value = current?.number ?? null;
    }

    const token = entryIdToToken.get(row.entryId);
    excelRow.getCell(tokenColIndex).value = token ?? null;
  });
}

function buildMetaSheet(workbook: ExcelJSType.Workbook, manifest: WorkbookManifest, includeData: boolean): void {
  const sheet = workbook.addWorksheet(META_SHEET_NAME, { state: "veryHidden" });
  const entries: Array<[string, string | number | boolean]> = [
    ["schemaVersion", manifest.schemaVersion],
    ["year", manifest.year],
    ["fileId", manifest.fileId],
    ["templateOnly", !includeData],
  ];
  entries.forEach(([key, value], index) => {
    const row = sheet.getRow(index + 1);
    row.getCell(1).value = key;
    row.getCell(2).value = value;
  });
}

/**
 * 두 시트(학생/교사) 고정 양식을 만든다. `includeData=false`면 헤더만 있는 빈
 * 양식이고, `RosterFile` 서버 기록도 만들지 않는다(export-service의 책임).
 */
export async function buildRosterWorkbook(input: BuildRosterWorkbookInput): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const entryIdToToken = new Map<string, string>();
  for (const [token, row] of Object.entries(input.manifest.rows)) {
    entryIdToToken.set(row.entryId, token);
  }

  buildSheet(
    workbook,
    SHEET_NAMES.STUDENT,
    "STUDENT",
    input.rows,
    input.includeData,
    entryIdToToken,
    input.currentProfiles,
  );
  buildSheet(
    workbook,
    SHEET_NAMES.TEACHER,
    "TEACHER",
    input.rows,
    input.includeData,
    entryIdToToken,
    input.currentProfiles,
  );
  buildMetaSheet(workbook, input.manifest, input.includeData);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
