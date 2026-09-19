import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/academic-year/contracts";
import { archiveDeleteAttempt, archivedCorrectionAttempt } from "@/lib/admin-roster/archive-actions";
import { rosterProfileWith } from "@/lib/admin-roster/profile-edit";

const profile: Profile = { role: "STUDENT", name: "원래이름", grade: 1, classNum: 2, number: 3,
  gender: "MALE", subject: null, homeroom: null, position: null };
const row = { userId: 10, version: 2, email: "student@example.posan.kr", profile };

describe("지난 명부 삭제 요청", () => {
  it("응답 유실 후 최신 버전이 도착해도 재시도는 원래 요청키·버전·선택을 유지한다", () => {
    let sequence = 0;
    const generate = () => `request-${++sequence}`;
    const first = archiveDeleteAttempt(null, 2025, 4, ["b", "a", "a"], 2, generate);
    const retry = archiveDeleteAttempt(first, 2025, 9, ["a", "b"], 2, generate);
    expect(retry).toBe(first);
    expect(retry.body).toEqual({ requestId: "request-1", expectedVersion: 4, entryIds: ["a", "b"] });
  });

  it("전체 삭제 재시도는 원래 확인한 대상 수를 유지한다", () => {
    const first = archiveDeleteAttempt(null, 2025, 4, "ALL", 123);
    const retry = archiveDeleteAttempt(first, 2025, 5, "ALL", 0);
    expect(retry).toBe(first);
    expect(retry.count).toBe(123);
  });

  it("선택·학년도가 바뀌거나 명시적으로 새 검토를 하면 새 요청을 만든다", () => {
    let sequence = 0;
    const generate = () => `request-${++sequence}`;
    const first = archiveDeleteAttempt(null, 2025, 4, ["a"], 1, generate);
    expect(archiveDeleteAttempt(first, 2025, 4, "ALL", 1, generate).body.requestId).toBe("request-2");
    expect(archiveDeleteAttempt(first, 2024, 4, ["a"], 1, generate).body.requestId).toBe("request-3");
    expect(archiveDeleteAttempt(null, 2025, 5, ["a"], 1, generate).body.expectedVersion).toBe(5);
  });
});

describe("보존 기록 정정 요청", () => {
  it("응답 유실 뒤 재시도는 갱신된 행으로 payload를 갈아 끼우지 않는다", () => {
    const first = archivedCorrectionAttempt(null, 2025, row, "name", "정정이름", () => "correction-1");
    const updated = { ...row, version: 3, profile: { ...profile, classNum: 4 } };
    const retry = archivedCorrectionAttempt(first, 2025, updated, "name", "정정이름");
    expect(retry).toBe(first);
    expect(retry.body.expectedRowVersion).toBe(2);
    expect(retry.body.profile).toMatchObject({ name: "정정이름", classNum: 2 });
    expect(retry.body).not.toHaveProperty("entryId");
  });

  it("다른 대상·입력은 새 요청이 되고 원본 프로필은 변경하지 않는다", () => {
    const first = archivedCorrectionAttempt(null, 2025, row, "name", "정정이름", () => "correction-1");
    const changed = archivedCorrectionAttempt(first, 2025, row, "name", "다른이름", () => "correction-2");
    expect(changed.body.requestId).toBe("correction-2");
    expect(row.profile.name).toBe("원래이름");
  });

  it("숫자 소속과 빈 교사 업무를 기존 프로필 계약에 맞게 정정한다", () => {
    expect(rosterProfileWith(profile, "classNum", " 4 ").classNum).toBe(4);
    expect(rosterProfileWith({ ...profile, homeroom: "1-2" }, "homeroom", " ").homeroom).toBeNull();
  });
});
