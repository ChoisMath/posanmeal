import type { YearState } from "@/lib/academic-year/contracts";
import { requestJson, sendMutation } from "./mutate";
import { newRequestId } from "./request-id";

type DraftState = {
  stage: "READY" | "BUSY" | "RELOADING" | "BLOCKED" | "DONE";
  controlVersion: number;
  pending: boolean;
  error: string | null;
};
type DraftRequest = { requestId: string; expectedVersion: number; year: number; sourceYear: number };

export function createDraftController({ activeYear, controlVersion, onChanged, onCreated }: {
  activeYear: number; controlVersion: number; onChanged: () => void; onCreated: (year: number) => void;
}) {
  let state: DraftState = { stage: "READY", controlVersion, pending: false, error: null };
  let pending: DraftRequest | null = null;
  let mounted = true;
  let busy = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const current = (token: number) => mounted && token === generation;
  function update(next: Partial<DraftState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  async function refresh(message: string | null = null) {
    if (!mounted || busy || pending) return;
    busy = true;
    const token = generation;
    update({ stage: "RELOADING", pending: false, error: message });
    const result = await requestJson<{ years: { year: number; state: YearState }[]; controlVersion: number }>(
      "/api/admin/academic-years", {}, "학년도 상태를 다시 불러오지 못했습니다.",
    );
    if (!current(token)) return;
    busy = false;
    if (!result.ok) {
      update({ stage: "BLOCKED", error: result.message });
      return;
    }
    const active = result.data.years.find((year) => year.state === "ACTIVE");
    if (active?.year !== activeYear) {
      update({ stage: "BLOCKED", error: "운영 학년도가 변경되었습니다. 창을 닫고 최신 학년도에서 다시 준비하세요." });
    } else if (result.data.years.some((year) => year.year === activeYear + 1)) {
      update({ stage: "BLOCKED", error: `${activeYear + 1}학년도가 이미 있습니다. 창을 닫고 학년도 목록에서 선택하세요.` });
    } else {
      update({ stage: "READY", controlVersion: result.data.controlVersion });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount: () => { mounted = true; busy = false; },
    dispose: () => { mounted = false; generation += 1; busy = false; },
    refresh,
    async create() {
      if (!mounted || busy || state.stage !== "READY") return;
      pending ??= { requestId: newRequestId(), expectedVersion: state.controlVersion, year: activeYear + 1, sourceYear: activeYear };
      const body = pending;
      const token = generation;
      busy = true;
      update({ stage: "BUSY", pending: true, error: null });
      const result = await sendMutation("/api/admin/academic-years", "POST", body, "초안 생성 결과를 확인하지 못했습니다.");
      if (result.ok || (!result.ok && result.conflict)) onChanged();
      if (!current(token)) return;
      busy = false;
      if (result.ok) {
        pending = null;
        update({ stage: "DONE", pending: false });
        onCreated(activeYear + 1);
      } else if (result.status === 0 || result.status >= 500) {
        update({ stage: "READY", error: `${result.message} 같은 요청으로 결과를 다시 확인하세요.` });
      } else {
        pending = null;
        update({ pending: false, error: result.message, stage: "READY" });
        if (result.conflict) await refresh(`${result.message} 복사할 학년도를 다시 확인하고 생성하세요.`);
      }
    },
  };
}
