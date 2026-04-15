"use client";

import { useEffect } from "react";
import { clearClientBrowserState } from "@/lib/clearClientState";

export function ResetOnQuery() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") !== "1") return;

    let active = true;
    (async () => {
      await clearClientBrowserState();
      if (!active) return;
      params.delete("reset");
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : "");
      window.history.replaceState({}, "", url);
    })();

    return () => {
      active = false;
    };
  }, []);

  return null;
}
