"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RolloverDecision } from "@/lib/academic-year/rollover-service";
import { canActivateRollover, createRolloverController, decisionOptions } from "@/lib/admin-roster/rollover-controller";

export type RolloverDialogProps = {
  open: boolean;
  year: number;
  isMain: boolean;
  onChanged: () => void;
  onActivated: (year: number) => void;
  onClose: () => void;
};

const DECISION_LABEL: Record<RolloverDecision, string> = {
  GRADUATED: "졸업", TRANSFERRED: "전출", RETIRED: "퇴직", RESTORE: "초안에 다시 포함",
};
const ISSUE_LABEL: Record<string, string> = {
  INCOMPLETE_ROWS: "필수 정보가 빠진 행", DUPLICATE_SEAT: "학번 중복", DUPLICATE_EMAIL: "이메일 중복",
  ROLE_MISMATCH: "학생·교사 구분 불일치", INACTIVE_ACCOUNT: "이용 중단 계정", STALE_ACCOUNT: "계정 변경 후 미확인 행",
  DUPLICATE_ACCOUNT: "같은 계정 중복 연결", MISSING_DECISION: "누락자 결정 필요", STALE_DECISION: "원본 변경 후 누락자 결정 재확인",
};
const PANEL = "flex max-h-[calc(100svh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-none flex-col overflow-hidden p-2 sm:max-w-3xl sm:p-3 lg:p-4";
const HEADING = "sticky top-0 z-[2] bg-muted p-2 text-left whitespace-nowrap";

export function RolloverDialog(props: RolloverDialogProps) {
  return props.open ? <RolloverSession key={`${props.year}:${props.isMain}`} {...props} /> : null;
}

