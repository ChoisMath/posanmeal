import type { ImportPreview, MutationReceipt, RowChange } from "@/lib/academic-year/contracts";

export type ImportUiState =
  | { stage: "SELECT" }
  | { stage: "VALIDATING" }
  | { stage: "PREVIEW"; preview: ImportPreview; confirmedTokens: string[]; omissionsConfirmed: boolean }
  | { stage: "COMMITTING"; requestId: string }
  | { stage: "DONE"; receipt: MutationReceipt };

export type ImportSession = {
  token: number;
  year: number | null;
  resolving: boolean;
  ui: ImportUiState;
  preview: ImportPreview | null;
  confirmedTokens: string[];
  omissionsConfirmed: boolean;
  requestId: string | null;
  error: string | null;
};

export type ImportAction =
  | { type: "RESET" }
  | { type: "VALIDATE_START"; year: number }
  | { type: "VALIDATE_OK"; preview: ImportPreview; token: number; year: number }
  | { type: "VALIDATE_FAIL"; message: string; token: number }
  | { type: "PREVIEW_UPDATED"; preview: ImportPreview; token: number; year: number }
  | { type: "RESOLVE_START" }
  | { type: "RESOLVE_FAIL"; token: number; previewId: string; message: string }
  | { type: "TOGGLE_NEW"; token: string }
  | { type: "CONFIRM_ALL_NEW" }
  | { type: "SET_OMISSIONS"; confirmed: boolean }
  | { type: "COMMIT_START"; requestId: string }
  | { type: "COMMIT_OK"; receipt: MutationReceipt; token: number; requestId: string }
  | { type: "COMMIT_FAIL"; message: string; token: number; requestId: string };

export const initialImportSession: ImportSession = {
  token: 0,
  year: null,
  resolving: false,
  ui: { stage: "SELECT" },
  preview: null,
  confirmedTokens: [],
  omissionsConfirmed: false,
  requestId: null,
  error: null,
};

function isStale(
  session: ImportSession,
  action: { token: number; year?: number; preview?: ImportPreview },
): boolean {
  return action.token !== session.token ||
    (action.year !== undefined && action.year !== session.year) ||
    (action.preview !== undefined && action.preview.year !== session.year);
}

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
    resolving: false,
    error: null,
  };
}

export function importReducer(session: ImportSession, action: ImportAction): ImportSession {
  switch (action.type) {
    case "RESET":
      return { ...initialImportSession, token: session.token + 1 };

    case "VALIDATE_START":
      return {
        ...initialImportSession,
        token: session.token + 1,
        year: action.year,
        ui: { stage: "VALIDATING" },
      };

    case "VALIDATE_OK":
      if (session.ui.stage !== "VALIDATING" || isStale(session, action)) return session;
      return previewStage(session, action.preview);

    case "VALIDATE_FAIL":
      if (session.ui.stage !== "VALIDATING" || isStale(session, action)) return session;
      return {
        ...initialImportSession,
        token: session.token,
        ui: { stage: "SELECT" },
        error: action.message,
      };

    case "PREVIEW_UPDATED":
      if (session.ui.stage !== "PREVIEW" || isStale(session, action) ||
        action.preview.id !== session.preview?.id) return session;
      return previewStage(session, action.preview);

    case "RESOLVE_START":
      if (session.ui.stage !== "PREVIEW" || session.resolving) return session;
      return { ...session, resolving: true, error: null };

    case "RESOLVE_FAIL":
      if (session.ui.stage !== "PREVIEW" || isStale(session, action) ||
        action.previewId !== session.preview?.id) return session;
      return {
        ...session,
        resolving: false,
        error: action.message,
        preview: { ...session.ui.preview, canCommit: false },
        ui: { ...session.ui, preview: { ...session.ui.preview, canCommit: false } },
      };

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
      if (!canCommitImport(session)) return session;
      return {
        ...session,
        ui: { stage: "COMMITTING", requestId: action.requestId },
        requestId: action.requestId,
        error: null,
      };

    case "COMMIT_OK":
      if (session.ui.stage !== "COMMITTING" || isStale(session, action) ||
        action.requestId !== session.requestId || action.receipt.requestId !== session.requestId) return session;
      return { ...session, ui: { stage: "DONE", receipt: action.receipt }, error: null };

    case "COMMIT_FAIL": {
      if (session.ui.stage !== "COMMITTING" || isStale(session, action) ||
        action.requestId !== session.requestId) return session;
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
  | "SELECTION_PENDING"
  | "SERVER_BLOCKED"
  | "NEW_ROWS_UNCONFIRMED"
  | "CONFLICTS_UNRESOLVED";

/** 확정 버튼을 막는 이유. 없으면 빈 배열이고, 그때만 버튼을 연다. */
export function commitBlocks(session: ImportSession): CommitBlock[] {
  if (session.ui.stage !== "PREVIEW") return ["NOT_PREVIEW"];
  const { preview, confirmedTokens } = session.ui;

  const blocks: CommitBlock[] = [];
  if (session.resolving) blocks.push("SELECTION_PENDING");
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
