import { signOut } from "next-auth/react";
import {
  DB_NAME,
  clearAllData,
  decideClientStateReset,
  getPendingCheckInCounts,
  type PendingCheckInCounts,
} from "@/lib/local-db";

const KNOWN_IDB_NAMES = [DB_NAME];

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

async function clearIndexedDB(keep: ReadonlySet<string>) {
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
    Array.from(names)
      .filter((name) => !keep.has(name))
      .map(
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

export interface ClearClientStateResult {
  /** 지우지 않고 남긴 체크인 수(미전송 + 검토 대기). 0이면 전부 지웠다. */
  keptCheckIns: number;
}

/**
 * 관리자는 동기화하려고 바로 그 키오스크 태블릿에서 로그인한다. 로그아웃이 아직
 * 서버에 없는 기록을 지워 버리면 되돌릴 방법이 없으므로, 그때는 키오스크 DB만 남긴다.
 * 로그아웃 자체는 어떤 경우에도 막지 않는다.
 */
export async function clearClientBrowserState(): Promise<ClearClientStateResult> {
  let counts: PendingCheckInCounts = { unsynced: 0, review: 0 };
  try {
    counts = await getPendingCheckInCounts();
  } catch {
    // 셀 수 없으면 보수적으로 남긴다.
    counts = { unsynced: 1, review: 0 };
  }

  // 남겨야 할 때는 키오스크 DB를 통째로 둔다(명부·자격·얼굴·근거·설정·기록·기기 번호).
  // 명부만 비우면 로컬 모드 체크인이 전부 실패하고, 복구에 방금 끝낸 관리자 로그인이 필요하다.
  let keepKioskDb = decideClientStateReset(counts) === "KEEP_KIOSK_DB";
  if (!keepKioskDb) {
    try {
      await clearAllData({ exported: [], scope: "PENDING" });
    } catch {
      keepKioskDb = true;
      try {
        counts = await getPendingCheckInCounts();
      } catch {
        counts = { unsynced: 1, review: 0 };
      }
    }
  }

  await Promise.all([
    clearCaches(),
    unregisterServiceWorkers(),
    // 지연된 deleteDatabase가 원자 clear 이후 다른 탭이 찍은 기록까지 지우면 안 된다.
    clearIndexedDB(new Set([DB_NAME])),
  ]);

  return { keptCheckIns: keepKioskDb ? counts.unsynced + counts.review : 0 };
}

export async function clearClientStateAndSignOut(callbackUrl = "/"): Promise<void> {
  const { keptCheckIns } = await clearClientBrowserState();
  try {
    await signOut({ redirect: false });
  } catch {
    // continue regardless
  }
  if (typeof window !== "undefined") {
    const sep = callbackUrl.includes("?") ? "&" : "?";
    const kept = keptCheckIns > 0 ? `&kept=${keptCheckIns}` : "";
    window.location.replace(`${callbackUrl}${sep}reset=1${kept}`);
  }
}
