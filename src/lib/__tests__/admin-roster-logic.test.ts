import { describe, expect, it } from "vitest";
import type { ImportPreview, Profile, RowChange } from "@/lib/academic-year/contracts";
import {
  canCommitImport,
  commitBlocks,
  importReducer,
  initialImportSession,
  newRowTokens,
  unresolvedConflicts,
  type ImportSession,
} from "@/lib/admin-roster/import-state";
import {
  clearedFields,
  countByKind,
  countByRole,
  deactivateReasons,
  rowIssueText,
  YEAR_STATE_LABEL,
} from "@/lib/admin-roster/labels";
import { resolveOmissions } from "@/lib/admin-roster/omissions";
import { requestIdFor } from "@/lib/admin-roster/request-id";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    role: "STUDENT",
    name: "학생하나",
    grade: 1,
    classNum: 2,
    number: 3,
    gender: "MALE",
    subject: null,
    homeroom: null,
    position: null,
    ...overrides,
  };
}

function row(kind: RowChange["kind"], token: string, overrides: Partial<RowChange> = {}): RowChange {
  return {
    kind,
    token,
    input: {
      entryId: `entry-${token}`,
      userId: null,
      email: `${token}@example.posan.kr`,
      emailKey: `${token}@example.posan.kr`,
      profile: profile(),
      baseUserVersion: null,
      included: true,
    },
    before: null,
    issues: [],
    ...overrides,
  };
}

function preview(rows: RowChange[], overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    id: "import-1",
    year: 2027,
    controlVersion: 7,
    yearVersion: 2,
    scope: "PARTIAL",
    rows,
    missingUserIds: [],
    coveredRoles: ["STUDENT"],
    canCommit: true,
    ...overrides,
  };
}

function sessionWith(p: ImportPreview): ImportSession {
  return importReducer(initialImportSession, { type: "VALIDATE_OK", preview: p });
}

describe("requestIdFor", () => {
  it("같은 작업을 재시도하면 요청키를 재사용한다", () => {
    let counter = 0;
    const generate = () => `id-${++counter}`;

    const first = requestIdFor(null, "commit:import-1", generate);
    const retry = requestIdFor(first, "commit:import-1", generate);

    expect(retry).toBe(first);
    expect(retry.requestId).toBe("id-1");
  });

  it("대상이 바뀌면 새 요청키를 만든다", () => {
    let counter = 0;
    const generate = () => `id-${++counter}`;

    const first = requestIdFor(null, "commit:import-1", generate);
    const next = requestIdFor(first, "commit:import-2", generate);

    expect(next.requestId).toBe("id-2");
    expect(next.requestId).not.toBe(first.requestId);
  });
});

describe("import 상태 흐름", () => {
  it("검증을 시작하면 이전 확인이 모두 지워진다", () => {
    const withPreview = sessionWith(preview([row("NEW", "a")]));
    const confirmed = importReducer(withPreview, { type: "CONFIRM_ALL_NEW" });

    const restarted = importReducer(confirmed, { type: "VALIDATE_START" });

    expect(restarted.ui.stage).toBe("VALIDATING");
    expect(restarted.confirmedTokens).toEqual([]);
    expect(restarted.preview).toBeNull();
    expect(restarted.requestId).toBeNull();
  });

  it("파일·연도·범위가 바뀌면 초기 상태로 돌아간다", () => {
    const confirmed = importReducer(sessionWith(preview([row("NEW", "a")])), {
      type: "CONFIRM_ALL_NEW",
    });

    expect(importReducer(confirmed, { type: "RESET" })).toEqual(initialImportSession);
  });

  it("신규 행 확인을 토글한다", () => {
    const session = sessionWith(preview([row("NEW", "a"), row("NEW", "b")]));

    const one = importReducer(session, { type: "TOGGLE_NEW", token: "a" });
    expect(one.confirmedTokens).toEqual(["a"]);

    const none = importReducer(one, { type: "TOGGLE_NEW", token: "a" });
    expect(none.confirmedTokens).toEqual([]);
  });

  it("미리보기가 갱신되면 사라진 행의 확인은 버린다", () => {
    const session = importReducer(sessionWith(preview([row("NEW", "a"), row("NEW", "b")])), {
      type: "CONFIRM_ALL_NEW",
    });

    const updated = importReducer(session, {
      type: "PREVIEW_UPDATED",
      preview: preview([row("NEW", "a")]),
    });

    expect(updated.confirmedTokens).toEqual(["a"]);
  });

  it("반영에 실패하면 미리보기로 돌아가되 요청키는 유지한다", () => {
    const session = importReducer(sessionWith(preview([row("CHANGED", "a")])), {
      type: "COMMIT_START",
      requestId: "req-1",
    });

    const failed = importReducer(session, { type: "COMMIT_FAIL", message: "잠시 후 다시" });

    expect(failed.ui.stage).toBe("PREVIEW");
    expect(failed.requestId).toBe("req-1");
    expect(failed.error).toBe("잠시 후 다시");
  });

  it("반영이 끝나면 영수증을 들고 완료로 간다", () => {
    const session = importReducer(sessionWith(preview([row("CHANGED", "a")])), {
      type: "COMMIT_START",
      requestId: "req-1",
    });

    const done = importReducer(session, {
      type: "COMMIT_OK",
      receipt: { requestId: "req-1", version: 8, changed: 1 },
    });

    expect(done.ui).toEqual({
      stage: "DONE",
      receipt: { requestId: "req-1", version: 8, changed: 1 },
    });
  });
});

