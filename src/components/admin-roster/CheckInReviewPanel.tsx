"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isNotReady } from "@/hooks/useAcademicRoster";
import { fetcher } from "@/lib/fetcher";
import { MEAL_KINDS, MEAL_LABEL, type MealKind } from "@/lib/meal-plan";
import { formatDateTimeSecondsKST } from "@/lib/timezone";
import { CHECKIN_REVIEW_LABEL, checkInReviewPayload, type CheckInReviewRow, type CheckInReviewState } from "@/lib/admin-roster/checkin-review";
import { createCheckInReviewController, reviewDecisionError } from "@/lib/admin-roster/checkin-review-controller";

export type CheckInReviewPanelProps = {
  canWrite: boolean;
  onPendingChange?: (pending: boolean) => void;
};

const CELL = "p-2 whitespace-nowrap";
const HEADER = "sticky top-0 z-[2] bg-muted p-2 text-left whitespace-nowrap";
const TYPE_LABEL = new Map([
  ["STUDENT", "학생"], ["WORK", "교사 근무"], ["PERSONAL", "교사 개인"],
]);
const REASON_LABEL = new Map([
  ["INVALID_PAYLOAD", "원본 기록의 필수 정보 또는 형식이 올바르지 않습니다."],
  ["USER_NOT_FOUND", "원본 기록에 해당하는 사용자를 찾을 수 없습니다."],
]);

function reviewTime(value: string | null): string {
  if (!value) return "확인 불가";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "확인 불가" : formatDateTimeSecondsKST(at);
}

function decisionReason(decision: unknown): string | null {
  if (typeof decision !== "object" || decision === null || !("reason" in decision)) return null;
  return typeof decision.reason === "string" ? decision.reason : null;
}

function mealLabel(row: CheckInReviewRow): string {
  const payload = checkInReviewPayload(row.payload);
  if (payload.mealKind) return MEAL_LABEL[payload.mealKind];
  return payload.invalidMealKind ? "원본 식사 구분 오류" : row.payload === null ? "원본 정리됨" : "원본 식사 구분 없음";
}

function subjectName(row: CheckInReviewRow): string {
  const userId = checkInReviewPayload(row.payload).userId;
  return row.subject?.name || (userId === null ? "원본 정보 없음" : `사용자 #${userId}`);
}

