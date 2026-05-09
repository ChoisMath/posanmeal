// src/lib/__tests__/local-checkins-export.test.ts
import { describe, expect, it } from "vitest";
import { exportLocalCheckInsXlsx } from "@/lib/local-checkins-export";
import ExcelJS from "exceljs";
import { buildUserLabel, type LocalCheckInRow } from "@/components/LocalCheckInsTable";
import type { LocalUser } from "@/lib/local-db";

describe("buildUserLabel", () => {
  it("formats a student with full grade/class/number", () => {
    const u: LocalUser = { id: 1, name: "홍길동", role: "STUDENT", grade: 1, classNum: 2, number: 15 };
    expect(buildUserLabel(u, 1)).toBe("1-2-15");
  });

  it("returns '교사' for teachers regardless of other fields", () => {
    const u: LocalUser = { id: 2, name: "김선생", role: "TEACHER" };
    expect(buildUserLabel(u, 2)).toBe("교사");
  });

  it("falls back to the user's name when a student is missing class info", () => {
    const u: LocalUser = { id: 3, name: "박학생", role: "STUDENT" };
    expect(buildUserLabel(u, 3)).toBe("박학생");
  });

  it("returns 'id:N' when the user is not in the local cache", () => {
    expect(buildUserLabel(undefined, 99)).toBe("id:99");
  });
});

const sampleRows: LocalCheckInRow[] = [
  {
    id: 42,
    userId: 1,
    userLabel: "1-2-15",
    name: "홍길동",
    date: "2026-05-10",
    mealKind: "DINNER",
    type: "STUDENT",
    checkedAt: "2026-05-10T09:32:11.000Z",
  },
  {
    id: 43,
    userId: 2,
    userLabel: "교사",
    name: "김선생",
    date: "2026-05-10",
    mealKind: "BREAKFAST",
    type: "WORK",
    checkedAt: "2026-05-10T00:15:00.000Z",
  },
];

async function loadWorkbook(blob: Blob): Promise<ExcelJS.Workbook> {
  const buffer = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe("exportLocalCheckInsXlsx", () => {
  it("returns a workbook with a header row only when input is empty", async () => {
    const blob = await exportLocalCheckInsXlsx([]);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws).toBeDefined();
    expect(ws.rowCount).toBe(1);
    const header = ws.getRow(1).values as Array<string | undefined>;
    expect(header.slice(1)).toEqual([
      "IDB ID", "사용자ID", "학년반번호", "이름", "날짜", "식사", "종류", "체크시각(KST)",
    ]);
  });

  it("maps every row's fields into the worksheet in order", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.rowCount).toBe(3);
    const row2 = ws.getRow(2).values as Array<unknown>;
    expect(row2.slice(1)).toEqual([42, 1, "1-2-15", "홍길동", "2026-05-10", "석", "STUDENT", "2026-05-10 18:32:11"]);
    const row3 = ws.getRow(3).values as Array<unknown>;
    expect(row3.slice(1)).toEqual([43, 2, "교사", "김선생", "2026-05-10", "조", "WORK", "2026-05-10 09:15:00"]);
  });

  it("translates BREAKFAST to '조' and DINNER to '석'", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.getRow(2).getCell(6).value).toBe("석");
    expect(ws.getRow(3).getCell(6).value).toBe("조");
  });

  it("makes the header row bold", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it("sets every column to width 14", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    for (const col of ws.columns) {
      expect(col.width).toBe(14);
    }
  });
});
