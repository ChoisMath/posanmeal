import type ExcelJSType from "exceljs";
import { MEAL_KINDS, MEAL_SHORT, WEEKDAY_LABELS, weekdayOf } from "@/lib/meal-plan";

export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";

export interface StatsExcelInput {
  title: string;
  months: Array<{ year: number; month: number }>;
  meals: Array<{ mealKind: MealKind; price: number }>;
  openDates: Partial<Record<MealKind, string[]>>;
  rows: Array<{
    seq: number;
    createdAt: string;
    loginId: string;
    studentNo: number;
    name: string;
    grade?: number;
    classNum?: number;
    number?: number;
    gender?: string | null;
    exempt: Partial<Record<MealKind, boolean>>;
    dates: Partial<Record<MealKind, string[]>>;
  }>;
}

// Excel column letter from 1-based index (A=1, Z=26, AA=27, ...)
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const HEADER_FILL: ExcelJSType.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const THIN_BORDER: Partial<ExcelJSType.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function styleHeader(cell: ExcelJSType.Cell) {
  cell.font = { bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.fill = HEADER_FILL;
  cell.border = THIN_BORDER;
}

// Union of all openDates across meal kinds, sorted unique
function buildAllDates(openDates: Partial<Record<MealKind, string[]>>): string[] {
  const set = new Set<string>();
  for (const kind of MEAL_KINDS as MealKind[]) {
    for (const d of openDates[kind] ?? []) {
      set.add(d);
    }
  }
  return [...set].sort();
}

// Price map from meals array, defaulting to 0
function buildPriceMap(meals: StatsExcelInput["meals"]): Record<MealKind, number> {
  const map: Record<MealKind, number> = { BREAKFAST: 0, LUNCH: 0, DINNER: 0 };
  for (const m of meals) {
    map[m.mealKind] = m.price;
  }
  return map;
}

// Meal kind column offset within the group of 3 (조=0, 중=1, 석=2)
const KIND_COL_OFFSET: Record<MealKind, number> = {
  BREAKFAST: 0,
  LUNCH: 1,
  DINNER: 2,
};

function buildSheet1(
  workbook: ExcelJSType.Workbook,
  input: StatsExcelInput,
  allDates: string[],
  priceMap: Record<MealKind, number>,
): void {
  const ws = workbook.addWorksheet("전체신청내역");

  // Fixed cols 1–16 (A–P), then date×3 cols starting at col 17
  // A=1,B=2,...,G=7  → seq,time,loginId,studentNo,name,수납액,합계
  // H=8,I=9,J=10     → 면제(조/중/석)
  // K=11,L=12,M=13   → 단가(조/중/석)
  // N=14,O=15,P=16   → 식수(조/중/석)
  // Q=17,... → date×3

  const FIXED_COLS = 16;
  const totalCols = FIXED_COLS + allDates.length * 3;

  // ── Row 1: group headers (merged) ──
  // A1:G1 single cells – will be merged with row 2 and 3 (rows 1–3 merged vertically for A–G)
  const fixedGroupMerges: [number, number, string][] = [
    [1, 1, "순번"],
    [2, 2, "시간"],
    [3, 3, "아이디"],
    [4, 4, "학번"],
    [5, 5, "이름"],
    [6, 6, "수납액"],
    [7, 7, "합계"],
  ];
  for (const [c1, c2, label] of fixedGroupMerges) {
    ws.mergeCells(1, c1, 3, c2);
    const cell = ws.getCell(1, c1);
    cell.value = label;
    styleHeader(cell);
  }

  // H1:J1 "면제", K1:M1 "단가", N1:P1 "식수" (merged across 3 cols, rows 1 only)
  const tripleGroups: [number, string][] = [[8, "면제"], [11, "단가"], [14, "식수"]];
  for (const [startCol, label] of tripleGroups) {
    ws.mergeCells(1, startCol, 1, startCol + 2);
    const cell = ws.getCell(1, startCol);
    cell.value = label;
    styleHeader(cell);
  }

  // Date group headers (row 1 = MM/DD merged across 3 cols)
  for (let di = 0; di < allDates.length; di++) {
    const col = FIXED_COLS + 1 + di * 3;
    const dateKey = allDates[di];
    const mm = dateKey.slice(5, 7);
    const dd = dateKey.slice(8, 10);
    ws.mergeCells(1, col, 1, col + 2);
    const cell = ws.getCell(1, col);
    cell.value = `${mm}/${dd}`;
    styleHeader(cell);
  }

  // ── Row 2: sub-headers — 단가 values in K2/L2/M2, date group row 2 = 요일 (3 cols merged) ──
  // H2/I2/J2 belong to the 면제 merged block (no value needed, already merged into row 1 group)
  // K2=조 price, L2=중 price, M2=석 price
  const priceRow = 2;
  ws.getCell(priceRow, 11).value = priceMap.BREAKFAST;
  ws.getCell(priceRow, 12).value = priceMap.LUNCH;
  ws.getCell(priceRow, 13).value = priceMap.DINNER;
  for (let c = 11; c <= 13; c++) {
    styleHeader(ws.getCell(priceRow, c));
  }

  for (let di = 0; di < allDates.length; di++) {
    const col = FIXED_COLS + 1 + di * 3;
    const dateKey = allDates[di];
    const wd = weekdayOf(dateKey);
    ws.mergeCells(2, col, 2, col + 2);
    const cell = ws.getCell(2, col);
    cell.value = WEEKDAY_LABELS[wd];
    styleHeader(cell);
  }

  // ── Row 3: leaf headers ──
  const kinds: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];
  for (let i = 0; i < 3; i++) {
    const short = MEAL_SHORT[kinds[i]];
    // 면제 조/중/석
    const hCell = ws.getCell(3, 8 + i);
    hCell.value = short;
    styleHeader(hCell);
    // 단가 조/중/석
    const kCell = ws.getCell(3, 11 + i);
    kCell.value = short;
    styleHeader(kCell);
    // 식수 조/중/석
    const nCell = ws.getCell(3, 14 + i);
    nCell.value = short;
    styleHeader(nCell);
  }

  for (let di = 0; di < allDates.length; di++) {
    const baseCol = FIXED_COLS + 1 + di * 3;
    for (let ki = 0; ki < 3; ki++) {
      const cell = ws.getCell(3, baseCol + ki);
      cell.value = MEAL_SHORT[kinds[ki]];
      styleHeader(cell);
    }
  }

  // ── Data rows (row 4+) ──
  const DATA_START = 4;
  for (let ri = 0; ri < input.rows.length; ri++) {
    const row = input.rows[ri];
    const rowNum = DATA_START + ri;
    const r = ws.getRow(rowNum);

    r.getCell(1).value = row.seq;
    r.getCell(2).value = row.createdAt;
    r.getCell(3).value = row.loginId;
    r.getCell(4).value = row.studentNo;
    r.getCell(5).value = row.name;

    // F = 수납액: (1-H)*K + (1-I)*L + (1-J)*M
    r.getCell(6).value = {
      formula: `(1-H${rowNum})*K${rowNum}+(1-I${rowNum})*L${rowNum}+(1-J${rowNum})*M${rowNum}`,
    };
    // G = 합계: SUM(K:M)
    r.getCell(7).value = { formula: `SUM(K${rowNum}:M${rowNum})` };

    // H/I/J = 면제 여부 (1 if exempt, else blank)
    for (let ki = 0; ki < 3; ki++) {
      const kind = kinds[ki];
      r.getCell(8 + ki).value = row.exempt[kind] ? 1 : null;
    }

    // K/L/M = 단가 × 식수 수식
    r.getCell(11).value = { formula: `K$2*N${rowNum}` };
    r.getCell(12).value = { formula: `L$2*O${rowNum}` };
    r.getCell(13).value = { formula: `M$2*P${rowNum}` };

    // N/O/P = 식수 (날짜 수)
    for (let ki = 0; ki < 3; ki++) {
      const kind = kinds[ki];
      const isOffered = input.meals.some((m) => m.mealKind === kind);
      if (isOffered) {
        r.getCell(14 + ki).value = row.dates[kind]?.length ?? 0;
      } else {
        r.getCell(14 + ki).value = null;
      }
    }

    // Date×kind cells
    for (let di = 0; di < allDates.length; di++) {
      const dateKey = allDates[di];
      const baseCol = FIXED_COLS + 1 + di * 3;
      for (let ki = 0; ki < 3; ki++) {
        const kind = kinds[ki];
        const selectedDates = row.dates[kind] ?? [];
        r.getCell(baseCol + ki).value = selectedDates.includes(dateKey) ? 1 : null;
      }
    }
  }

  // ── Summary row ──
  const lastDataRow = DATA_START + input.rows.length - 1;
  const summaryRow = DATA_START + input.rows.length;
  const summaryTo = Math.max(DATA_START, lastDataRow);

  ws.getCell(summaryRow, 4).value = "합계";
  ws.getCell(summaryRow, 4).font = { bold: true };
  ws.getCell(summaryRow, 5).value = { formula: `COUNTA(E${DATA_START}:E${summaryTo})` };

  for (let c = 6; c <= totalCols; c++) {
    const letter = colLetter(c);
    // 날짜 셀은 COUNTA, 고정 수치 열은 SUM
    if (c >= FIXED_COLS + 1) {
      ws.getCell(summaryRow, c).value = { formula: `COUNTA(${letter}${DATA_START}:${letter}${summaryTo})` };
    } else {
      ws.getCell(summaryRow, c).value = { formula: `SUM(${letter}${DATA_START}:${letter}${summaryTo})` };
    }
  }

  // Column widths
  ws.getColumn(1).width = 6;   // seq
  ws.getColumn(2).width = 18;  // time
  ws.getColumn(3).width = 14;  // loginId
  ws.getColumn(4).width = 8;   // studentNo
  ws.getColumn(5).width = 10;  // name
  ws.getColumn(6).width = 10;  // 수납액
  ws.getColumn(7).width = 10;  // 합계
  for (let c = 8; c <= FIXED_COLS; c++) {
    ws.getColumn(c).width = 6;
  }
  for (let c = FIXED_COLS + 1; c <= totalCols; c++) {
    ws.getColumn(c).width = 5;
  }
}

