import type { MealKind } from "@/lib/meal-kind";
import { checkInReviewPayload, type CheckInReviewRow } from "./checkin-review";
import { requestJson, sendMutation } from "./mutate";
import { newRequestId } from "./request-id";

export type ReviewDecision = "ACCEPT" | "REJECT";
export type CheckInReviewSession = {
  stage: "IDLE" | "LOADING" | "READY" | "SAVING";
  review: CheckInReviewRow | null;
  decision: ReviewDecision;
  reason: string;
  mealKind: MealKind | "";
  pending: boolean;
  error: string | null;
};
type Options = { reviewId: string; canWrite: boolean; onChanged: () => void; onPendingChange?: (pending: boolean) => void };
type DecisionBody = { requestId: string; decision: ReviewDecision; reason: string; mealKind?: MealKind };

export function reviewDecisionError(session: CheckInReviewSession): string | null {
  if (!session.review || session.review.state !== "PENDING") return "확인 대기 기록만 처리할 수 있습니다.";
  if (!session.reason.trim() || session.reason.trim().length > 200) return "처리 사유를 1~200자로 입력하세요.";
  if (session.decision === "REJECT") return null;
  const payload = checkInReviewPayload(session.review.payload);
  if (!payload.canAccept) return "원본 기록을 반영할 수 없습니다. 내용을 확인한 뒤 거절 사유를 남겨 주세요.";
  if (!payload.mealKind && !session.mealKind) return "원본에 식사 구분이 없습니다. 반영할 식사를 직접 선택하세요.";
  return null;
}

export function createCheckInReviewController({ reviewId, canWrite, onChanged, onPendingChange }: Options) {
  let session: CheckInReviewSession = { stage: "IDLE", review: null, decision: "ACCEPT", reason: "", mealKind: "", pending: false, error: null };
  let pending: DecisionBody | null = null;
  let busy = false;
  let mounted = true;
  let generation = 0;
  const listeners = new Set<() => void>();
  const current = (token: number) => mounted && token === generation;
  const editable = () => mounted && canWrite && !busy && !pending && session.stage === "READY" && session.review?.state === "PENDING";
  function update(next: Partial<CheckInReviewSession>) {
    session = { ...session, ...next };
    for (const listener of listeners) listener();
  }
  function setPending(value: boolean) {
    update({ pending: value });
    onPendingChange?.(value);
  }
  async function load(message: string | null = null): Promise<void> {
    if (!mounted || busy || pending) return;
    busy = true;
    const token = generation;
    update({ stage: "LOADING", review: null, reason: "", decision: "ACCEPT", mealKind: "", error: message });
    const result = await requestJson<{ reviews: CheckInReviewRow[] }>(
      `/api/admin/checkin-reviews?id=${encodeURIComponent(reviewId)}`, {}, "검토 기록을 불러오지 못했습니다.",
    );
    if (!current(token)) return;
    busy = false;
    if (!result.ok) { update({ stage: "IDLE", error: result.message }); return; }
    const review = result.data.reviews.find((row) => row.id === reviewId);
    if (!review) { update({ stage: "IDLE", error: "검토 기록을 찾을 수 없습니다. 목록을 다시 확인하세요." }); return; }
    update({ stage: "READY", review, mealKind: checkInReviewPayload(review.payload).mealKind ?? "" });
  }
  async function runPending(): Promise<void> {
    if (!mounted || busy || !pending) return;
    busy = true;
    const token = generation;
    update({ stage: "SAVING", error: null });
    setPending(true);
    const result = await sendMutation(`/api/admin/checkin-reviews/${encodeURIComponent(reviewId)}`, "PUT", pending, "결정 결과를 확인하지 못했습니다.");
    if (result.ok || (!result.ok && result.conflict)) onChanged();
    if (!current(token)) return;
    busy = false;
    if (!result.ok && (result.status === 0 || result.status >= 500)) {
      update({ stage: "READY", error: `${result.message} 같은 요청으로 결과를 확인해 주세요.` });
      return;
    }
    pending = null;
    setPending(false);
    if (result.ok || result.conflict) await load(result.ok ? null : result.message);
    else update({ stage: "READY", error: result.message });
  }
  return {
    getSnapshot: () => session,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount: () => { mounted = true; busy = false; },
    dispose: () => { mounted = false; generation += 1; busy = false; onPendingChange?.(false); },
    load,
    async submit() {
      if (!editable()) return;
      const error = reviewDecisionError(session);
      if (error) { update({ error }); return; }
      const payload = checkInReviewPayload(session.review!.payload);
      pending = { requestId: newRequestId(), decision: session.decision, reason: session.reason.trim(),
        ...(session.decision === "ACCEPT" && !payload.mealKind && session.mealKind ? { mealKind: session.mealKind } : {}),
      };
      await runPending();
    },
    retry: runPending,
    setDecision(decision: ReviewDecision) { if (editable()) update({ decision, error: null }); },
    setReason(reason: string) { if (editable()) update({ reason, error: null }); },
    setMealKind(mealKind: MealKind | "") { if (editable()) update({ mealKind, error: null }); },
  };
}
