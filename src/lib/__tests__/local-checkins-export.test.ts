// src/lib/__tests__/local-checkins-export.test.ts
import { describe, expect, it } from "vitest";
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