function buildSheet2(
  workbook: ExcelJSType.Workbook,
  input: StatsExcelInput,
): void {
  const ws = workbook.addWorksheet("요일별");

  // A1:H1 merged title
  ws.mergeCells(1, 1, 1, 8);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "요일별 식수(첫주 기준)";
  titleCell.font = { bold: true };
  titleCell.alignment = { horizontal: "center" };

  // Row 2: 구분 | 일 | 월 | 화 | 수 | 목 | 금 | 토
  const headerLabels = ["구분", "일", "월", "화", "수", "목", "금", "토"];
  const headerRow = ws.getRow(2);
  headerLabels.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    styleHeader(cell);
  });

  // Rows 3–5: 조식/중식/석식
  const kindLabels: Record<MealKind, string> = { BREAKFAST: "조식", LUNCH: "중식", DINNER: "석식" };
  const kinds: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];

  for (let ki = 0; ki < kinds.length; ki++) {
    const kind = kinds[ki];
    const rowNum = 3 + ki;
    ws.getCell(rowNum, 1).value = kindLabels[kind];
    styleHeader(ws.getCell(rowNum, 1));

    // "첫주 기준": 공고 첫 달의 개설일만 대상
    const firstMonth = input.months[0];
    const firstMonthKey = firstMonth
      ? `${firstMonth.year}-${String(firstMonth.month).padStart(2, "0")}`
      : null;
    const kindDates = (input.openDates[kind] ?? []).filter(
      (d) => firstMonthKey === null || d.startsWith(firstMonthKey),
    );

    for (let wd = 0; wd <= 6; wd++) {
      // First open date of this weekday
      const firstDate = kindDates.find((d) => weekdayOf(d) === wd);
      if (!firstDate) {
        ws.getCell(rowNum, 2 + wd).value = null;
        continue;
      }
      // Count rows that selected this date for this kind
      const count = input.rows.filter((r) =>
        (r.dates[kind] ?? []).includes(firstDate)
      ).length;
      ws.getCell(rowNum, 2 + wd).value = count;
    }
  }

  for (let c = 1; c <= 8; c++) {
    ws.getColumn(c).width = 8;
  }
  ws.getColumn(1).width = 10;
}

