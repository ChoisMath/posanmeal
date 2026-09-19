import { describe, expect, it } from "vitest";
import type { AcademicProfile } from "@/lib/academic-year/contracts";
import { reportBucketOf, type ReportProfile } from "@/lib/academic-year/report-profile";

function profile(overrides: Partial<AcademicProfile>): AcademicProfile {
  return {
    role: "STUDENT",
    name: "대상",
    grade: 1,
    classNum: 1,
    number: 1,
    gender: null,
    subject: null,
    homeroom: null,
    position: null,
    year: 2026,
    userId: 1,
    memberState: "ENROLLED",
    version: 0,
    needsReview: false,
    ...overrides,
  };
}

function report(historical: AcademicProfile | null): ReportProfile {
  return {
    userId: historical?.userId ?? 1,
    year: 2026,
    historical,
    current: null,
    currentState: "",
    warning: historical ? null : "학년도 정보 확인 필요",
    fallbackName: historical ? null : "이름",
  };
}

describe("reportBucketOf", () => {
  it("교사는 teacher", () => {
    expect(reportBucketOf(report(profile({ role: "TEACHER", grade: null })))).toBe("teacher");
  });

  it("1~3학년 학생은 그 학년", () => {
    for (const grade of [1, 2, 3]) {
      expect(reportBucketOf(report(profile({ grade })))).toBe(String(grade));
    }
  });

  it("학년이 비어 있는 학생은 확인 필요", () => {
    expect(reportBucketOf(report(profile({ grade: null })))).toBe("unknown");
  });

  it("1~3 밖의 학년은 확인 필요", () => {
    expect(reportBucketOf(report(profile({ grade: 4 })))).toBe("unknown");
    expect(reportBucketOf(report(profile({ grade: 0 })))).toBe("unknown");
  });

  it("그 해 기록이 없으면 확인 필요", () => {
    expect(reportBucketOf(report(null))).toBe("unknown");
    expect(reportBucketOf(undefined)).toBe("unknown");
  });

  it("어떤 입력이든 정확히 한 묶음에만 든다", () => {
    const cases = [
      report(profile({ role: "TEACHER" })),
      report(profile({ grade: 1 })),
      report(profile({ grade: 2 })),
      report(profile({ grade: 3 })),
      report(profile({ grade: null })),
      report(profile({ grade: 9 })),
      report(null),
    ];
    for (const value of cases) {
      const bucket = reportBucketOf(value);
      expect(["teacher", "1", "2", "3", "unknown"]).toContain(bucket);
    }
  });
});
