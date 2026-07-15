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

// ── 학년별-성별 시트 ──
// 중식+석식 제공 공고. s4는 확정일 0일 + 성별 누락 → 어디에도 카운트되지 않고
// 미지정 열도 유발하지 않아야 한다.
const gradeGenderInput = {
  title: "2026년 07월 급식신청",
  months: [{ year: 2026, month: 7 }],
  meals: [
    { mealKind: "LUNCH" as const, price: 6000 },
    { mealKind: "DINNER" as const, price: 5680 },
  ],
  openDates: {
    LUNCH: ["2026-07-21"],
    DINNER: ["2026-07-21", "2026-07-22"],
  },
  rows: [
    {
      seq: 1, createdAt: "2026-06-10 09:00:00", loginId: "s1", studentNo: 10101,
      name: "학생A", grade: 1, classNum: 1, number: 1, gender: "MALE",
      exempt: {}, dates: { LUNCH: ["2026-07-21"], DINNER: ["2026-07-21"] },
    },
    {
      seq: 2, createdAt: "2026-06-10 09:01:00", loginId: "s2", studentNo: 10102,
      name: "학생B", grade: 1, classNum: 1, number: 2, gender: "FEMALE",
      exempt: {}, dates: { DINNER: ["2026-07-22"] },
    },
    {
      seq: 3, createdAt: "2026-06-10 09:02:00", loginId: "s3", studentNo: 20101,
      name: "학생C", grade: 2, classNum: 1, number: 1, gender: "MALE",
      exempt: {}, dates: { DINNER: ["2026-07-21", "2026-07-22"] },
    },
    {
      seq: 4, createdAt: "2026-06-10 09:03:00", loginId: "s4", studentNo: 30101,
      name: "학생D", grade: 3, classNum: 1, number: 1, gender: null,
      exempt: {}, dates: {},
    },
  ],
};

describe("buildStatsWorkbook — 학년별-성별 시트", () => {
  // 레이아웃 (미지정·학년미상 없음):
  // 1:중식라벨 2:헤더 3~5:1~3학년 6:합계 7:(빈) 8:석식라벨 9:헤더 10~12:1~3학년 13:합계
  it("4번째 시트로 존재", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    expect(wb.worksheets[3]?.name).toBe("학년별-성별");
  });

  it("중식 표가 위, 석식 표가 아래 (조식 표 없음)", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("A1").value).toBe("중식");
    expect(ws.getCell("A8").value).toBe("석식");
    const colA: unknown[] = [];
    ws.eachRow((row) => colA.push(row.getCell(1).value));
    expect(colA).not.toContain("조식");
  });

  it("성별 누락자가 카운트 대상에 없으면 남/여/계 3열", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B2").value).toBe("남");
    expect(ws.getCell("C2").value).toBe("여");
    expect(ws.getCell("D2").value).toBe("계");
  });

  it("중식 1학년 남 1 / 계 1, 합계 행 일치", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B3").value).toBe(1); // 1학년 남
    expect(ws.getCell("C3").value).toBe(0);
    expect(ws.getCell("D3").value).toBe(1);
    expect(ws.getCell("A6").value).toBe("합계");
    expect(ws.getCell("B6").value).toBe(1);
    expect(ws.getCell("D6").value).toBe(1);
  });

  it("석식 학년×성별 카운트 (dates 없는 s4 제외)", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B10").value).toBe(1); // 1학년 남
    expect(ws.getCell("C10").value).toBe(1); // 1학년 여
    expect(ws.getCell("D10").value).toBe(2);
    expect(ws.getCell("B11").value).toBe(1); // 2학년 남
    expect(ws.getCell("B13").value).toBe(2); // 합계 남
    expect(ws.getCell("C13").value).toBe(1); // 합계 여
    expect(ws.getCell("D13").value).toBe(3); // 합계 계
  });

  it("성별 누락 신청자가 있으면 미지정 열 추가", async () => {
    const input = {
      ...gradeGenderInput,
      rows: [
        ...gradeGenderInput.rows,
        {
          seq: 5, createdAt: "2026-06-10 09:04:00", loginId: "s5", studentNo: 30102,
          name: "학생E", grade: 3, classNum: 1, number: 2, gender: null,
          exempt: {}, dates: { DINNER: ["2026-07-21"] },
        },
      ],
    };
    const wb = await buildStatsWorkbook(input);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("D2").value).toBe("미지정");
    expect(ws.getCell("E2").value).toBe("계");
    expect(ws.getCell("D12").value).toBe(1); // 석식 3학년 미지정
    expect(ws.getCell("E13").value).toBe(4); // 석식 합계 계
  });

  it("학년 정보 없는 신청자가 있으면 학년미상 행 추가", async () => {
    const input = {
      ...gradeGenderInput,
      rows: [
        ...gradeGenderInput.rows,
        {
          seq: 5, createdAt: "2026-06-10 09:05:00", loginId: "s6", studentNo: 0,
          name: "학생F", grade: undefined, classNum: undefined, number: undefined,
          gender: "MALE", exempt: {}, dates: { LUNCH: ["2026-07-21"] },
        },
      ],
    };
    const wb = await buildStatsWorkbook(input);
    const ws = wb.getWorksheet("학년별-성별")!;
    // 학년미상 행이 3학년 아래 삽입: 3~5:1~3학년 6:학년미상 7:합계
    expect(ws.getCell("A6").value).toBe("학년미상");
    expect(ws.getCell("B6").value).toBe(1);
    expect(ws.getCell("A7").value).toBe("합계");
    expect(ws.getCell("B7").value).toBe(2); // 중식 합계 남 = 학생A + 학생F
  });
});
