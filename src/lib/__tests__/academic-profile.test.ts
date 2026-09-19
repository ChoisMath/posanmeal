import { describe, expect, it } from "vitest";
import { isDomainError } from "@/lib/academic-year/errors";
import { normalizeEmail, parseProfile } from "@/lib/academic-year/profile-schema";

function expectRejected(input: unknown): void {
  try {
    parseProfile(input);
  } catch (error) {
    expect(isDomainError(error)).toBe(true);
    return;
  }
  throw new Error("검증이 통과되면 안 되는 입력입니다.");
}

describe("normalizeEmail", () => {
  it("absorbs surrounding space and letter case only", () => {
    expect(normalizeEmail("  Student.One@Example.KR ")).toBe("student.one@example.kr");
  });

  it("keeps provider specific dots and aliases as written", () => {
    expect(normalizeEmail("a.b+tag@gmail.com")).toBe("a.b+tag@gmail.com");
  });
});

describe("parseProfile — student", () => {
  const base = { role: "STUDENT", name: " 학생하나 ", grade: 2, classNum: 3, number: 7, gender: "MALE" };

  it("trims the name and nulls the teacher only columns", () => {
    expect(parseProfile(base)).toEqual({
      role: "STUDENT",
      name: "학생하나",
      grade: 2,
      classNum: 3,
      number: 7,
      gender: "MALE",
      subject: null,
      homeroom: null,
      position: null,
    });
  });

  it("drops teacher fields that arrive on a student row", () => {
    expect(parseProfile({ ...base, subject: "수학", homeroom: "1-1", position: "부장" })).toMatchObject({
      subject: null,
      homeroom: null,
      position: null,
    });
  });

  it("refuses a grade outside 1~3", () => {
    expectRejected({ ...base, grade: 4 });
    expectRejected({ ...base, grade: 0 });
  });

  it("refuses a non positive class or number", () => {
    expectRejected({ ...base, classNum: 0 });
    expectRejected({ ...base, number: -1 });
    expectRejected({ ...base, number: 1.5 });
  });

  it("requires a name and a gender", () => {
    expectRejected({ ...base, name: "   " });
    expectRejected({ ...base, gender: null });
    expectRejected({ ...base, gender: "OTHER" });
  });
});

describe("parseProfile — teacher", () => {
  const base = { role: "TEACHER", name: "교사하나" };

  it("nulls the student only columns and empty text", () => {
    expect(parseProfile({ ...base, subject: "  ", homeroom: "", position: " 부장 " })).toEqual({
      role: "TEACHER",
      name: "교사하나",
      grade: null,
      classNum: null,
      number: null,
      gender: null,
      subject: null,
      homeroom: null,
      position: "부장",
    });
  });

  it("accepts a homeroom of the grade-class shape", () => {
    expect(parseProfile({ ...base, homeroom: " 3-12 " }).homeroom).toBe("3-12");
  });

  it("refuses a homeroom that is not grade-class", () => {
    expectRejected({ ...base, homeroom: "4-1" });
    expectRejected({ ...base, homeroom: "1-0" });
    expectRejected({ ...base, homeroom: "담임" });
  });

  it("keeps an explicit gender and allows none", () => {
    expect(parseProfile({ ...base, gender: "FEMALE" }).gender).toBe("FEMALE");
    expect(parseProfile({ ...base, gender: null }).gender).toBeNull();
  });

  it("refuses an unknown role", () => {
    expectRejected({ role: "ADMIN", name: "관리자" });
    expectRejected(null);
  });
});