export function CheckInReviewPanel({ canWrite, onPendingChange }: CheckInReviewPanelProps) {
  const { mutate } = useSWRConfig();
  const [filter, setFilter] = useState<CheckInReviewState | "ALL">("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const key = `/api/admin/checkin-reviews${filter === "ALL" ? "" : `?state=${filter}`}`;
  const { data, error, isLoading, mutate: reload } = useSWR<{ reviews: CheckInReviewRow[] }>(key, fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false });
  const rows = data?.reviews ?? [];
  const changePending = useCallback((value: boolean) => {
    setPending(value);
    onPendingChange?.(value);
  }, [onPendingChange]);
  const refreshAffected = useCallback(() => {
    void Promise.allSettled([mutate((cacheKey) => typeof cacheKey === "string" &&
      (cacheKey.startsWith("/api/admin/checkin-reviews") || cacheKey.startsWith("/api/admin/checkins?")))]);
  }, [mutate]);

  return <section className="flex h-full min-h-0 min-w-0 flex-col gap-2" aria-label="오프라인 체크인 검토">
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <h2 className="whitespace-nowrap font-semibold">오프라인 체크인 검토</h2>
      <label className="ml-auto flex min-h-11 items-center gap-2 whitespace-nowrap text-sm">
        처리 상태
        <select aria-label="체크인 검토 상태" className="h-11 min-w-28 rounded-lg border bg-background px-2 text-base md:text-sm" value={filter}
          disabled={pending} onChange={(event) => setFilter(event.target.value as CheckInReviewState | "ALL")}>
          {Object.entries(CHECKIN_REVIEW_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="ALL">전체</option>
        </select>
      </label>
      <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={pending || isLoading} onClick={() => void reload()}>새로고침</Button>
    </div>
    <p className="shrink-0 break-keep rounded-lg bg-muted/50 p-2 text-sm">
      확인 대기 기록은 키오스크에 보존됩니다. 승인·거절을 마친 뒤 해당 키오스크에서 다시 동기화하면 처리 결과를 받고 로컬 목록을 정리합니다.
    </p>
    <p className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">선택한 상태의 최근 {rows.length}건 · 최대 200건 표시 · 시각은 KST</p>
    {isNotReady(error) ? <p role="status" className="break-keep p-2 text-sm text-muted-foreground">학년도 기능을 준비 중입니다. 검증과 기능 공개가 끝나면 체크인 검토를 사용할 수 있습니다.</p>
      : error ? <p role="alert" className="break-keep p-2 text-sm text-destructive">검토 목록을 불러오지 못했습니다. 연결과 권한을 확인한 뒤 새로고침해 주세요.</p>
        : isLoading ? <p role="status" className="p-2 text-sm">검토 목록을 불러오는 중…</p>
          : rows.length === 0 ? <p className="p-2 text-sm text-muted-foreground">해당 상태의 기록이 없습니다.</p>
            : <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border overscroll-contain">
              <table className="w-full text-sm whitespace-nowrap">
                <thead><tr>
                  <th className="sticky top-0 left-0 z-[4] bg-muted p-2 text-left whitespace-nowrap">대상</th>
                  <th className={HEADER}>식사일·구분</th><th className={HEADER}>원본 발생시각 (KST)</th>
                  <th className={HEADER}>확인 사유</th><th className={HEADER}>처리 결과</th><th className={HEADER}>상세</th>
                </tr></thead>
                <tbody>{rows.map((row) => {
                  const payload = checkInReviewPayload(row.payload);
                  return <tr key={row.id} className="border-t">
                    <td className="sticky left-0 z-[3] bg-background p-2 whitespace-nowrap">
                      <div className="max-w-48 overflow-hidden text-ellipsis font-medium" title={subjectName(row)}>{subjectName(row)}</div>
                      {row.subject && <div className="max-w-48 overflow-hidden text-ellipsis text-xs text-muted-foreground"
                        title={`${row.subject.year}학년도 · ${row.subject.affiliation}`}>{row.subject.year}학년도 · {row.subject.affiliation}</div>}
                    </td>
                    <td className={CELL}><div>{payload.date ?? "원본 정보 없음"}</div><div className="text-xs text-muted-foreground">{mealLabel(row)}</div></td>
                    <td className={CELL}>{reviewTime(payload.checkedAt)}</td>
                    <td className={CELL}>{REASON_LABEL.get(row.reason) ?? row.reason}</td>
                    <td className={CELL}><div>{CHECKIN_REVIEW_LABEL[row.state]}</div><div className="text-xs text-muted-foreground">{decisionReason(row.decision)}</div></td>
                    <td className={CELL}><Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={pending}
                      onClick={() => setSelectedId(row.id)}>{row.state === "PENDING" && canWrite ? "검토" : "보기"}</Button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>}
    {selectedId && <CheckInReviewDialog key={`${selectedId}:${canWrite}`} reviewId={selectedId} canWrite={canWrite}
      onChanged={refreshAffected} onPendingChange={changePending} onClose={() => setSelectedId(null)} />}
  </section>;
}

function CheckInReviewDialog({ reviewId, canWrite, onChanged, onPendingChange, onClose }: {
  reviewId: string; canWrite: boolean; onChanged: () => void; onPendingChange: (pending: boolean) => void; onClose: () => void;
}) {
  const [controller] = useState(() => createCheckInReviewController({ reviewId, canWrite, onChanged, onPendingChange }));
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.mount(); void controller.load(); return () => controller.dispose(); }, [controller]);
  const { review } = session;
  const payload = checkInReviewPayload(review?.payload);
  const busy = session.stage === "LOADING" || session.stage === "SAVING";
  const editable = canWrite && review?.state === "PENDING";
  const disabled = busy || session.pending;
  const decisionError = reviewDecisionError(session);
  function close() {
    if (controller.getSnapshot().pending) return;
    controller.dispose(); onClose();
  }

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent showCloseButton={!session.pending}
      className="flex max-h-[calc(100svh-1rem)] w-[calc(100%-1rem)] min-w-0 max-w-none flex-col overflow-hidden p-2 sm:max-w-2xl sm:p-3 lg:p-4">
      <DialogHeader>
        <DialogTitle className="whitespace-nowrap">체크인 기록 검토</DialogTitle>
        <DialogDescription className="break-keep">원본 식사일과 발생시각을 확인하고 판단 사유를 남겨 주세요.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain">
        {session.error && <p role="alert" className="break-keep text-sm text-destructive">{session.error}</p>}
        {session.pending && <p role="status" className="break-keep text-sm">처리 결과를 확인할 때까지 입력과 닫기가 잠깁니다. 응답을 받지 못했다면 같은 요청으로 결과를 확인하세요.</p>}
        {session.stage === "LOADING" && <p role="status">원본 기록과 최신 처리 상태를 확인하고 있습니다…</p>}
        {review && <>
          <div className="min-w-0 overflow-x-auto rounded-xl border p-2">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 whitespace-nowrap text-sm">
              {([
                ["대상", subjectName(review)], ["학년도·소속", review.subject ? `${review.subject.year}학년도 · ${review.subject.affiliation}` : "원본 정보 없음"],
                ["식사일", payload.date ?? "원본 정보 없음"], ["식사 구분", mealLabel(review)],
                ["체크인 유형", payload.type ? TYPE_LABEL.get(payload.type) ?? payload.type : "원본 정보 없음"],
                ["원본 발생시각 (KST)", reviewTime(payload.checkedAt)], ["서버 접수시각 (KST)", reviewTime(review.createdAt)],
                ["확인 사유", REASON_LABEL.get(review.reason) ?? review.reason], ["처리 결과", CHECKIN_REVIEW_LABEL[review.state]],
                ["처리 사유", decisionReason(review.decision) ?? "—"], ["처리시각 (KST)", review.resolvedAt ? reviewTime(review.resolvedAt) : "—"],
              ] as const).map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </div>
          {review.payload === null && <p className="break-keep text-sm text-muted-foreground">원본 내용이 정리된 기록입니다. 남아 있는 처리 결과와 사유를 확인할 수 있습니다.</p>}
          {review.state !== "PENDING" && <p role="status" className="break-keep rounded-lg bg-muted/50 p-2 text-sm">
            {review.state === "DUPLICATE" ? "같은 식사일·식사의 체크인이 이미 있어 중복으로 확인했습니다."
              : review.state === "ACCEPTED" ? "체크인에 반영된 기록입니다." : "거절이 확정된 기록입니다."}
            {" "}해당 키오스크를 다시 동기화하면 이 결과를 전달받아 로컬 기록을 정리합니다.
            {!payload.mealKind && " 원본에 식사 구분이 없어 이 화면에서는 실제 반영 식사를 추정하지 않습니다."}
          </p>}
          {editable ? <div className="flex flex-col gap-3">
            <fieldset disabled={disabled} className="flex flex-col gap-2">
              <legend className="mb-2 whitespace-nowrap text-sm font-medium">처리 결정</legend>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={session.decision === "ACCEPT" ? "default" : "outline"} className="min-h-11 whitespace-nowrap"
                  aria-pressed={session.decision === "ACCEPT"} disabled={disabled || !payload.canAccept}
                  onClick={() => controller.setDecision("ACCEPT")}>승인</Button>
                <Button type="button" variant={session.decision === "REJECT" ? "default" : "outline"} className="min-h-11 whitespace-nowrap"
                  aria-pressed={session.decision === "REJECT"} disabled={disabled} onClick={() => controller.setDecision("REJECT")}>거절</Button>
              </div>
            </fieldset>
            {!payload.canAccept && <p className="break-keep text-sm text-amber-800">원본의 필수 정보 또는 식사 구분이 올바르지 않아 승인할 수 없습니다. 확인 후 거절 사유를 남겨 주세요.</p>}
            {session.decision === "ACCEPT" && payload.canAccept && !payload.mealKind && <label className="flex flex-col gap-2 text-sm">
              <span className="whitespace-nowrap font-medium">반영할 식사 (직접 확인 필수)</span>
              <select aria-label="반영할 식사" className="h-11 rounded-lg border bg-background px-2 text-base md:text-sm" value={session.mealKind} disabled={disabled}
                onChange={(event) => controller.setMealKind(event.target.value as MealKind | "")}>
                <option value="">식사를 선택하세요</option>
                {MEAL_KINDS.map((kind) => <option key={kind} value={kind}>{MEAL_LABEL[kind]}</option>)}
              </select>
            </label>}
            <label className="flex flex-col gap-2 text-sm">
              <span className="whitespace-nowrap font-medium">처리 사유 (필수)</span>
              <textarea aria-label="처리 사유" rows={3} maxLength={200} disabled={disabled} value={session.reason}
                className="min-h-20 w-full min-w-0 resize-none rounded-lg border bg-background p-2 text-base break-keep md:text-sm"
                placeholder="예: 담임과 원본 시각을 대조해 중식 이용 확인" onChange={(event) => controller.setReason(event.target.value)} />
            </label>
            <p className="break-keep text-xs text-muted-foreground">{decisionError ?? (session.decision === "REJECT" ? "거절 사유가 키오스크에도 전달됩니다." : "원본 식사일과 발생시각을 그대로 반영합니다. 같은 식사 기록이 있으면 중복으로 처리합니다.")}</p>
          </div> : review.state === "PENDING" && <p className="break-keep text-sm text-muted-foreground">이 계정은 조회만 할 수 있습니다. 승인·거절은 쓰기 권한이 있는 관리자에게 요청하세요.</p>}
        </>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
        <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={session.pending} onClick={close}>닫기</Button>
        <Button variant="outline" className="min-h-11 whitespace-nowrap" disabled={disabled} onClick={() => void controller.load()}>최신 상태 확인</Button>
        {session.pending ? <Button className="min-h-11 whitespace-nowrap" disabled={busy} onClick={() => void controller.retry()}>같은 요청으로 결과 확인</Button>
          : editable && <Button className="min-h-11 whitespace-nowrap" disabled={busy || decisionError !== null} onClick={() => void controller.submit()}>
            {session.decision === "REJECT" ? "거절 확정" : "승인하여 반영"}
          </Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
