import { describe, expect, it } from "vitest";
import { canAddRosterUser } from "@/lib/admin-roster/labels";

describe("학년도 사용자 추가 대상", () => {
  it("운영 중인 학년도를 보고 있는 쓰기 관리자만 추가한다", () => {
    expect(canAddRosterUser(true, false, 2026, 2026)).toBe(true);
    expect(canAddRosterUser(true, false, 2027, 2026)).toBe(false);
    expect(canAddRosterUser(true, false, 2025, 2026)).toBe(false);
    expect(canAddRosterUser(true, false, null, 2026)).toBe(false);
  });

  it("PREPARING에서도 기존 사용자 추가를 유지한다", () => {
    expect(canAddRosterUser(true, true, null, null)).toBe(true);
  });

  it("읽기 관리자는 준비 상태와 관계없이 추가할 수 없다", () => {
    expect(canAddRosterUser(false, true, null, null)).toBe(false);
    expect(canAddRosterUser(false, false, 2026, 2026)).toBe(false);
  });
});
