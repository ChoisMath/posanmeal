import { describe, expect, it } from "vitest";
import { filterRosterByGrade } from "@/lib/admin-roster/labels";

describe("명부 학년별 보기", () => {
  const rows = [
    { id: "first", profile: { grade: 1 } },
    { id: "second", profile: { grade: 2 } },
    { id: "third", profile: { grade: 3 } },
    { id: "missing", profile: { grade: null } },
  ];
  it("선택 학년만 표시하고 원본 명부를 보존한다", () => {
    expect(filterRosterByGrade(rows, 2).map((row) => row.id)).toEqual(["second"]);
    expect(rows).toHaveLength(4);
  });
  it("설정의 전체 명부에서는 학년 미지정 기록도 보존한다", () => {
    expect(filterRosterByGrade(rows, null).map((row) => row.id)).toEqual(["first", "second", "third", "missing"]);
  });
});
