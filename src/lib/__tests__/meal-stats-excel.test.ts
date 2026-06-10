import { describe, expect, it } from "vitest";
import { buildStatsWorkbook } from "@/lib/meal-stats-excel";

const baseInput = {
  title: "2026년 07월 급식신청",
  months: [{ year: 2026, month: 7 }],
  meals: [{ mealKind: "DINNER" as const, price: 5680 }],
  openDates: { DINNER: ["2026-07-21", "2026-07-22"] },
  rows: [
    {
      seq: 1,
      createdAt: "2026-06-10 17:01:02",
      loginId: "hong",
      studentNo: 20600,
      name: "최재혁",
      grade: 2,
      classNum: 6,
      number: 0,
      exempt: { DINNER: false },
      dates: { DINNER: ["2026-07-21"] },
    },
  ],
};

describe("buildStatsWorkbook — 전체신청내역 헤더", () => {
  it("A3 = 순번", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    expect(ws.getCell("A3").value).toBe("순번");
  });

  it("F4 수식에 (1-H4) 포함", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    expect(ws.getCell("F4").value).toMatchObject({
      formula: expect.stringContaining("(1-H4)"),
    });
  });

  it("G4 = SUM(K4:M4)", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    expect(ws.getCell("G4").value).toMatchObject({ formula: "SUM(K4:M4)" });
  });

  it("M2 = 석식 단가", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    // K=조, L=중, M=석 단가
    expect(ws.getCell("M2").value).toBe(5680);
  });

  it("P4 = 석식 식수 1", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    // N=조식수, O=중식수, P=석식수
    expect(ws.getCell("P4").value).toBe(1);
  });
});

describe("buildStatsWorkbook — 날짜 컬럼 배치", () => {
  it("석식 첫 날짜(2026-07-21) 셀 = 1, 미선택 날짜 셀 = null", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;

    // 고정 16컬럼(A~P) 이후 날짜×3열. 2개 날짜, 각 3열
    // 날짜 합집합: ["2026-07-21","2026-07-22"] → 각 날짜 조/중/석
    // 첫 날짜(21) 석식: 열 Q+2 = S (Q=조, R=중, S=석)
    // 이 행 dates.DINNER = ["2026-07-21"] → 21일 석식 셀 = 1
    const cell21Din = ws.getCell("S4");
    expect(cell21Din.value).toBe(1);

    // 22일 석식(V열)은 미선택 → null or empty
    const cell22Din = ws.getCell("V4");
    expect(cell22Din.value == null || cell22Din.value === "").toBe(true);
  });
});

describe("buildStatsWorkbook — 시트 존재 확인", () => {
  it("요일별 시트 존재", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    expect(wb.getWorksheet("요일별")).toBeTruthy();
  });

  it("에듀파인 시트 존재", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    expect(wb.getWorksheet("에듀파인")).toBeTruthy();
  });
});

describe("buildStatsWorkbook — 합계행", () => {
  it("데이터 0행일 때 합계행이 4행에 안전하게 생성됨", async () => {
    const wb = await buildStatsWorkbook({
      ...baseInput,
      rows: [],
    });
    const ws = wb.getWorksheet("전체신청내역")!;
    // 합계행 D = "합계"
    expect(ws.getCell("D4").value).toBe("합계");
  });

  it("데이터 1행 있을 때 합계행은 5행", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("전체신청내역")!;
    expect(ws.getCell("D5").value).toBe("합계");
  });
});

describe("buildStatsWorkbook — 에듀파인 시트 수식", () => {
  it("에듀파인 첫 데이터행 대상금액 수식이 전체신청내역!F4 참조", async () => {
    const wb = await buildStatsWorkbook(baseInput);
    const ws = wb.getWorksheet("에듀파인")!;
    // 헤더 1행, 데이터 2행부터
    const cell = ws.getCell(2, 8); // 8번째 열 = *대상금액
    expect(cell.value).toMatchObject({
      formula: expect.stringContaining("전체신청내역!F4"),
    });
  });
});
