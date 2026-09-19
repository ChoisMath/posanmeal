import type { LocalCheckInRow } from "@/components/LocalCheckInsTable";
import { formatDateTimeSecondsKST } from "@/lib/timezone";

const HEADERS = [
  "IDB ID",
  "사용자ID",
  "학년반번호",
  "이름",
  "날짜",
  "식사",
  "종류",
  "체크시각(KST)",
  "상태",
  "사유",
  "근거ID",
  "기기ID",
];

function cells(r: LocalCheckInRow): Array<string | number> {
  return [
    r.id,
    r.userId,
    r.userLabel,
    r.name,
    r.date,
    r.mealKind === undefined ? "-" : r.mealKind === "BREAKFAST" ? "조" : "석",
    r.type,
    formatDateTimeSecondsKST(new Date(r.checkedAt)),
    r.status,
    r.reason ?? "",
    r.snapshotId ?? "",
    r.deviceId ?? "",
  ];
}

export async function exportLocalCheckInsXlsx(rows: LocalCheckInRow[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("로컬 미동기");
  ws.addRow(HEADERS);
  for (const r of rows) {
    ws.addRow(cells(r));
  }
  ws.columns.forEach((col) => {
    col.width = 14;
  });
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * 오프라인 구조 경로용. exceljs 청크를 받지 못한 키오스크에서도 내보내기가 끝나야
 * 강제 초기화를 할 수 있으므로, 추가 import 없이 만드는 CSV를 함께 둔다.
 */
/** 스프레드시트가 셀을 수식으로 해석하지 않게 한다(서버 사유 문자열이 그대로 들어온다). */
function neutralize(value: string | number): string {
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function buildLocalCheckInsCsv(rows: LocalCheckInRow[]): Blob {
  const escape = (value: string | number) => `"${neutralize(value).replace(/"/g, '""')}"`;
  const lines = [HEADERS.map(escape).join(","), ...rows.map((r) => cells(r).map(escape).join(","))];
  // BOM 없이는 Excel이 한글을 깨뜨린다.
  return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}

export interface LocalCheckInsFile {
  blob: Blob;
  extension: "xlsx" | "csv";
}

export async function buildLocalCheckInsFile(rows: LocalCheckInRow[]): Promise<LocalCheckInsFile> {
  try {
    return { blob: await exportLocalCheckInsXlsx(rows), extension: "xlsx" };
  } catch {
    return { blob: buildLocalCheckInsCsv(rows), extension: "csv" };
  }
}
