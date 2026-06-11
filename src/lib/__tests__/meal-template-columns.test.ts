import { describe, it, expect } from "vitest";
import {
  buildTemplateColumns,
  columnHeader,
  parseColumnHeader,
  type TemplateColumn,
} from "@/lib/meal-template-columns";

describe("buildTemplateColumns", () => {
  it("YN 식사는 단일 컬럼, NONE 식사는 제외", () => {
    const cols = buildTemplateColumns(
      [
        { mealKind: "BREAKFAST", method: "NONE" },
        { mealKind: "DINNER", method: "YN" },
      ],
      { DINNER: ["2026-07-01", "2026-07-02"] },
    );
    expect(cols).toEqual([{ kind: "DINNER", type: "YN" }]);
  });

  it("DATE 식사는 개설일별 컬럼을 날짜순으로 생성", () => {
    const cols = buildTemplateColumns(
      [{ mealKind: "LUNCH", method: "DATE" }],
      { LUNCH: ["2026-07-10", "2026-07-05"] },
    );
    expect(cols).toEqual([
      { kind: "LUNCH", type: "DATE", date: "2026-07-05" },
      { kind: "LUNCH", type: "DATE", date: "2026-07-10" },
    ]);
  });

  it("WEEKDAY 식사는 개설일에 등장하는 요일 합집합을 일~토 순으로 생성", () => {
    // 2026-07-06=월, 2026-07-07=화, 2026-07-13=월
    const cols = buildTemplateColumns(
      [{ mealKind: "BREAKFAST", method: "WEEKDAY" }],
      { BREAKFAST: ["2026-07-13", "2026-07-06", "2026-07-07"] },
    );
    expect(cols).toEqual([
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 1 },
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 2 },
    ]);
  });

  it("식사 순서는 조식→중식→석식", () => {
    const cols = buildTemplateColumns(
      [
        { mealKind: "DINNER", method: "YN" },
        { mealKind: "BREAKFAST", method: "YN" },
      ],
      {},
    );
    expect(cols.map((c) => c.kind)).toEqual(["BREAKFAST", "DINNER"]);
  });
});

describe("columnHeader", () => {
  it("YN → 식사 라벨", () => {
    expect(columnHeader({ kind: "BREAKFAST", type: "YN" })).toBe("조식");
  });
  it("DATE → '중식-7월 5일' 형식", () => {
    expect(columnHeader({ kind: "LUNCH", type: "DATE", date: "2026-07-05" })).toBe(
      "중식-7월 5일",
    );
  });
  it("WEEKDAY → '조식-월요일' 형식", () => {
    expect(columnHeader({ kind: "BREAKFAST", type: "WEEKDAY", weekday: 1 })).toBe(
      "조식-월요일",
    );
  });
});

describe("parseColumnHeader", () => {
  const months = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }];

  it("생성된 모든 헤더는 역파싱으로 원복된다 (왕복)", () => {
    const cols: TemplateColumn[] = [
      { kind: "BREAKFAST", type: "YN" },
      { kind: "LUNCH", type: "DATE", date: "2026-07-05" },
      { kind: "DINNER", type: "DATE", date: "2026-08-31" },
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 0 },
      { kind: "DINNER", type: "WEEKDAY", weekday: 6 },
    ];
    for (const col of cols) {
      expect(parseColumnHeader(columnHeader(col), months)).toEqual(col);
    }
  });

  it("연도 경계 공고에서 월로 연도를 복원한다", () => {
    const boundary = [{ year: 2026, month: 12 }, { year: 2027, month: 1 }];
    expect(parseColumnHeader("석식-1월 5일", boundary)).toEqual({
      kind: "DINNER",
      type: "DATE",
      date: "2027-01-05",
    });
    expect(parseColumnHeader("석식-12월 25일", boundary)).toEqual({
      kind: "DINNER",
      type: "DATE",
      date: "2026-12-25",
    });
  });

  it("대상 월에 없는 날짜 헤더는 null", () => {
    expect(parseColumnHeader("중식-3월 1일", months)).toBeNull();
  });

  it("인식 불가 헤더는 null", () => {
    expect(parseColumnHeader("이름", months)).toBeNull();
    expect(parseColumnHeader("간식-7월 5일", months)).toBeNull();
    expect(parseColumnHeader("", months)).toBeNull();
  });
});
