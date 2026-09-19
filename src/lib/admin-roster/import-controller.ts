import type { ImportPreview, ImportScope } from "@/lib/academic-year/contracts";
import { canCommitImport, importReducer, initialImportSession, type ImportAction, type ImportUiState } from "./import-state";
import { requestJson, sendMutation } from "./mutate";
import { requestIdFor, type RequestIdSlot } from "./request-id";

type PreviewCopy = {
  preview: ImportPreview;
  pending: Promise<unknown> | null;
  committed: boolean;
  cleanup: Promise<void> | null;
};

type ImportControllerOptions = {
  year: number;
  scope: ImportScope;
  onCommitted: () => void;
  onError: (message: string) => void;
};

export function createImportController({ year, scope, onCommitted, onError }: ImportControllerOptions) {
  let session = initialImportSession;
  let disposed = false;
  let copy: PreviewCopy | null = null;
  let commitSlot: RequestIdSlot | null = null;
  const listeners = new Set<() => void>();
  const importUrl = `/api/admin/academic-years/${year}/imports`;

  function dispatch(action: ImportAction) {
    const next = importReducer(session, action);
    if (next === session) return;
    session = next;
    for (const listener of listeners) listener();
  }

  function discard(target: PreviewCopy | null): Promise<void> {
    if (target === null || target.committed) return Promise.resolve();
    target.cleanup ??= (async () => {
      // PATCH가 끝나기 전에 지우면 늦은 PATCH가 취소된 사본의 내용을 다시 채울 수 있다.
      await target.pending;
      if (target.committed) return;
      await requestJson(
        `/api/admin/academic-years/${target.preview.year}/imports/${target.preview.id}`,
        { method: "DELETE", keepalive: true },
        "미리보기를 지우지 못했습니다.",
      );
    })();
    return target.cleanup;
  }

  function reset(): Promise<void> {
    const previous = copy;
    copy = null;
    commitSlot = null;
    dispatch({ type: "RESET" });
    return discard(previous);
  }

  function isCurrent(token: number, stage?: ImportUiState["stage"]): boolean {
    return !disposed && session.token === token && (stage === undefined || session.ui.stage === stage);
  }

  async function validate(file: File): Promise<void> {
    if (disposed || session.ui.stage === "VALIDATING" || session.ui.stage === "COMMITTING") return;
    void reset();
    dispatch({ type: "VALIDATE_START", year });
    const token = session.token;
    const form = new FormData();
    form.set("file", file);
    form.set("scope", scope);
    const result = await requestJson<{ preview: ImportPreview }>(
      importUrl, { method: "POST", body: form }, "파일을 읽지 못했습니다.",
    );
    if (!result.ok) {
      if (isCurrent(token)) dispatch({ type: "VALIDATE_FAIL", token, message: result.message });
      return;
    }
    const created: PreviewCopy = { preview: result.data.preview, pending: null, committed: false, cleanup: null };
    if (!isCurrent(token, "VALIDATING")) {
      await discard(created);
      return;
    }
    if (created.preview.year !== year || created.preview.scope !== scope) {
      dispatch({ type: "VALIDATE_FAIL", token, message: "미리보기의 학년도나 반영 범위가 다릅니다. 파일을 다시 확인하세요." });
      await discard(created);
      return;
    }
    copy = created;
    dispatch({ type: "VALIDATE_OK", token, year, preview: created.preview });
  }

  async function resolve(rowToken: string, resolution: "USE_FILE" | "KEEP_SERVER"): Promise<void> {
    if (disposed || copy === null || session.ui.stage !== "PREVIEW" || session.resolving) return;
    const target = copy;
    const token = session.token;
    dispatch({ type: "RESOLVE_START" });
    const pending = requestJson<{ preview: ImportPreview }>(
      `${importUrl}/${target.preview.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choices: [{ token: rowToken, resolution }] }) },
      "선택을 저장하지 못했습니다.",
    );
    target.pending = pending;
    const result = await pending;
    target.pending = null;
    if (!isCurrent(token, "PREVIEW") || copy !== target) return;
    if (!result.ok) {
      dispatch({ type: "RESOLVE_FAIL", token, previewId: target.preview.id, message: result.message });
      onError(result.message);
      return;
    }
    if (result.data.preview.id !== target.preview.id || result.data.preview.year !== year || result.data.preview.scope !== scope) {
      dispatch({ type: "RESOLVE_FAIL", token, previewId: target.preview.id, message: "다른 미리보기 응답을 받았습니다. 파일을 다시 올려 주세요." });
      return;
    }
    target.preview = result.data.preview;
    dispatch({ type: "PREVIEW_UPDATED", token, year, preview: result.data.preview });
  }

  async function commit(): Promise<void> {
    if (disposed || copy === null || session.ui.stage !== "PREVIEW" || !canCommitImport(session)) return;
    const target = copy;
    const token = session.token;
    const { preview, confirmedTokens, omissionsConfirmed } = session.ui;
    const key = [preview.id, preview.controlVersion, [...confirmedTokens].sort().join(","), omissionsConfirmed].join("|");
    const slot = requestIdFor(commitSlot, key);
    commitSlot = slot;
    dispatch({ type: "COMMIT_START", requestId: slot.requestId });
    const pending = sendMutation(
      `${importUrl}/${preview.id}/commit`, "POST",
      { requestId: slot.requestId, expectedVersion: preview.controlVersion,
        confirmedNewRowTokens: confirmedTokens, omissionsConfirmed },
      "반영하지 못했습니다.",
    ).then((result) => {
      if (result.ok) target.committed = true;
      return result;
    });
    target.pending = pending;
    const result = await pending;
    target.pending = null;
    if (!result.ok) {
      if (isCurrent(token)) {
        dispatch({ type: "COMMIT_FAIL", token, requestId: slot.requestId, message: result.message });
        if (result.conflict) onError(`${result.message} 파일을 다시 올려 미리보기를 새로 만드세요.`);
      }
      return;
    }
    if (isCurrent(token)) dispatch({ type: "COMMIT_OK", token, requestId: slot.requestId, receipt: result.data.receipt });
    onCommitted();
  }

  return {
    getSnapshot: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    activate: () => { disposed = false; },
    dispose: () => { disposed = true; return reset(); },
    reset,
    validate,
    resolve,
    commit,
    confirm: (action: Extract<ImportAction, { type: "TOGGLE_NEW" | "CONFIRM_ALL_NEW" | "SET_OMISSIONS" }>) => dispatch(action),
  };
}
