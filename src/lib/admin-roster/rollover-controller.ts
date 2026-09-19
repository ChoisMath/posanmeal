import type { RolloverDecision, RolloverMissing, RolloverReview } from "@/lib/academic-year/rollover-service";
import { requestJson, sendMutation } from "./mutate";
import { newRequestId } from "./request-id";

type Acknowledgements = { uploads: boolean; paused: boolean; warnings: boolean };
type PendingMutation = { kind: "DECISION" | "ACTIVATE"; url: string; body: Record<string, unknown> };
export type RolloverSession = {
  stage: "IDLE" | "LOADING" | "READY" | "MUTATING" | "DONE";
  review: RolloverReview | null;
  acknowledgements: Acknowledgements;
  pending: boolean;
  error: string | null;
};
const unchecked = (): Acknowledgements => ({ uploads: false, paused: false, warnings: false });

export function decisionOptions(person: RolloverMissing): RolloverDecision[] {
  const endings: RolloverDecision[] = person.role === "STUDENT" ? ["GRADUATED", "TRANSFERRED"] : ["TRANSFERRED", "RETIRED"];
  return person.canRestore ? [...endings, "RESTORE"] : endings;
}

export function canActivateRollover(session: RolloverSession, isMain: boolean): boolean {
  const { review, acknowledgements } = session;
  return isMain && session.stage === "READY" && !session.pending && review !== null &&
    review.canActivate && review.issues.length === 0 &&
    review.missing.every((person) => person.decision !== null && person.decision !== "RESTORE") &&
    acknowledgements.uploads && acknowledgements.paused &&
    (!Object.values(review.warnings).some((count) => count > 0) || acknowledgements.warnings);
}

export function createRolloverController({ year, isMain, onChanged, onActivated }: {
  year: number; isMain: boolean; onChanged: () => void; onActivated: (year: number) => void;
}) {
  let session: RolloverSession = { stage: "IDLE", review: null, acknowledgements: unchecked(), pending: false, error: null };
  let busy = false;
  let mounted = true;
  let generation = 0;
  let pending: PendingMutation | null = null;
  const listeners = new Set<() => void>();
  const base = `/api/admin/academic-years/${year}`;
  const current = (token: number) => mounted && token === generation;

  function update(next: Partial<RolloverSession>) {
    session = { ...session, ...next };
    for (const listener of listeners) listener();
  }

  async function load(message: string | null = null): Promise<void> {
    if (!mounted || busy || pending) return;
    busy = true;
    const token = generation;
    update({ stage: "LOADING", review: null, acknowledgements: unchecked(), pending: false, error: message });
    const result = await requestJson<{ review: RolloverReview }>(`${base}/review`, { method: "POST" }, "전체 대조를 불러오지 못했습니다.");
    if (!current(token)) return;
    busy = false;
    if (!result.ok) {
      update({ stage: "IDLE", error: result.message });
    } else if (result.data.review.year !== year) {
      update({ stage: "IDLE", error: "검토 학년도가 다릅니다. 다시 불러오세요." });
    } else {
      update({ stage: "READY", review: result.data.review });
    }
  }

  async function runPending(): Promise<void> {
    if (!mounted || busy || !pending) return;
    busy = true;
    const operation = pending;
    const token = generation;
    update({ stage: "MUTATING", pending: true, error: null });
    const result = await sendMutation(operation.url, operation.kind === "DECISION" ? "PUT" : "POST", operation.body, "변경 결과를 확인하지 못했습니다.");
    if (result.ok) onChanged();
    if (!current(token)) return;
    busy = false;
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        update({ stage: "READY", error: `${result.message} 아래 버튼으로 같은 요청의 결과를 확인하세요.` });
        return;
      }
      pending = null;
      await load(`${result.message} 검토와 확인 항목을 다시 확인해 주세요.`);
      return;
    }
    pending = null;
    if (operation.kind === "ACTIVATE") {
      update({ stage: "DONE", pending: false });
      onActivated(year);
    } else {
      await load();
    }
  }

  return {
    getSnapshot: () => session,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount: () => { mounted = true; busy = false; },
    dispose: () => { mounted = false; generation += 1; busy = false; },
    load,
    acknowledge(key: keyof Acknowledgements, value: boolean) {
      if (!mounted || busy || pending || session.stage !== "READY") return;
      update({ acknowledgements: { ...session.acknowledgements, [key]: value } });
    },
    async decide(userId: number, decision: RolloverDecision) {
      if (!mounted || busy || pending || session.stage !== "READY" || !session.review) return;
      const person = session.review.missing.find((row) => row.userId === userId);
      if (!person || !decisionOptions(person).includes(decision)) return;
      pending = { kind: "DECISION", url: `${base}/decisions`, body: {
        requestId: newRequestId(), expectedVersion: session.review.version, userId, decision,
      } };
      await runPending();
    },
    async activate() {
      if (!mounted || busy || !canActivateRollover(session, isMain)) return;
      const review = session.review!;
      pending = { kind: "ACTIVATE", url: `${base}/activate`, body: {
        requestId: newRequestId(), expectedVersion: review.version,
        yearVersion: review.yearVersion, sourceVersion: review.sourceVersion,
        kiosksPaused: session.acknowledgements.uploads && session.acknowledgements.paused,
        warningsAcknowledged: session.acknowledgements.warnings,
      } };
      await runPending();
    },
    retry: runPending,
  };
}
