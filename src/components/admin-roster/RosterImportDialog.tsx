"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportPreview, ImportScope, MutationReceipt } from "@/lib/academic-year/contracts";
import {
  canCommitImport,
  commitBlocks,
  importReducer,
  initialImportSession,
} from "@/lib/admin-roster/import-state";
import { requestJson, sendMutation } from "@/lib/admin-roster/mutate";
import { resolveOmissions, type NameLookup } from "@/lib/admin-roster/omissions";
import { requestIdFor, type RequestIdSlot } from "@/lib/admin-roster/request-id";
import { ImportPreviewPanel } from "./ImportPreviewPanel";

export type RosterImportDialogProps = {
  open: boolean;
  year: number;
  scope: ImportScope;
  nameOf: NameLookup;
  onScopeChange: (scope: ImportScope) => void;
  onCommitted: () => void;
  onClose: () => void;
};

const PANEL =
  "max-h-[calc(100svh-1rem)] overflow-y-auto overscroll-contain sm:max-w-2xl w-[calc(100%-1rem)]";

const BLOCK_TEXT: Record<string, string> = {
  SERVER_BLOCKED: "파일에 아직 고쳐야 할 내용이 있어 반영할 수 없습니다.",
  NEW_ROWS_UNCONFIRMED: "새로 들어오는 사람을 모두 확인해야 반영할 수 있습니다.",
  CONFLICTS_UNRESOLVED: "충돌한 행마다 쓸 값을 골라야 반영할 수 있습니다.",
};

