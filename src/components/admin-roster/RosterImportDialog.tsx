"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportScope } from "@/lib/academic-year/contracts";
import {
  canCommitImport,
  commitBlocks,
} from "@/lib/admin-roster/import-state";
import { createImportController } from "@/lib/admin-roster/import-controller";
import { resolveOmissions, type NameLookup } from "@/lib/admin-roster/omissions";
import { ImportPreviewPanel } from "./ImportPreviewPanel";

export type RosterImportDialogProps = {
  open: boolean;
  canImport?: boolean;
  templateControls?: ReactNode;
  year: number;
  scope: ImportScope;
  nameOf: NameLookup;
  onScopeChange: (scope: ImportScope) => void;
  onCommitted: () => void;
  onClose: () => void;
};

const PANEL =
  "max-h-[calc(100svh-1rem)] min-w-0 overflow-y-auto overscroll-contain w-full max-w-[calc(100%-1rem)] sm:max-w-2xl";

const BLOCK_TEXT: Record<string, string> = {
  SELECTION_PENDING: "충돌 선택을 저장하고 있습니다.",
  SERVER_BLOCKED: "파일에 아직 고쳐야 할 내용이 있어 반영할 수 없습니다.",
  NEW_ROWS_UNCONFIRMED: "새로 들어오는 사람을 모두 확인해야 반영할 수 있습니다.",
  CONFLICTS_UNRESOLVED: "충돌한 행마다 쓸 값을 골라야 반영할 수 있습니다.",
};

export function RosterImportDialog(props: RosterImportDialogProps) {
  return props.open ? <RosterImportSession key={`${props.year}:${props.scope}`} {...props} /> : null;
}

function RosterImportSession({
  open,
  canImport = true,
  templateControls,
  year,
  scope,
  nameOf,
  onScopeChange,
  onCommitted,
  onClose,
}: RosterImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [controller] = useState(() => createImportController({
    year, scope, onCommitted, onError: (message) => toast.error(message),
  }));
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const preview = session.preview;

  useEffect(() => {
    controller.activate();
    return () => { void controller.dispose(); };
  }, [controller]);

  function close(): void {
    void controller.dispose();
    onClose();
  }

  function changeScope(next: ImportScope): void {
    if (next === scope) return;
    void controller.reset();
    onScopeChange(next);
  }

  const blocks = commitBlocks(session);
  const blockText = blocks.map((block) => BLOCK_TEXT[block]).filter(Boolean);
  const omissions = preview === null ? [] : resolveOmissions(preview, nameOf);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className={PANEL}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">{year}학년도 Excel</DialogTitle>
        </DialogHeader>

        {templateControls}

        {!canImport ? <p className="text-sm text-muted-foreground">이 명부는 내려받기만 가능합니다.</p> : session.ui.stage === "DONE" ? (
          <div className="flex min-w-0 flex-col gap-3">
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
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="whitespace-nowrap">반영 범위</Label>
              <Button
                size="sm"
                variant={scope === "PARTIAL" ? "default" : "outline"}
                className="min-h-11 whitespace-nowrap"
                disabled={session.ui.stage === "COMMITTING"}
                onClick={() => changeScope("PARTIAL")}
              >
                일부 사용자 수정
              </Button>
              <Button
                size="sm"
                variant={scope === "FULL" ? "default" : "outline"}
                className="min-h-11 whitespace-nowrap"
                disabled={session.ui.stage === "COMMITTING"}
                onClick={() => changeScope("FULL")}
              >
                전체 명부 대조
              </Button>
            </div>

            <div className="grid min-w-0 gap-2">
              <Label htmlFor="roster-import-file" className="whitespace-nowrap">
                파일
              </Label>
              <Input
                id="roster-import-file"
                type="file"
                accept=".xlsx"
                className="h-11 min-w-0 rounded-xl text-base file:h-9"
                disabled={session.ui.stage === "COMMITTING"}
                onChange={(event) => {
                  void controller.reset();
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </div>

            {session.error && <p className="text-sm text-destructive break-keep">{session.error}</p>}

            {session.ui.stage === "PREVIEW" && preview && (
              <ImportPreviewPanel
                preview={preview}
                confirmedTokens={session.ui.confirmedTokens}
                omissions={omissions}
                omissionsConfirmed={session.ui.omissionsConfirmed}
                canConfirmOmissions={omissions.every((person) => nameOf(person.userId) !== undefined)}
                resolving={session.resolving}
                onToggleNew={(token) => controller.confirm({ type: "TOGGLE_NEW", token })}
                onConfirmAllNew={() => controller.confirm({ type: "CONFIRM_ALL_NEW" })}
                onResolve={(token, resolution) => void controller.resolve(token, resolution)}
                onToggleOmissions={(confirmed) => controller.confirm({ type: "SET_OMISSIONS", confirmed })}
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

            <div className="sticky bottom-0 -mb-4 flex flex-wrap justify-end gap-2 bg-popover pt-2 pb-4">
              <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={close}>
                취소
              </Button>
              <Button
                variant="outline"
                className="min-h-11 whitespace-nowrap"
                disabled={file === null || session.ui.stage === "VALIDATING" || session.ui.stage === "COMMITTING" || session.resolving}
                onClick={() => { if (file) void controller.validate(file); }}
              >
                {session.ui.stage === "VALIDATING" ? "검증 중…" : "미리보기 만들기"}
              </Button>
              <Button
                className="min-h-11 whitespace-nowrap"
                disabled={!canCommitImport(session) || session.ui.stage === "COMMITTING"}
                onClick={() => void controller.commit()}
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
