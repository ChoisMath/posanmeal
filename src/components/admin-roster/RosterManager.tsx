"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { canAddRosterUser } from "@/lib/admin-roster/labels";
import type { SaveResult } from "@/components/EditableCell";
import type { ImportScope } from "@/lib/academic-year/contracts";
import { rosterProfileWith } from "@/lib/admin-roster/profile-edit";
import { sendMutation } from "@/lib/admin-roster/mutate";
import { requestIdFor, type RequestIdSlot } from "@/lib/admin-roster/request-id";
import {
  useAccountRows,
  useAcademicYears,
  useRoster,
  type RosterViewRow,
} from "@/hooks/useAcademicRoster";
import {
  AccessChangeDialog,
  EmailChangeDialog,
  PermissionsDialog,
  type AccountTarget,
} from "./RosterAccountDialogs";
import { RosterImportDialog } from "./RosterImportDialog";
import { RosterTable, type RosterField } from "./RosterTable";
import { RosterToolbar } from "./RosterToolbar";
import { CreateDraftDialog } from "./CreateDraftDialog";
import { RolloverDialog } from "./RolloverDialog";
import { ArchivedRosterDialog } from "./ArchivedRosterDialog";

export type RosterManagerProps = {
  canWrite: boolean;
  isMain: boolean;
  /** 학년도 기능이 아직 준비 중일 때 그대로 보여 줄 기존 사용자 목록. */
  legacyFallback: ReactNode;
  onAddUser?: (role?: "STUDENT" | "TEACHER") => void;
};