export function RosterImportDialog({
  open,
  year,
  scope,
  nameOf,
  onScopeChange,
  onCommitted,
  onClose,
}: RosterImportDialogProps) {
  const [session, dispatch] = useReducer(importReducer, initialImportSession);
  const [file, setFile] = useState<File | null>(null);
  const [resolving, setResolving] = useState(false);
  const commitSlot = useRef<RequestIdSlot | null>(null);

  const preview = session.preview;

  // 파일·연도·범위가 바뀌면 미리보기와 확인·요청키를 모두 버린다.
  useEffect(() => {
    dispatch({ type: "RESET" });
    commitSlot.current = null;
  }, [year, scope, file]);

  /** 서버가 보관 중인 사본을 즉시 비운다. 이미 반영된 미리보기는 지울 것이 없다. */
  async function discardServerCopy(id: string | undefined): Promise<void> {
    if (id === undefined) return;
    await requestJson(
      `/api/admin/academic-years/${year}/imports/${id}`,
      { method: "DELETE" },
      "미리보기를 지우지 못했습니다.",
    );
  }

  function close(): void {
    if (session.ui.stage !== "DONE") void discardServerCopy(preview?.id);
    dispatch({ type: "RESET" });
    commitSlot.current = null;
    setFile(null);
    onClose();
  }

  async function validate(): Promise<void> {
    if (file === null) return;
    await discardServerCopy(preview?.id);
    dispatch({ type: "VALIDATE_START" });

    const form = new FormData();
    form.set("file", file);
    form.set("scope", scope);

    const result = await requestJson<{ preview: ImportPreview }>(
      `/api/admin/academic-years/${year}/imports`,
      { method: "POST", body: form },
      "파일을 읽지 못했습니다.",
    );

    if (!result.ok) {
      dispatch({ type: "VALIDATE_FAIL", message: result.message });
      return;
    }
    dispatch({ type: "VALIDATE_OK", preview: result.data.preview });
  }

  async function resolve(token: string, resolution: "USE_FILE" | "KEEP_SERVER"): Promise<void> {
    if (preview === null) return;
    setResolving(true);
    const result = await requestJson<{ preview: ImportPreview }>(
      `/api/admin/academic-years/${year}/imports/${preview.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choices: [{ token, resolution }] }),
      },
      "선택을 저장하지 못했습니다.",
    );
    setResolving(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    dispatch({ type: "PREVIEW_UPDATED", preview: result.data.preview });
  }

  async function commit(): Promise<void> {
    if (session.ui.stage !== "PREVIEW") return;
    const { preview: current, confirmedTokens, omissionsConfirmed } = session.ui;

    // 같은 미리보기·같은 확인 묶음이면 요청키를 재사용한다. 응답을 잃은 뒤 다시
    // 눌러도 서버가 재전송으로 알아보고 두 번 반영하지 않는다.
    const key = [
      current.id,
      current.controlVersion,
      [...confirmedTokens].sort().join(","),
      omissionsConfirmed,
    ].join("|");
    const slot = requestIdFor(commitSlot.current, key);
    commitSlot.current = slot;

    dispatch({ type: "COMMIT_START", requestId: slot.requestId });

    const result = await sendMutation(
      `/api/admin/academic-years/${year}/imports/${current.id}/commit`,
      "POST",
      {
        requestId: slot.requestId,
        expectedVersion: current.controlVersion,
        confirmedNewRowTokens: confirmedTokens,
        omissionsConfirmed,
      },
      "반영하지 못했습니다.",
    );

    if (!result.ok) {
      dispatch({ type: "COMMIT_FAIL", message: result.message });
      if (result.conflict) {
        // 최신 파일로 미리보기를 다시 만들어야 한다. 조용히 덮어쓰지 않는다.
        toast.error(`${result.message} 파일을 다시 올려 미리보기를 새로 만드세요.`);
      }
      return;
    }

    dispatch({ type: "COMMIT_OK", receipt: result.data.receipt as MutationReceipt });
    onCommitted();
  }

  const blocks = commitBlocks(session);
  const blockText = blocks.map((block) => BLOCK_TEXT[block]).filter(Boolean);
  const omissions = preview === null ? [] : resolveOmissions(preview, nameOf);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className={PANEL}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">{year}학년도 Excel 올리기</DialogTitle>
        </DialogHeader>

        {session.ui.stage === "DONE" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm break-keep">
              {session.ui.receipt.changed}건을 반영했습니다. 명부를 다시 불러왔습니다.
            </p>
            <div className="flex justify-end">
              <Button className="min-h-11 whitespace-nowrap" onClick={close}>
                닫기
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="whitespace-nowrap">반영 범위</Label>
              <Button
                size="sm"
                variant={scope === "PARTIAL" ? "default" : "outline"}
                className="min-h-11 whitespace-nowrap"
                onClick={() => onScopeChange("PARTIAL")}
              >
                일부 사용자 수정
              </Button>
              <Button
                size="sm"
                variant={scope === "FULL" ? "default" : "outline"}
                className="min-h-11 whitespace-nowrap"
                onClick={() => onScopeChange("FULL")}
              >
                전체 명부 대조
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="roster-import-file" className="whitespace-nowrap">
                파일
              </Label>
              <Input
                id="roster-import-file"
                type="file"
                accept=".xlsx"
                className="rounded-xl text-base"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            {session.error && <p className="text-sm text-destructive break-keep">{session.error}</p>}

            {session.ui.stage === "PREVIEW" && preview && (
              <ImportPreviewPanel
                preview={preview}
                confirmedTokens={session.ui.confirmedTokens}
                omissions={omissions}
                omissionsConfirmed={session.ui.omissionsConfirmed}
                resolving={resolving}
                onToggleNew={(token) => dispatch({ type: "TOGGLE_NEW", token })}
                onConfirmAllNew={() => dispatch({ type: "CONFIRM_ALL_NEW" })}
                onResolve={(token, resolution) => void resolve(token, resolution)}
                onToggleOmissions={(confirmed) => dispatch({ type: "SET_OMISSIONS", confirmed })}
              />
            )}

            {blockText.length > 0 && session.ui.stage === "PREVIEW" && (
              <ul className="text-sm text-amber-700 flex flex-col gap-1">
                {blockText.map((text) => (
                  <li key={text} className="break-keep">
                    {text}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={close}>
                취소
              </Button>
              <Button
                variant="outline"
                className="min-h-11 whitespace-nowrap"
                disabled={file === null || session.ui.stage === "VALIDATING"}
                onClick={() => void validate()}
              >
                {session.ui.stage === "VALIDATING" ? "검증 중…" : "미리보기 만들기"}
              </Button>
              <Button
                className="min-h-11 whitespace-nowrap"
                disabled={!canCommitImport(session) || session.ui.stage === "COMMITTING"}
                onClick={() => void commit()}
              >
                {session.ui.stage === "COMMITTING" ? "반영 중…" : "반영 확정"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
