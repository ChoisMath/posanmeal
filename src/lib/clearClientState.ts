import { signOut } from "next-auth/react";

const KNOWN_IDB_NAMES = ["posanmeal-local"];

async function clearCaches() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // best-effort
  }
}

async function unregisterServiceWorkers() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // best-effort
  }
}

async function clearIndexedDB() {
  if (typeof indexedDB === "undefined") return;
  const names = new Set<string>(KNOWN_IDB_NAMES);
  // Chrome/Firefox expose databases(); Safari does not.
  const idbAny = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (typeof idbAny.databases === "function") {
    try {
      const list = await idbAny.databases();
      for (const info of list) if (info.name) names.add(info.name);
    } catch {
      // ignore
    }
  }
  await Promise.all(
    Array.from(names).map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        })
    )
  );
}

export async function clearClientBrowserState(): Promise<void> {
  await Promise.all([clearCaches(), unregisterServiceWorkers(), clearIndexedDB()]);
}

export async function clearClientStateAndSignOut(callbackUrl = "/"): Promise<void> {
  await clearClientBrowserState();
  try {
    await signOut({ redirect: false });
  } catch {
    // continue regardless
  }
  if (typeof window !== "undefined") {
    const sep = callbackUrl.includes("?") ? "&" : "?";
    window.location.replace(`${callbackUrl}${sep}reset=1`);
  }
}
