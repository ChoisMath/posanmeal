import type { ImportPreview, MutationReceipt, RowChange } from "@/lib/academic-year/contracts";

export type ImportUiState =
  | { stage: "SELECT" }
  | { stage: "VALIDATING" }
  | { stage: "PREVIEW"; preview: ImportPreview; confirmedTokens: string[]; omissionsConfirmed: boolean }
  | { stage: "COMMITTING"; requestId: string }
  | { stage: "DONE"; receipt: MutationReceipt };

/**
 * 화면이 들고 다니는 전체 상태. `ui`는 계약에 정해진 단계 그대로이고, 반영 중
 * 실패해 미리보기로 돌아갈 때 필요한 값만 옆에 둔다 — 단계 타입에 되돌아갈
 * 자리를 만들지 않으려고 분리했다.
 */
export type ImportSession = {
  ui: ImportUiState;
  preview: ImportPreview | null;
  confirmedTokens: string[];
  omissionsConfirmed: boolean;
  requestId: string | null;
  error: string | null;
};

export type ImportAction =
  | { type: "RESET" }
  | { type: "VALIDATE_START" }
  | { type: "VALIDATE_OK"; preview: ImportPreview }
  | { type: "VALIDATE_FAIL"; message: string }
  | { type: "PREVIEW_UPDATED"; preview: ImportPreview }
  | { type: "TOGGLE_NEW"; token: string }
  | { type: "CONFIRM_ALL_NEW" }
  | { type: "SET_OMISSIONS"; confirmed: boolean }
  | { type: "COMMIT_START"; requestId: string }
  | { type: "COMMIT_OK"; receipt: MutationReceipt }
  | { type: "COMMIT_FAIL"; message: string };

export const initialImportSession: ImportSession = {
  ui: { stage: "SELECT" },
  preview: null,
  confirmedTokens: [],
  omissionsConfirmed: false,
  requestId: null,
  error: null,
};

function previewStage(session: ImportSession, preview: ImportPreview): ImportSession {
  // 미리보기가 다시 오면 사라진 행의 확인은 함께 버린다.
  const tokens = new Set(preview.rows.map((row) => row.token));
  const confirmedTokens = session.confirmedTokens.filter((token) => tokens.has(token));
  return {
    ...session,
    ui: {
      stage: "PREVIEW",
      preview,
      confirmedTokens,
      omissionsConfirmed: session.omissionsConfirmed,
    },
    preview,
    confirmedTokens,
    error: null,
  };
}

export function importReducer(session: ImportSession, action: ImportAction): ImportSession {
  switch (action.type) {
    case "RESET":
      return initialImportSession;

    case "VALIDATE_START":
      return { ...initialImportSession, ui: { stage: "VALIDATING" } };

    case "VALIDATE_OK":
      return previewStage({ ...initialImportSession }, action.preview);

    case "VALIDATE_FAIL":
      return { ...initialImportSession, ui: { stage: "SELECT" }, error: action.message };

    case "PREVIEW_UPDATED":
      if (session.preview === null) return session;
      return previewStage(session, action.preview);

    case "TOGGLE_NEW": {
      if (session.ui.stage !== "PREVIEW") return session;
      const confirmedTokens = session.confirmedTokens.includes(action.token)
        ? session.confirmedTokens.filter((token) => token !== action.token)
        : [...session.confirmedTokens, action.token];
      return {
        ...session,
        ui: { ...session.ui, confirmedTokens },
        confirmedTokens,
      };
    }

    case "CONFIRM_ALL_NEW": {
      if (session.ui.stage !== "PREVIEW") return session;
      const confirmedTokens = newRowTokens(session.ui.preview);
      return { ...session, ui: { ...session.ui, confirmedTokens }, confirmedTokens };
    }

    case "SET_OMISSIONS": {
      if (session.ui.stage !== "PREVIEW") return session;
      return {
        ...session,
        ui: { ...session.ui, omissionsConfirmed: action.confirmed },
        omissionsConfirmed: action.confirmed,
      };
    }

    case "COMMIT_START":
      if (session.ui.stage !== "PREVIEW") return session;
      return {
        ...session,
        ui: { stage: "COMMITTING", requestId: action.requestId },
        requestId: action.requestId,
        error: null,
      };

    case "COMMIT_OK":
      return { ...session, ui: { stage: "DONE", receipt: action.receipt }, error: null };

    case "COMMIT_FAIL": {
      if (session.preview === null) {
        return { ...session, ui: { stage: "SELECT" }, error: action.message };
      }
      return {
        ...session,
        // 요청키는 남긴다. 같은 반영을 다시 누르면 서버가 재전송으로 알아본다.
        ui: {
          stage: "PREVIEW",
          preview: session.preview,
          confirmedTokens: session.confirmedTokens,
          omissionsConfirmed: session.omissionsConfirmed,
        },
        error: action.message,
      };
    }
  }
}

export function newRowTokens(preview: ImportPreview): string[] {
  return preview.rows.filter((row) => row.kind === "NEW").map((row) => row.token);
}

export function unresolvedConflicts(preview: ImportPreview): RowChange[] {
  return preview.rows.filter((row) => row.kind === "CONFLICT" && row.resolution === undefined);
}

export type CommitBlock =
  | "NOT_PREVIEW"
  | "SERVER_BLOCKED"
  | "NEW_ROWS_UNCONFIRMED"
  | "CONFLICTS_UNRESOLVED";

/** 확정 버튼을 막는 이유. 없으면 빈 배열이고, 그때만 버튼을 연다. */
export function commitBlocks(session: ImportSession): CommitBlock[] {
  if (session.ui.stage !== "PREVIEW") return ["NOT_PREVIEW"];
  const { preview, confirmedTokens } = session.ui;

  const blocks: CommitBlock[] = [];
  if (!preview.canCommit) blocks.push("SERVER_BLOCKED");

  const confirmed = new Set(confirmedTokens);
  if (newRowTokens(preview).some((token) => !confirmed.has(token))) {
    blocks.push("NEW_ROWS_UNCONFIRMED");
  }
  if (unresolvedConflicts(preview).length > 0) blocks.push("CONFLICTS_UNRESOLVED");

  return blocks;
}

export function canCommitImport(session: ImportSession): boolean {
  return commitBlocks(session).length === 0;
}
