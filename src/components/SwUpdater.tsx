"use client";

import { useEffect } from "react";

const RELOAD_GUARD_KEY = "posanmeal-sw-reloaded";

export function SwUpdater() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const promptActivate = (worker: ServiceWorker) => {
      worker.postMessage({ type: "SKIP_WAITING" });
    };

    const onControllerChange = () => {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (cancelled) return;

        // If there's already a waiting worker when we register, activate it.
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptActivate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promptActivate(installing);
            }
          });
        });
      })
      .catch(() => {
        // registration failures are non-fatal
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
