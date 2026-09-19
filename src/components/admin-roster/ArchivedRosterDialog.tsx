"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SaveResult } from "@/components/EditableCell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoster, type AcademicYearRow, type LegacyAdminUser, type RosterViewRow } from "@/hooks/useAcademicRoster";
import {
  archiveDeleteAttempt,
  archivedCorrectionAttempt,
  type ArchiveDeleteAttempt,
  type ArchivedCorrectionAttempt,
} from "@/lib/admin-roster/archive-actions";
import { sendMutation } from "@/lib/admin-roster/mutate";
import { RosterTable, type RosterField } from "./RosterTable";

export type ArchivedRosterDialogProps = {
  open: boolean;
  year: AcademicYearRow;
  controlVersion: number | null;
  isMain: boolean;
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
};

const PRESERVATION_NOTICE = "명부는 삭제되며, 식사 내역 표시용 학년도 정보와 식사 기록은 보존됩니다.";
const EMPTY_ACCOUNTS = new Map<number, LegacyAdminUser>();
const HEAD = "sticky top-0 z-[2] whitespace-nowrap bg-muted p-2 text-left";
const FIRST_HEAD = "sticky top-0 left-0 z-[4] whitespace-nowrap bg-muted p-2 text-left";
const TOUCH = "min-h-11 min-w-11 whitespace-nowrap";

export function ArchivedRosterDialog(props: ArchivedRosterDialogProps) {
  if (!props.open || props.year.state !== "ARCHIVED") return null;
  return <ArchivedRosterSession key={props.year.year} {...props} />;
}