describe("확정 가능 판정", () => {
  it("미리보기 전에는 확정할 수 없다", () => {
    expect(canCommitImport(initialImportSession)).toBe(false);
    expect(commitBlocks(initialImportSession)).toEqual(["NOT_PREVIEW"]);
  });

  it("확인하지 않은 신규 행이 있으면 막는다", () => {
    const session = sessionWith(preview([row("NEW", "a"), row("CHANGED", "b")]));

    expect(commitBlocks(session)).toEqual(["NEW_ROWS_UNCONFIRMED"]);
    expect(canCommitImport(importReducer(session, { type: "CONFIRM_ALL_NEW" }))).toBe(true);
  });

  it("선택하지 않은 충돌 행이 있으면 막는다", () => {
    const unresolved = sessionWith(preview([row("CONFLICT", "c", { server: profile() })]));
    expect(commitBlocks(unresolved)).toEqual(["CONFLICTS_UNRESOLVED"]);

    const resolved = sessionWith(
      preview([row("CONFLICT", "c", { server: profile(), resolution: "KEEP_SERVER" })]),
    );
    expect(canCommitImport(resolved)).toBe(true);
  });

  it("서버가 막으면 확정할 수 없다", () => {
    const session = sessionWith(preview([row("SAME", "a")], { canCommit: false }));
    expect(commitBlocks(session)).toEqual(["SERVER_BLOCKED"]);
  });

  it("누락 확인은 확정을 막지 않는다", () => {
    const session = sessionWith(
      preview([row("CHANGED", "a")], { scope: "FULL", missingUserIds: [11] }),
    );
    expect(canCommitImport(session)).toBe(true);
  });

  it("도우미가 신규 토큰과 미해결 충돌을 가려낸다", () => {
    const p = preview([row("NEW", "a"), row("CONFLICT", "c", { server: profile() })]);
    expect(newRowTokens(p)).toEqual(["a"]);
    expect(unresolvedConflicts(p).map((r) => r.token)).toEqual(["c"]);
  });
});

describe("누락 목록", () => {
  it("파일에 이미 들어온 사람은 누락으로 두 번 보이지 않는다", () => {
    const duplicate = row("REVIEW", "dup", {
      input: { ...row("REVIEW", "dup").input, userId: 11 },
    });
    const p = preview([duplicate], { scope: "FULL", missingUserIds: [11, 12, 12] });

    const omissions = resolveOmissions(p, (id) => (id === 12 ? "김빠짐" : undefined));

    expect(omissions).toEqual([{ userId: 12, name: "김빠짐" }]);
  });

  it("이름을 찾지 못해도 빈칸을 보여 주지 않는다", () => {
    const p = preview([], { scope: "FULL", missingUserIds: [99] });
    expect(resolveOmissions(p, () => undefined)).toEqual([
      { userId: 99, name: "이름 확인 필요" },
    ]);
  });
});

describe("표시 문구", () => {
  it("이용 중단 사유는 역할이 받는 값만 준다", () => {
    expect(deactivateReasons("STUDENT").map((r) => r.value)).toEqual([
      "GRADUATED",
      "TRANSFERRED",
    ]);
    expect(deactivateReasons("TEACHER").map((r) => r.value)).toEqual([
      "TRANSFERRED",
      "RETIRED",
    ]);
  });

  it("학년도 상태를 우리말로 보여 준다", () => {
    expect(YEAR_STATE_LABEL.ACTIVE).toBe("운영 중");
    expect(YEAR_STATE_LABEL.DRAFT).toBe("준비 중");
    expect(YEAR_STATE_LABEL.ARCHIVED).toBe("지난 학년도");
  });

  it("모르는 행 오류 코드는 서버 메시지를 그대로 쓴다", () => {
    expect(rowIssueText("INVALID_EMAIL", "무시됨")).toBe("이메일 형식이 올바르지 않습니다.");
    expect(rowIssueText("SOMETHING_NEW", "서버가 준 설명")).toBe("서버가 준 설명");
    expect(rowIssueText("SOMETHING_NEW", "   ")).toBe("SOMETHING_NEW");
  });

  it("종류별·역할별 건수를 센다", () => {
    const p = preview([
      row("NEW", "a"),
      row("NEW", "b"),
      row("CHANGED", "c", {
        input: { ...row("CHANGED", "c").input, profile: profile({ role: "TEACHER" }) },
      }),
    ]);

    expect(countByKind(p).NEW).toBe(2);
    expect(countByRole(p)).toEqual({ STUDENT: 2, TEACHER: 1 });
  });

  it("값을 비우게 되는 열을 찾아낸다", () => {
    const changed = row("CHANGED", "a", {
      before: profile({ homeroom: "1-2", position: "부장" }),
      input: {
        ...row("CHANGED", "a").input,
        profile: profile({ homeroom: null, position: "부장" }),
      },
    });

    expect(clearedFields(changed)).toEqual(["담임"]);
    expect(clearedFields(row("NEW", "b"))).toEqual([]);
  });
});
