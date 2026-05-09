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
];

export async function exportLocalCheckInsXlsx(rows: LocalCheckInRow[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("로컬 미동기");
  ws.addRow(HEADERS);
  for (const r of rows) {
    ws.addRow([
      r.id,
      r.userId,
      r.userLabel,
      r.name,
      r.date,
      r.mealKind === "BREAKFAST" ? "조" : "석",
      r.type,
      formatDateTimeSecondsKST(new Date(r.checkedAt)),
    ]);
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
