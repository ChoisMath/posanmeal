"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createDraftController } from "@/lib/admin-roster/rollover-draft-controller";

export type CreateDraftDialogProps = {
  open: boolean;
  activeYear: number;
  controlVersion: number;
  onCreated: (year: number) => void;
  onClose: () => void;
};

export function CreateDraftDialog(props: CreateDraftDialogProps) {
  return props.open ? <CreateDraftSession key={props.activeYear} {...props} /> : null;
}

function CreateDraftSession({ activeYear, controlVersion, onCreated, onClose }: CreateDraftDialogProps) {
  const { mutate } = useSWRConfig();
  const [controller] = useState(() => createDraftController({ activeYear, controlVersion,
    onChanged: () => { void mutate("/api/admin/academic-years"); },
    onCreated: (year) => {
      toast.success(`${year}학년도 초안을 만들었습니다. Excel로 새 학급과 업무를 준비하세요.`);
      onCreated(year);
    },
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.mount();
    return () => controller.dispose();
  }, [controller]);
  function close() {
    if (controller.getSnapshot().pending) return;
    controller.dispose();
    onClose();
  }
  const busy = state.stage === "BUSY" || state.stage === "RELOADING";

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent showCloseButton={!state.pending} className="flex max-h-[calc(100svh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-none flex-col overflow-hidden p-2 sm:max-w-lg sm:p-3 lg:p-4">
      <DialogHeader>
        <DialogTitle className="whitespace-nowrap">{activeYear + 1}학년도 초안 만들기</DialogTitle>
        <DialogDescription className="break-keep">현재 운영 중인 {activeYear}학년도 학생·교사 명부를 복사하여 다음 학년도를 준비합니다.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain text-sm break-keep">
        <p>초안에서는 Excel을 내려받아 새 학년·반·번호와 교사 업무를 수정하고, 신규 학생·교사를 추가할 수 있습니다.</p>
        <p>현재 운영 명부와 로그인 계정은 그대로 유지됩니다. 전체 대조와 누락자 결정을 마친 후 메인 관리자가 전환을 실행해야 새 학년도로 운영됩니다.</p>
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
        {state.pending && <p className="text-muted-foreground">요청 결과를 확인한 뒤 창을 닫을 수 있습니다.</p>}
        {busy && <p role="status">{state.stage === "RELOADING" ? "최신 학년도 상태를 확인하고 있습니다…" : "현재 명부를 복사하고 있습니다…"}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
        <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={state.pending} onClick={close}>닫기</Button>
        {state.stage === "BLOCKED" && <Button variant="outline" className="min-h-11 whitespace-nowrap"
          onClick={() => void controller.refresh()}>학년도 상태 다시 확인</Button>}
        {state.stage !== "DONE" && <Button className="min-h-11 whitespace-nowrap" disabled={state.stage !== "READY"}
          onClick={() => void controller.create()}>{state.pending ? "같은 요청으로 결과 확인" : "현재 명부를 복사해 초안 생성"}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