export function RosterManager({
  canWrite,
  isMain,
  legacyFallback,
  onAddUser,
}: RosterManagerProps) {
  const { mutate } = useSWRConfig();
  const years = useAcademicYears();
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [role, setRole] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [includeData, setIncludeData] = useState(true);
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [scope, setScope] = useState<ImportScope>("PARTIAL");
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<AccountTarget | null>(null);
  const [accessTarget, setAccessTarget] = useState<AccountTarget | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<AccountTarget | null>(null);
  const rowSlot = useRef<RequestIdSlot | null>(null);
  const accountSlot = useRef<RequestIdSlot | null>(null);

  // 고르지 않았으면 운영 중인 학년도를 본다. 상태를 따로 맞추지 않아야 목록이
  // 늦게 와도 화면이 한 번 더 그려지지 않는다.
  const selectedYear = pickedYear ?? years.activeYear?.year ?? null;
  const selected = years.years.find((year) => year.year === selectedYear) ?? null;
  const archived = selected?.state === "ARCHIVED";
  const nextDraft = years.years.find((year) => year.state === "DRAFT" && year.year === (years.activeYear?.year ?? 0) + 1);

  const roster = useRoster(selectedYear, role, { includeExcluded: selected?.state === "DRAFT" && canWrite && includeExcluded });
  const accountRows = useAccountRows(role);
  const importStudents = useRoster(importOpen ? selectedYear : null, "STUDENT", { includeExcluded: true });
  const importTeachers = useRoster(importOpen ? selectedYear : null, "TEACHER", { includeExcluded: true });
  const canAdd = canAddRosterUser(canWrite, years.notReady, selectedYear, years.activeYear?.year ?? null);

  const nameOf = useMemo(() => {
    const byId = new Map<number, string>();
    for (const row of [...roster.rows, ...importStudents.rows, ...importTeachers.rows]) {
      if (row.userId !== null) byId.set(row.userId, row.profile.name);
    }
    return (userId: number) => byId.get(userId);
  }, [roster.rows, importStudents.rows, importTeachers.rows]);

  function selectYear(year: number): void {
    setPickedYear(year);
    setCreateOpen(false);
    setRolloverOpen(false);
    setArchiveOpen(false);
    setImportOpen(false);
    setEmailTarget(null);
    setAccessTarget(null);
    setPermissionsTarget(null);
  }

  if (years.notReady) {
    return (
      <div className="flex flex-col gap-2 h-full min-h-0">
        <p className="text-sm text-muted-foreground break-keep">
          학년도 기능 준비 중 — 기존 사용자 관리만 사용할 수 있습니다.
        </p>
        {canAdd && onAddUser && (
          <Button className="min-h-11 w-fit whitespace-nowrap" onClick={() => onAddUser()}>추가</Button>
        )}
        {legacyFallback}
      </div>
    );
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([
      roster.mutate(), accountRows.mutate(), years.mutate(),
      importStudents.mutate(), importTeachers.mutate(),
      mutate((key) => typeof key === "string" && key.startsWith("/api/admin/checkins?")),
    ]);
  }

  async function saveField(
    row: RosterViewRow,
    field: RosterField,
    next: string,
  ): Promise<SaveResult> {
    if (selectedYear === null || row.userId === null) {
      return { ok: false, message: "이 행은 여기서 고칠 수 없습니다." };
    }

    const slot = requestIdFor(rowSlot.current, `row:${selectedYear}:${row.userId}:${field}:${next}`);
    rowSlot.current = slot;

    const result = await sendMutation(
      `/api/admin/academic-years/${selectedYear}/records/${row.userId}`,
      "PUT",
      {
        requestId: slot.requestId,
        expectedRowVersion: row.version,
        email: row.email,
        profile: rosterProfileWith(row.profile, field, next),
        ...(row.entryId ? { entryId: row.entryId } : {}),
      },
      "수정에 실패했습니다.",
    );

    if (!result.ok) {
      if (result.conflict) await refreshAll();
      return { ok: false, message: result.message };
    }

    rowSlot.current = null;
    await refreshAll();
    return { ok: true };
  }

  async function runAccountMutation(
    path: string,
    key: string,
    body: Record<string, unknown>,
    fallback: string,
  ): Promise<boolean> {
    const slot = requestIdFor(accountSlot.current, key);
    accountSlot.current = slot;

    const result = await sendMutation(path, "PUT", { ...body, requestId: slot.requestId }, fallback);
    if (!result.ok) {
      toast.error(result.message);
      if (result.conflict) {
        await refreshAll();
        setEmailTarget(null);
        setAccessTarget(null);
        setPermissionsTarget(null);
        accountSlot.current = null;
        toast.info("최신 내용을 확인한 뒤 변경 창을 다시 열어 주세요.");
      }
      return false;
    }

    accountSlot.current = null;
    await refreshAll();
    toast.success("변경했습니다.");
    return true;
  }

  function download(): void {
    if (selectedYear === null) return;
    const query = new URLSearchParams({ includeData: includeData ? "1" : "0" });
    if (archived && includeCurrent) query.set("includeCurrent", "1");
    window.location.href = `/api/admin/academic-years/${selectedYear}/template?${query.toString()}`;
  }

  return (
    <div className="flex flex-col gap-1 h-full min-h-0">
      <RosterToolbar
        years={years.years}
        selectedYear={selectedYear}
        selectedState={selected?.state ?? null}
        activeYear={years.activeYear?.year ?? null}
        role={role}
        canWrite={canWrite}
        includeData={includeData}
        includeCurrent={includeCurrent}
        includeExcluded={includeExcluded}
        canAdd={canAdd}
        onSelectYear={selectYear}
        onSelectRole={setRole}
        onToggleIncludeData={setIncludeData}
        onToggleIncludeCurrent={setIncludeCurrent}
        onToggleIncludeExcluded={setIncludeExcluded}
        onDownload={download}
        onOpenImport={() => setImportOpen(true)}
        onAddUser={onAddUser ? () => onAddUser(role) : undefined}
        rolloverAction={canWrite && years.activeYear && years.controlVersion !== null && <>
          <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={() => nextDraft ? selectYear(nextDraft.year) : setCreateOpen(true)}>
            {nextDraft ? "준비 중 명부 열기" : "다음 학년도 준비"}
          </Button>
          {selected?.state === "DRAFT" && <Button className="min-h-11 whitespace-nowrap" onClick={() => setRolloverOpen(true)}>학년도 전환 검토</Button>}
        </>}
        archivedAction={archived && <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={() => setArchiveOpen(true)}>지난 명부·표시 정보</Button>}
      />

      {years.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p className="break-keep">학년도 목록을 불러오지 못했습니다.</p>
          <Button variant="outline" className="min-h-11 whitespace-nowrap" onClick={() => void years.mutate()}>다시 불러오기</Button>
        </div>
      )}

      {roster.error && (
        <p className="text-sm text-destructive break-keep">명부를 불러오지 못했습니다.</p>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <RosterTable
          rows={roster.rows}
          role={role}
          accounts={accountRows.accounts}
          canWrite={canWrite && !archived}
          isMain={isMain}
          recordOnly={archived}
          onSaveField={saveField}
          onEditEmail={(row) => {
            const account = row.userId === null ? undefined : accountRows.accounts.get(row.userId);
            if (account) setEmailTarget({ row, account });
          }}
          onEditAccess={(row) => {
            const account = row.userId === null ? undefined : accountRows.accounts.get(row.userId);
            if (account) setAccessTarget({ row, account });
          }}
          onEditPermissions={(row) => {
            const account = row.userId === null ? undefined : accountRows.accounts.get(row.userId);
            if (account) setPermissionsTarget({ row, account });
          }}
        />
      </div>

      {years.activeYear && years.controlVersion !== null && <CreateDraftDialog
        open={createOpen} activeYear={years.activeYear.year} controlVersion={years.controlVersion}
        onCreated={(year) => { selectYear(year); void refreshAll(); }}
        onClose={() => setCreateOpen(false)}
      />}
      {selected?.state === "DRAFT" && <RolloverDialog
        open={rolloverOpen} year={selected.year} isMain={isMain}
        onChanged={() => void refreshAll()}
        onActivated={(year) => { selectYear(year); void refreshAll(); }}
        onClose={() => setRolloverOpen(false)}
      />}
      {selected?.state === "ARCHIVED" && <ArchivedRosterDialog
        open={archiveOpen} year={selected} controlVersion={years.controlVersion}
        isMain={isMain} canWrite={canWrite} onChanged={refreshAll}
        onClose={() => setArchiveOpen(false)}
      />}

      {selectedYear !== null && (
        <RosterImportDialog
          open={importOpen}
          year={selectedYear}
          scope={scope}
          nameOf={nameOf}
          onScopeChange={setScope}
          onCommitted={() => void refreshAll()}
          onClose={() => setImportOpen(false)}
        />
      )}

      <EmailChangeDialog
        key={`email:${emailTarget?.account.id ?? "closed"}`}
        target={emailTarget}
        onClose={() => setEmailTarget(null)}
        onSubmit={(target, email) =>
          runAccountMutation(
            `/api/admin/users/${target.account.id}/email`,
            `email:${target.account.id}:${email}`,
            { expectedRowVersion: target.account.profileVersion, email },
            "이메일을 바꾸지 못했습니다.",
          )
        }
      />

      <AccessChangeDialog
        key={`access:${accessTarget?.account.id ?? "closed"}`}
        target={accessTarget}
        isMain={isMain}
        onClose={() => setAccessTarget(null)}
        onSubmit={(target, input) =>
          runAccountMutation(
            `/api/admin/users/${target.account.id}/access`,
            `access:${target.account.id}:${input.state}:${input.reason}`,
            { expectedRowVersion: target.account.profileVersion, ...input },
            "이용 상태를 바꾸지 못했습니다.",
          )
        }
      />

      <PermissionsDialog
        key={`permissions:${permissionsTarget?.account.id ?? "closed"}`}
        target={permissionsTarget}
        onClose={() => setPermissionsTarget(null)}
        onSubmit={(target, level) =>
          runAccountMutation(
            `/api/admin/users/${target.account.id}/permissions`,
            `permissions:${target.account.id}:${level}`,
            { expectedRowVersion: target.account.profileVersion, level },
            "권한을 바꾸지 못했습니다.",
          )
        }
      />
    </div>
  );
}