function buildSheet3(
  workbook: ExcelJSType.Workbook,
  input: StatsExcelInput,
): void {
  const ws = workbook.addWorksheet("에듀파인");

  // Header row (1행)
  const headers = [
    "*주야", "*계열", "*학과", "*학년", "*반", "*번호", "*성명",
    "*대상금액",
    "조식면제", "중식면제", "석식면제",
    "조식수", "중식수", "석식수",
    "조식금액", "중식금액", "석식금액",
    "금액합계",
    "신청시간",
  ];
  const headerRow = ws.getRow(1);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    styleHeader(cell);
  });

  // Data rows (2행~): sheet1 data rows start at 4
  // 에듀파인 데이터행 i (0-based) → sheet1 row r = 4 + i
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const sheet1Row = 4 + i; // sheet1 data row number
    const r = ws.getRow(2 + i);

    r.getCell(1).value = "주간";
    r.getCell(2).value = "일반계";
    r.getCell(3).value = "일반학과";
    r.getCell(4).value = row.grade ?? null;
    r.getCell(5).value = row.classNum ?? null;
    r.getCell(6).value = row.number ?? null;
    r.getCell(7).value = row.name;

    // 대상금액: 전체신청내역!F{sheet1Row}
    r.getCell(8).value = { formula: `전체신청내역!F${sheet1Row}` };

    // 면제 (조/중/석)
    r.getCell(9).value = { formula: `전체신청내역!H${sheet1Row}` };
    r.getCell(10).value = { formula: `전체신청내역!I${sheet1Row}` };
    r.getCell(11).value = { formula: `전체신청내역!J${sheet1Row}` };

    // 식수 (조/중/석)
    r.getCell(12).value = { formula: `전체신청내역!N${sheet1Row}` };
    r.getCell(13).value = { formula: `전체신청내역!O${sheet1Row}` };
    r.getCell(14).value = { formula: `전체신청내역!P${sheet1Row}` };

    // 금액 (조/중/석)
    r.getCell(15).value = { formula: `전체신청내역!K${sheet1Row}` };
    r.getCell(16).value = { formula: `전체신청내역!L${sheet1Row}` };
    r.getCell(17).value = { formula: `전체신청내역!M${sheet1Row}` };

    // 금액합계
    r.getCell(18).value = { formula: `전체신청내역!G${sheet1Row}` };

    // 신청시간 (createdAt 문자열 직접)
    r.getCell(19).value = row.createdAt;
  }

  headers.forEach((_, i) => {
    ws.getColumn(i + 1).width = 12;
  });
}

export async function buildStatsWorkbook(
  input: StatsExcelInput,
): Promise<ExcelJSType.Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PosanMeal";
  workbook.created = new Date();

  const allDates = buildAllDates(input.openDates);
  const priceMap = buildPriceMap(input.meals);

  buildSheet1(workbook, input, allDates, priceMap);
  buildSheet2(workbook, input);
  buildSheet3(workbook, input);

  return workbook;
}
