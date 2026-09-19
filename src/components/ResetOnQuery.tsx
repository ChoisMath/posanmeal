"use client";

import { useCallback, useEffect, useState } from "react";
import { ForceResetDialog } from "@/components/ForceResetDialog";
import { toast } from "sonner";
import { clearClientBrowserState } from "@/lib/clearClientState";
import { decideResetGuard, getPendingCheckInCounts, type PendingCheckInCounts } from "@/lib/local-db";

export function ResetOnQuery() {
  const [pending, setPending] = useState<PendingCheckInCounts | null>(null);

  const stripQuery = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("reset");
    params.delete("kept");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") !== "1") return;

    // 로그아웃이 이미 정리했고 기록만 남겼다는 뜻 — 다시 지우지 않고 한 번 알린다.
    const kept = Number(params.get("kept"));
    if (Number.isFinite(kept) && kept > 0) {
      toast.info(`미전송 체크인 ${kept}건은 기기에 보존했습니다.`);
      stripQuery();
      return;
    }

    let active = true;
    (async () => {
      // 갇힌 키오스크를 살리는 경로다. 서버에 없는 기록이 있으면 내보낸 뒤에만 지운다.
      let counts: PendingCheckInCounts;
      try {
        counts = await getPendingCheckInCounts();
      } catch {
        // 셀 수 없으면 지우지 않는다. 사람이 보고 결정하게 둔다.
        counts = { unsynced: 1, review: 0 };
      }
      if (!active) return;
      if (decideResetGuard(counts) === "NEEDS_FORCED") {
        setPending(counts);
        return;
      }
      await clearClientBrowserState();
      if (!active) return;
      stripQuery();
    })();

    return () => {
      active = false;
    };
  }, [stripQuery]);

  if (!pending) return null;

  return (
    <ForceResetDialog
      counts={pending}
      onClose={() => {
        setPending(null);
        stripQuery();
      }}
      onCleared={async () => {
        setPending(null);
        await clearClientBrowserState();
        stripQuery();
      }}
    />
  );
}