function ArchivedRosterSession({ year, controlVersion, isMain, canWrite, onChanged, onClose }: ArchivedRosterDialogProps) {
  const [mode, setMode] = useState<"RECORDS" | "DELETE">("RECORDS");
  const [role, setRole] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [scope, setScope] = useState<"SELECTED" | "ALL">("SELECTED");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unresolvedDelete, setUnresolvedDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableRevision, setTableRevision] = useState(0);
  const [deleteAttempt, setDeleteAttempt] = useState<ArchiveDeleteAttempt | null>(null);
  const correctionAttempts = useRef(new Map<string, ArchivedCorrectionAttempt>());
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const students = useRoster(year.year, "STUDENT", { includeExcluded: true, includeEntryless: true });
  const teachers = useRoster(year.year, "TEACHER", { includeExcluded: true, includeEntryless: true });
  const allRows = [...students.rows, ...teachers.rows];
  const entries = allRows.filter((row): row is RosterViewRow & { entryId: string } => Boolean(row.entryId));
  const selected = entries.filter((row) => selectedIds.includes(row.entryId));
  const selectedCount = scope === "ALL" ? entries.length : selected.length;
  const targetCount = deleteAttempt?.count ?? selectedCount;
  const loading = students.isLoading || teachers.isLoading;
  const loadFailed = students.error || teachers.error || students.notReady || teachers.notReady;
  const visibleRows = role === "STUDENT" ? students.rows : teachers.rows;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function refresh(): Promise<void> {
    await Promise.allSettled([students.mutate(), teachers.mutate(), onChanged()]);
  }

  function clearDeleteReview(): void {
    setDeleteAttempt(null);
    setConfirmed(false);
    setError(null);
  }

  function changeMode(next: "RECORDS" | "DELETE"): void {
    if (busyRef.current || unresolvedDelete || (next === "DELETE" && !isMain)) return;
    clearDeleteReview();
    correctionAttempts.current.clear();
    setTableRevision((current) => current + 1);
    setMode(next);
  }

  function close(): void {
    if (busyRef.current || unresolvedDelete) return;
    mounted.current = false;
    onClose();
  }

  async function saveField(row: RosterViewRow, field: RosterField, next: string): Promise<SaveResult> {
    if (!canWrite || row.userId === null || busyRef.current) {
      return { ok: false, message: "현재 이 기록을 정정할 수 없습니다." };
    }
    busyRef.current = true;
    setBusy(true);
    const slotKey = `${row.userId}:${field}`;
    const attempt = archivedCorrectionAttempt(correctionAttempts.current.get(slotKey) ?? null,
      year.year, { ...row, userId: row.userId }, field, next);
    correctionAttempts.current.set(slotKey, attempt);
    try {
      const result = await sendMutation(`/api/admin/academic-years/${year.year}/records/${row.userId}`,
        "PUT", attempt.body, "표시 정보를 정정하지 못했습니다.");
      if (!result.ok) {
        if (result.conflict) {
          correctionAttempts.current.delete(slotKey);
          await refresh();
          if (mounted.current) setTableRevision((current) => current + 1);
        }
        return { ok: false, message: result.message };
      }
      correctionAttempts.current.delete(slotKey);
      await refresh();
      return { ok: true };
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function deleteRoster(): Promise<void> {
    if (!isMain || !confirmed || busyRef.current || controlVersion === null ||
      (!unresolvedDelete && (loading || loadFailed || selectedCount === 0))) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const attempt = deleteAttempt ?? archiveDeleteAttempt(null, year.year, controlVersion,
      scope === "ALL" ? "ALL" : selected.map((row) => row.entryId), targetCount);
    setDeleteAttempt(attempt);
    try {
      const result = await sendMutation(`/api/admin/academic-years/${year.year}/roster`,
        "DELETE", attempt.body, "명부를 삭제하지 못했습니다.");
      if (!result.ok) {
        const unknownOutcome = result.status === 0 || result.status >= 500;
        if (mounted.current) {
          setUnresolvedDelete(unknownOutcome);
          if (!unknownOutcome) {
            setDeleteAttempt(null);
            setConfirmed(false);
          }
        }
        if (result.conflict) {
          await refresh();
          if (mounted.current) {
            setDeleteAttempt(null);
            setSelectedIds([]);
            setConfirmed(false);
          }
        }
        if (mounted.current) setError(result.message);
        return;
      }
      await refresh();
      if (mounted.current) {
        setUnresolvedDelete(false);
        setDeleteAttempt(null);
        setSelectedIds([]);
        setConfirmed(false);
        toast.success(`${result.data.receipt.changed}명의 명부를 삭제했습니다. 식사 기록은 보존됩니다.`);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent showCloseButton={!busy && !unresolvedDelete} className="block max-h-[calc(100svh-1rem)] w-full min-w-0 max-w-[calc(100%-1rem)] overflow-y-auto overscroll-contain p-2 sm:max-w-6xl sm:p-3">
        <div className="flex min-w-0 flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="truncate" title={`${year.year}학년도 지난 명부 관리`}>{year.year}학년도 지난 명부 관리</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button className={TOUCH} variant={mode === "RECORDS" ? "default" : "outline"} disabled={busy || unresolvedDelete} onClick={() => changeMode("RECORDS")}>과거 표시 정보 {canWrite ? "정정" : "조회"}</Button>
          {isMain && <Button className={TOUCH} variant={mode === "DELETE" ? "default" : "outline"} disabled={busy || unresolvedDelete} onClick={() => changeMode("DELETE")}>명부 삭제</Button>}
          <Button className={TOUCH} variant="outline" disabled={busy || loading || Boolean(loadFailed) || entries.length === 0}
            onClick={() => { window.location.href = `/api/admin/academic-years/${year.year}/template?includeData=1`; }}>
            삭제 전 명부 다운로드
          </Button>
        </div>

        {(loadFailed || loading) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm" role={loadFailed ? "alert" : "status"}>
            <span className="break-keep">{loadFailed ? "지난 학년도 자료를 불러오지 못했습니다." : "지난 학년도 자료를 불러오는 중입니다."}</span>
            {loadFailed && <Button className={TOUCH} variant="outline" disabled={busy} onClick={() => void refresh()}>다시 불러오기</Button>}
          </div>
        )}

        {mode === "RECORDS" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <p className="shrink-0 text-sm break-keep">
              해당 학년도의 식사 내역에 표시되는 이름·소속·교사 업무를 {canWrite ? "정정합니다" : "조회합니다"}. 명부가 삭제된 사람도 확인할 수 있으며, 정정해도 삭제된 명부가 복구되지는 않습니다.
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button className={TOUCH} variant={role === "STUDENT" ? "default" : "outline"} disabled={busy} onClick={() => setRole("STUDENT")}>학생 {students.rows.length}명</Button>
              <Button className={TOUCH} variant={role === "TEACHER" ? "default" : "outline"} disabled={busy} onClick={() => setRole("TEACHER")}>교사 {teachers.rows.length}명</Button>
              {!canWrite && <span className="text-sm whitespace-nowrap text-muted-foreground">조회 전용</span>}
            </div>
            <div className="h-[45svh] min-h-40 min-w-0 shrink-0 overflow-hidden">
              <RosterTable key={`${role}:${tableRevision}`} rows={visibleRows} role={role} accounts={EMPTY_ACCOUNTS}
                canWrite={canWrite && !busy && !loading && !loadFailed} isMain={false} recordOnly
                onSaveField={saveField} onEditEmail={() => undefined} onEditAccess={() => undefined} onEditPermissions={() => undefined} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
              <p className="font-medium break-keep">{PRESERVATION_NOTICE}</p>
              <p className="mt-1 break-keep">학생·교사 전체 명부를 함께 대상으로 합니다. 삭제한 명부는 다시 다운로드할 수 없으므로 필요한 파일을 먼저 받으세요.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button className={TOUCH} variant={scope === "SELECTED" ? "default" : "outline"} disabled={busy || unresolvedDelete} onClick={() => { clearDeleteReview(); setScope("SELECTED"); }}>선택한 명부만</Button>
              <Button className={TOUCH} variant={scope === "ALL" ? "default" : "outline"} disabled={busy || unresolvedDelete} onClick={() => { clearDeleteReview(); setScope("ALL"); }}>전체 명부 {entries.length}명</Button>
              <span className="text-sm font-medium whitespace-nowrap">삭제 대상 {targetCount}명</span>
            </div>
            <div className="h-[45svh] min-h-40 min-w-0 shrink-0 overflow-auto overscroll-contain rounded-lg border">
              <table className="w-full text-sm whitespace-nowrap">
                <thead><tr><th className={FIRST_HEAD}>삭제 대상 선택</th><th className={HEAD}>구분</th><th className={HEAD}>소속</th><th className={HEAD}>이메일</th></tr></thead>
                <tbody>{entries.map((row) => (
                  <tr key={row.entryId} className="border-t">
                    <td className="sticky left-0 z-[3] bg-card p-1 whitespace-nowrap">
                      <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 px-1">
                        <input type="checkbox" className="size-5 shrink-0" aria-label={`${row.profile.name} 삭제 대상 선택`}
                          checked={scope === "ALL" || selectedIds.includes(row.entryId)} disabled={busy || unresolvedDelete || scope === "ALL"}
                          onChange={(event) => { clearDeleteReview(); setSelectedIds((current) => event.target.checked ? [...current, row.entryId] : current.filter((id) => id !== row.entryId)); }} />
                        <span>{row.profile.name}</span>
                      </label>
                    </td>
                    <td className="p-2 whitespace-nowrap">{row.profile.role === "STUDENT" ? "학생" : "교사"}</td>
                    <td className="p-2 whitespace-nowrap">{row.profile.role === "STUDENT" ? `${row.profile.grade ?? "—"}학년 ${row.profile.classNum ?? "—"}반 ${row.profile.number ?? "—"}번` : row.profile.subject ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{row.email}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!loading && entries.length === 0 && <p className="p-2 text-sm break-keep text-muted-foreground">남아 있는 명부가 없습니다. 보존된 식사 표시 정보는 정정 화면에서 확인하세요.</p>}
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-2 border-t bg-popover pt-2">
          {error && <p role="alert" className="text-sm break-keep text-destructive">{error}</p>}
          {unresolvedDelete && <p role="status" className="text-sm break-keep">삭제 결과를 받지 못했습니다. 같은 요청으로 결과를 확인한 뒤 창을 닫을 수 있습니다.</p>}
          {mode === "DELETE" && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
              <input type="checkbox" className="size-5 shrink-0" checked={confirmed} disabled={busy || unresolvedDelete || loading || Boolean(loadFailed) || controlVersion === null || targetCount === 0}
                onChange={(event) => {
                  if (loading || loadFailed || unresolvedDelete || controlVersion === null) return;
                  const checked = event.target.checked;
                  setConfirmed(checked);
                  setDeleteAttempt(checked && controlVersion !== null
                    ? archiveDeleteAttempt(deleteAttempt, year.year, controlVersion,
                      scope === "ALL" ? "ALL" : selected.map((row) => row.entryId), targetCount)
                    : null);
                }} />
              <span>삭제 대상 {targetCount}명과 보존되는 기록을 확인했습니다.</span>
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button className={TOUCH} variant="outline" disabled={busy || unresolvedDelete} onClick={close}>닫기</Button>
            {mode === "DELETE" && isMain && (
              <Button className={TOUCH} variant="destructive" disabled={busy || !confirmed || targetCount === 0 || controlVersion === null || (!unresolvedDelete && (loading || Boolean(loadFailed)))}
                onClick={() => void deleteRoster()}>{busy ? "삭제 중…" : unresolvedDelete ? "같은 요청으로 결과 확인" : `${targetCount}명 명부 삭제`}</Button>
            )}
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