function RolloverSession({ year, isMain, onChanged, onActivated, onClose }: RolloverDialogProps) {
  const [controller] = useState(() => createRolloverController({ year, isMain, onChanged,
    onActivated: (activatedYear) => {
      toast.success(`${activatedYear}학년도로 전환했습니다. 키오스크를 다시 동기화한 뒤 운영을 재개하세요.`);
      onActivated(activatedYear);
    },
  }));
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.mount();
    void controller.load();
    return () => controller.dispose();
  }, [controller]);
  const { review, acknowledgements } = session;
  const busy = session.stage === "LOADING" || session.stage === "MUTATING";
  const disabled = busy || session.pending;
  const warned = review !== null && Object.values(review.warnings).some((count) => count > 0);

  function close() {
    if (controller.getSnapshot().pending) return;
    controller.dispose();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className={PANEL} showCloseButton={!session.pending}>
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap">{year}학년도 전환 검토</DialogTitle>
          <DialogDescription className="break-keep">학생과 교사 전체를 대조합니다. 누락자 결정 후 메인 관리자가 최종 전환합니다.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain">
          {session.error && <p role="alert" className="text-sm text-destructive break-keep">{session.error}</p>}
          {session.pending && <p className="text-sm text-muted-foreground break-keep">요청 결과를 확인한 뒤 창을 닫을 수 있습니다.</p>}
          {session.stage === "LOADING" && <p role="status">전체 명부를 대조하고 있습니다…</p>}
          {review && session.stage !== "DONE" && <>
            <p className="text-sm break-keep">현재 운영: <strong>{review.sourceYear}학년도</strong> → 전환 대상: <strong>{year}학년도</strong></p>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {([
                ["새 명부 인원", review.summary.members], ["신규 계정", review.summary.newAccounts],
                ["기존 계정 연결", review.summary.linkedAccounts], ["학생 학급·학번 변경", review.summary.changedStudents],
                ["교사 업무 변경", review.summary.changedTeachers], ["이용 중단", review.summary.leavers],
                ["제외된 신규 후보 정리", review.summary.removedDraftCandidates],
              ] as const).map(([label, count]) => <div key={label} className="min-w-0 rounded-xl border p-2">
                <dt className="overflow-x-auto whitespace-nowrap text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold">{count}명</dd>
              </div>)}
            </dl>
            <div className="rounded-xl bg-muted/50 p-2 text-sm break-keep">
              관리자·서브관리자 권한은 유지됩니다. 이용 중단자는 로그인과 체크인이 막히고 <strong>얼굴 등록이 삭제됩니다.</strong>
              계속 이용하는 사람의 얼굴 등록과 기존 식사 신청·확정일·체크인 기록은 보존됩니다.
              제외된 신규 후보는 아직 계정이 만들어지지 않은 초안 행이며 전환 시 정리됩니다.
            </div>
            <section className="flex min-w-0 flex-col gap-2">
              <h3 className="font-semibold whitespace-nowrap">누락자 결정 {review.missing.length}명</h3>
              {review.missing.length === 0 ? <p className="text-sm text-muted-foreground">누락된 재학·재직자가 없습니다.</p> : <>
                <p className="text-sm break-keep">{review.sourceYear}학년도 정보를 기준으로 표시합니다. 추천된 졸업도 직접 확인해야 합니다.</p>
                <div className="max-h-72 min-w-0 overflow-auto rounded-xl border">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead><tr>
                      <th className="sticky top-0 left-0 z-[4] bg-muted p-2 text-left whitespace-nowrap">이름</th>
                      <th className={HEADING}>원본 학급·업무</th><th className={HEADING}>결정</th>
                    </tr></thead>
                    <tbody>{review.missing.map((person) => <tr key={person.userId} className="border-t">
                      <td className="sticky left-0 z-[3] bg-popover p-2 whitespace-nowrap">
                        {person.profile.name}<span className="ml-2 text-xs text-muted-foreground">{person.role === "STUDENT" ? "학생" : "교사"} · #{person.userId}</span>
                      </td>
                      <td className="p-2 whitespace-nowrap">{person.role === "STUDENT"
                        ? `${person.profile.grade ?? "—"}학년 ${person.profile.classNum ?? "—"}반 ${person.profile.number ?? "—"}번`
                        : [person.profile.subject, person.profile.homeroom, person.profile.position].filter(Boolean).join(" · ") || "업무 정보 없음"}
                        {person.suggested === "GRADUATED" && <span className="ml-2 text-amber-700">졸업 확인 대상</span>}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <div className="flex gap-2">{decisionOptions(person).map((decision) => <Button key={decision}
                          className="min-h-11 whitespace-nowrap" size="sm" variant={person.decision === decision ? "default" : "outline"}
                          disabled={disabled} aria-pressed={person.decision === decision}
                          onClick={() => void controller.decide(person.userId, decision)}>{DECISION_LABEL[decision]}</Button>)}</div>
                        {!person.canRestore && <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">계속 이용한다면 Excel로 초안에 다시 추가하세요.</p>}
                      </td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </>}
            </section>
            {review.issues.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50 p-2">
              <h3 className="font-semibold whitespace-nowrap">전환 전에 확인할 항목</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">{review.issues.map((issue) => {
                const [code, count] = issue.split(":");
                return <li key={issue} className="break-keep">{ISSUE_LABEL[code] ?? code}{count ? ` ${count}건` : ""}</li>;
              })}</ul>
              <p className="mt-2 text-sm break-keep">명부·Excel 또는 누락자 결정을 보완한 뒤 전체 대조를 다시 실행하세요.</p>
            </section>}
            <section className="flex flex-col gap-2 rounded-xl border p-2">
              <h3 className="font-semibold whitespace-nowrap">전환 경고</h3>
              {([
                ["이용 중단 대상의 미래 확정 식사일", review.warnings.futureMealDatesOfLeavers, "건"],
                ["현재 학년도에 남은 확정 식사일", review.warnings.remainingMealDatesInSourceYear, "건"],
                ["전년도와 학년이 같은 학생", review.warnings.studentsWithSameGrade, "명"],
              ] as const).map(([label, count, unit]) => <p key={label}
                className={`text-sm break-keep ${count > 0 ? "font-semibold text-amber-800" : "text-muted-foreground"}`}>{label}: {count}{unit}</p>)}
              <p className="text-xs break-keep text-muted-foreground">전환 뒤 이전 담임은 남은 기간의 학급 조회 권한을 잃습니다. 복사한 학년·학급을 새 학년도에 맞게 준비했는지 확인하세요.</p>
              {warned && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
                <input type="checkbox" className="size-5 shrink-0" checked={acknowledgements.warnings} disabled={disabled || !isMain}
                  onChange={(event) => controller.acknowledge("warnings", event.target.checked)} />
                위 전환 경고와 남은 식사일을 확인했습니다.
              </label>}
            </section>
            {isMain ? <div className="flex flex-col gap-2 rounded-xl border p-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
                <input type="checkbox" className="size-5 shrink-0" disabled={disabled} checked={acknowledgements.uploads}
                  onChange={(event) => controller.acknowledge("uploads", event.target.checked)} />
                모든 운영 키오스크의 미전송 체크인을 업로드했습니다.
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm break-keep">
                <input type="checkbox" className="size-5 shrink-0" disabled={disabled} checked={acknowledgements.paused}
                  onChange={(event) => controller.acknowledge("paused", event.target.checked)} />
                모든 운영 키오스크의 사용을 잠시 중지했습니다.
              </label>
              <p className="text-xs break-keep text-muted-foreground">전환 성공 후 모든 장치에서 명부·식사 자격·얼굴 정보를 다시 동기화하고 운영을 재개하세요.</p>
            </div> : <p className="text-sm break-keep text-muted-foreground">누락자 결정과 초안 준비까지 할 수 있습니다. 최종 전환은 메인 관리자에게 요청하세요.</p>}
          </>}
          {session.stage === "DONE" && <p role="status" className="break-keep">전환이 완료되었습니다. 새 학년도 접수가 가능하며, 키오스크는 재동기화 후 사용하세요.</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
          <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={session.pending} onClick={close}>닫기</Button>
          {session.stage !== "DONE" && <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={disabled}
            onClick={() => void controller.load()}>전체 대조 다시 하기</Button>}
          {session.pending && <Button className="min-h-11 whitespace-nowrap" disabled={busy} onClick={() => void controller.retry()}>같은 요청으로 결과 확인</Button>}
          {isMain && !session.pending && session.stage !== "DONE" && <Button className="min-h-11 whitespace-nowrap"
            disabled={!canActivateRollover(session, isMain)} onClick={() => void controller.activate()}>학년도 전환 실행</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
