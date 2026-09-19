"use client";

import { useCallback, useEffect, useState } from "react";
import { ForceResetDialog } from "@/components/ForceResetDialog";
import { clearClientBrowserState } from "@/lib/clearClientState";
import { decideResetGuard, getPendingCheckInCounts, type PendingCheckInCounts } from "@/lib/local-db";

export function ResetOnQuery() {
  const [pending, setPending] = useState<PendingCheckInCounts | null>(null);

  const stripQuery = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("reset");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") !== "1") return;

    let active = true;
    (async () => {
      // 갇힌 키오스크를 살리는 경로다. 서버에 없는 기록이 있으면 내보낸 뒤에만 지운다.
      const counts = await getPendingCheckInCounts().catch(() => ({ unsynced: 0, review: 0 }));
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
