"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LegacyAdminUser, RosterViewRow } from "@/hooks/useAcademicRoster";
import { ADMIN_LEVEL_LABEL, deactivateReasons } from "@/lib/admin-roster/labels";

const PANEL = "max-h-[calc(100svh-1rem)] overflow-y-auto overscroll-contain sm:max-w-md";

export type AccountTarget = { row: RosterViewRow; account: LegacyAdminUser };

type EmailDialogProps = {
  target: AccountTarget | null;
  onClose: () => void;
  onSubmit: (target: AccountTarget, email: string) => Promise<boolean>;
};

export function EmailChangeDialog({ target, onClose, onSubmit }: EmailDialogProps) {
  const [email, setEmail] = useState(target?.account.email ?? "");
  const [busy, setBusy] = useState(false);

  const open = target !== null;
  const invalid = email.trim() === "" || !email.includes("@");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className={`${PANEL} top-4 translate-y-0 sm:top-1/2 sm:-translate-y-1/2`}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">이메일 변경</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground break-keep">
          {target?.row.profile.name}의 로그인 이메일을 바꿉니다. 바꾸면 이 사람의 로그인이 끊기고,
          새 이메일로 다시 로그인해야 합니다. 명부 칸에서는 이메일을 고칠 수 없습니다.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="roster-email">새 이메일</Label>
          <Input
            id="roster-email"
            type="email"
            inputMode="email"
            className="h-11 rounded-xl text-base"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            className="min-h-11 whitespace-nowrap"
            disabled={invalid || busy || target === null}
            onClick={async () => {
              if (target === null) return;
              setBusy(true);
              const ok = await onSubmit(target, email.trim());
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {busy ? "바꾸는 중…" : "이메일 바꾸기"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AccessDialogProps = {
  target: AccountTarget | null;
  isMain: boolean;
  onClose: () => void;
  onSubmit: (
    target: AccountTarget,
    input: { state: "ACTIVE" | "INACTIVE"; reason: string; confirmPrivileges: boolean },
  ) => Promise<boolean>;
};

export function AccessChangeDialog({ target, isMain, onClose, onSubmit }: AccessDialogProps) {
  const [reason, setReason] = useState("");
  const [confirmPrivileges, setConfirmPrivileges] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = target !== null;
  const reactivating = target?.account.accessState === "INACTIVE";
  const reasons = target ? deactivateReasons(target.row.profile.role) : [];
  const hasPrivileges = target !== null && target.account.adminLevel !== "NONE";
  const ready = reactivating
    ? isMain && confirmPrivileges
    : reason !== "" && (!hasPrivileges || confirmPrivileges);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className={PANEL}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">
            {reactivating ? "이용 재개" : "이용 중단"}
          </DialogTitle>
        </DialogHeader>

        {reactivating ? (
          <p className="text-sm text-muted-foreground break-keep">
            {target?.row.profile.name}의 이용을 다시 엽니다. 얼굴 등록은 되살아나지 않으므로 본인이
            다시 동의하고 등록해야 합니다.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground break-keep">
              {target?.row.profile.name}의 이용을 중단합니다. 로그인과 체크인이 막히고,
              <strong className="text-foreground"> 얼굴 등록이 삭제됩니다.</strong> 식사 기록은
              그대로 보존됩니다.
            </p>
            <div className="grid gap-2">
              <Label className="whitespace-nowrap">사유</Label>
              <div className="flex flex-wrap gap-2">
                {reasons.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={reason === option.value ? "default" : "outline"}
                    className="min-h-11 whitespace-nowrap"
                    onClick={() => setReason(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            {hasPrivileges && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
                <input
                  type="checkbox"
                  className="size-5 shrink-0"
                  checked={confirmPrivileges}
                  onChange={(event) => setConfirmPrivileges(event.target.checked)}
                />
                <span>
                  이 사람은 관리자 권한({ADMIN_LEVEL_LABEL[target?.account.adminLevel ?? "NONE"]})이
                  있습니다. 그래도 이용을 중단합니다.
                </span>
              </label>
            )}
          </>
        )}

        {reactivating && !isMain && (
          <p className="text-sm text-amber-700 break-keep">
            이용 재개는 메인 관리자만 할 수 있습니다.
          </p>
        )}
        {reactivating && isMain && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
            <input type="checkbox" className="size-5 shrink-0" checked={confirmPrivileges}
              onChange={(event) => setConfirmPrivileges(event.target.checked)} />
            현재 권한({ADMIN_LEVEL_LABEL[target?.account.adminLevel ?? "NONE"]})을 확인했으며 이 권한으로 이용을 재개합니다.
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            className="min-h-11 whitespace-nowrap"
            disabled={!ready || busy || target === null}
            onClick={async () => {
              if (target === null) return;
              setBusy(true);
              const ok = await onSubmit(target, {
                state: reactivating ? "ACTIVE" : "INACTIVE",
                reason: reactivating ? "REACTIVATED" : reason,
                confirmPrivileges,
              });
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {reactivating ? "이용 재개" : "이용 중단"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PermissionsDialogProps = {
  target: AccountTarget | null;
  onClose: () => void;
  onSubmit: (target: AccountTarget, level: "NONE" | "SUBADMIN" | "ADMIN") => Promise<boolean>;
};

export function PermissionsDialog({ target, onClose, onSubmit }: PermissionsDialogProps) {
  const [level, setLevel] = useState<"NONE" | "SUBADMIN" | "ADMIN">(target?.account.adminLevel ?? "NONE");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className={PANEL}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">관리자 권한</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground break-keep">
          {target?.row.profile.name}의 권한 등급을 바꿉니다. 바꾸는 즉시 이 사람의 기존 로그인이
          끊깁니다.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["NONE", "SUBADMIN", "ADMIN"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              variant={level === option ? "default" : "outline"}
              className="min-h-11 whitespace-nowrap"
              onClick={() => setLevel(option)}
            >
              {ADMIN_LEVEL_LABEL[option]}
            </Button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            className="min-h-11 whitespace-nowrap"
            disabled={busy || target === null || level === target?.account.adminLevel}
            onClick={async () => {
              if (target === null) return;
              setBusy(true);
              const ok = await onSubmit(target, level);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            권한 바꾸기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
