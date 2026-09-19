"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import { KioskViewport } from "@/components/KioskViewport";
import {
  getSetting,
  getUser,
  isEligible,
  getCheckIn,
  addCheckIn,
  getDeviceId,
  getLocalSnapshotState,
  getSnapshotHeader,
  getUnsyncedCount,
  getPendingCheckInCounts,
  clearSyncedCheckIns,
  clearAllData,
  decideResetGuard,
  type PendingCheckInCounts,
} from "@/lib/local-db";
import { ForceResetDialog } from "@/components/ForceResetDialog";
import { RefreshCw, QrCode, ScanFace, Wifi, WifiOff, Trash2 } from "lucide-react";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { postCheckInWithRetry, type CheckInResult } from "@/lib/checkin-client";
import { playDenied, playDuplicate, playError, playLockClick, playSuccess } from "@/lib/checkin-sounds";
import { RESULT_BORDER_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";
import { isLocalQR, runLocalQrCheckIn } from "@/lib/qr-checkin-local";
import { fetchKioskSettings, loadSavedKioskSettings, performKioskSync } from "@/lib/kiosk-sync";
import { isSnapshotStale } from "@/lib/academic-year/local-snapshot";

const localQrRepo = {
  getSetting, getUser, isEligible, getCheckIn, addCheckIn,
  getSnapshotState: getLocalSnapshotState, getDeviceId,
};

export default function CheckPage() {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const processingRef = useRef(false);
  const [operationMode, setOperationMode] = useState<"online" | "local">("online");
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncRejectedCount, setSyncRejectedCount] = useState(0);
  const [modeLoaded, setModeLoaded] = useState(false);
  const [mealWindows, setMealWindows] = useState<MealWindows>(DEFAULT_MEAL_WINDOWS);
  const [staleRoster, setStaleRoster] = useState(false);
  const [resetPending, setResetPending] = useState<PendingCheckInCounts | null>(null);
  const resettingRef = useRef(false);
  const prevModeRef = useRef<"online" | "local">("online");

  // Service Worker registration is handled globally in <SwUpdater /> (layout).

  // 저장된 근거의 freshUntil로 판단한다 — 새로고침 직후에도 바로 보이게.
  const refreshStaleRoster = useCallback(async () => {
    try {
      setStaleRoster(isSnapshotStale(await getSnapshotHeader(), new Date()));
    } catch {
      // 표시용이다. 실패해도 체크인은 계속된다.
    }
  }, []);

  // Sync logic (defined before useEffect that references it)
  const performSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      // QR만 쓰는 태블릿에 얼굴 임베딩을 내려보내지 않는다.
      const outcome = await performKioskSync({ faces: false });
      setSyncMessage(outcome.message);
      setSyncRejectedCount(outcome.rejectedCount + outcome.reviewCount);
      if (outcome.ok) {
        const saved = await loadSavedKioskSettings();
        setOperationMode(saved.operationMode);
        setMealWindows(saved.mealWindows);
        setLastSyncAt((await getSetting("lastSyncAt")) ?? null);
        await refreshStaleRoster();
      }
    } catch (err) {
      console.error("Sync error:", err);
      setSyncMessage("동기화 오류가 발생했습니다.");
    }
    await getUnsyncedCount().then(setUnsyncedCount);
    setSyncing(false);
  }, [refreshStaleRoster]);

  // Fetch mode from server (fetchKioskSettings also persists it to IndexedDB), return mode or null
  const fetchMode = useCallback(async (): Promise<"online" | "local" | null> => {
    const fetched = await fetchKioskSettings();
    if (!fetched) return null;
    setOperationMode(fetched.operationMode);
    setMealWindows(fetched.mealWindows);
    return fetched.operationMode;
  }, []);

  // Initialize mode and online status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    // Fetch mode and auto-sync when transitioning online→local
    const fetchAndMaybeSync = async () => {
      const newMode = await fetchMode();
      if (newMode && newMode === "local" && prevModeRef.current === "online") {
        performSync();
      }
      if (newMode) prevModeRef.current = newMode;
    };

    // Initial load
    (async () => {
      const loaded = await fetchMode();
      if (loaded) {
        prevModeRef.current = loaded;
      } else {
        // Offline or server unreachable: use IndexedDB
        try {
          const saved = await loadSavedKioskSettings();
          setOperationMode(saved.operationMode);
          prevModeRef.current = saved.operationMode;
          setMealWindows(saved.mealWindows);
        } catch {}
      }
      setModeLoaded(true);
    })();

    const handleOnline = () => {
      setIsOnline(true);
      fetchAndMaybeSync();
      setTimeout(() => performSync(), 3000);
    };
    const handleOffline = () => setIsOnline(false);

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        fetchAndMaybeSync();
      }
    };

    // Poll settings every 15 seconds to detect admin mode changes
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchAndMaybeSync();
      }
    }, 15_000);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    getSetting("lastSyncAt").then((ts) => setLastSyncAt(ts || null));
    getUnsyncedCount().then(setUnsyncedCount);
    refreshStaleRoster();
    const staleInterval = setInterval(refreshStaleRoster, 60_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(pollInterval);
      clearInterval(staleInterval);
    };
  }, [fetchMode, performSync, refreshStaleRoster]);

  // --- Online mode: existing server-based check-in ---
  const handleOnlineScan = useCallback(async (data: string) => {
    if (resettingRef.current) return;
    if (processingRef.current) {
      playLockClick();
      return;
    }
    processingRef.current = true;

    try {
      const json = await postCheckInWithRetry(data);
      setResult(json);

      if (json.success) playSuccess();
      else if (json.duplicate) playDuplicate();
      else if (json.notApplicant) playDenied();
      else playError();
    } catch {
      setResult({ success: false, error: "서버 연결 오류" });
      playError();
    }

    setTimeout(() => {
      processingRef.current = false;
    }, 1000);
    setTimeout(() => {
      setResult(null);
    }, 2000);
  }, []);

  // --- Local mode: IndexedDB-based check-in (판정 로직은 /facecheck QR 모드와 공용) ---
  const handleLocalScan = useCallback(async (data: string) => {
    if (resettingRef.current) return;
    if (processingRef.current) {
      playLockClick();
      return;
    }
    processingRef.current = true;

    try {
      const json = await runLocalQrCheckIn({ data, now: new Date(), mealWindows }, localQrRepo);
      setResult(json);
      if (json.stale) setStaleRoster(true);
      else refreshStaleRoster();
      const category = resultCategory(json);
      if (category === "success") playSuccess();
      else if (category === "duplicate") playDuplicate();
      else if (category === "notApplicant") playDenied();
      else playError();
      if (json.success) getUnsyncedCount().then(setUnsyncedCount);
    } catch {
      setResult({ success: false, error: "저장 오류가 발생했습니다. 다시 스캔해 주세요." });
      playError();
    } finally {
      setTimeout(() => {
        processingRef.current = false;
      }, 1000);
      setTimeout(() => {
        setResult(null);
      }, 2000);
    }
  }, [mealWindows, refreshStaleRoster]);

  const handleScan = useCallback(
    (data: string) => {
      if (resettingRef.current) return;
      // Auto-detect: printed-card/local QR always goes through the local handler
      if (isLocalQR(data)) {
        handleLocalScan(data);
      } else if (operationMode === "local") {
        // Local mode but got a non-posanmeal QR (e.g. JWT) — reject
        handleLocalScan(data);
      } else {
        handleOnlineScan(data);
      }
    },
    [operationMode, handleLocalScan, handleOnlineScan]
  );

  async function handleClearSynced() {
    if (!confirm("동기화 완료된 체크인 기록을 삭제하시겠습니까?")) return;
    const count = await clearSyncedCheckIns();
    setSyncMessage(`${count}건의 동기화된 기록을 정리했습니다.`);
  }

  function afterReset() {
    resettingRef.current = false;
    setOperationMode("online");
    setUnsyncedCount(0);
    setLastSyncAt(null);
    setStaleRoster(false);
    setResetPending(null);
    setSyncMessage("모든 로컬 데이터가 삭제되었습니다.");
  }

  async function handleClearAll() {
    resettingRef.current = true;
    try {
      const counts = await getPendingCheckInCounts();
      if (decideResetGuard(counts) === "NEEDS_FORCED") {
        setResetPending(counts);
        return;
      }
      if (!confirm("모든 로컬 데이터를 삭제하시겠습니까?")) {
        resettingRef.current = false;
        return;
      }
      // 기록 0건을 확인한 뒤에도 다른 탭이나 진행 중 스캔이 저장할 수 있다.
      await clearAllData({ exported: [], scope: "PENDING" });
      afterReset();
    } catch (error) {
      const counts = await getPendingCheckInCounts();
      if (decideResetGuard(counts) === "NEEDS_FORCED") setResetPending(counts);
      else resettingRef.current = false;
      setSyncMessage(error instanceof Error ? error.message : "초기화하지 못했습니다.");
    }
  }

  const formatCheckedAt = (checkedAt: string) => {
    const d = new Date(checkedAt);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}월 ${day}일 ${hour}:${minute}시`;
  };

  const typeLabel = (type?: string) => {
    if (type === "WORK") return "근무";
    if (type === "PERSONAL") return "개인";
    return "";
  };

  const borderClass = result ? RESULT_BORDER_CLASS[resultCategory(result)] : "border-slate-700";

  return (
    <KioskViewport>
      {/* Status Bar */}
      <div className="flex shrink-0 items-center gap-2 px-2 text-xs sm:px-3">
        <BrandMark variant="overlay" href="/" label="홈으로" className="static min-h-11 shrink-0 whitespace-nowrap" />

        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-400 whitespace-nowrap"><Wifi className="h-3 w-3" /> 온라인</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 whitespace-nowrap"><WifiOff className="h-3 w-3" /> 오프라인</span>
          )}
          <span className={`whitespace-nowrap ${operationMode === "local" ? "text-amber-400" : "text-white/70"}`}>
            {operationMode === "local" ? "로컬 모드" : "온라인 모드"}
          </span>
        </div>
        {(operationMode === "local" || unsyncedCount > 0) && (
          <span className="text-white/70 whitespace-nowrap">미전송: {unsyncedCount}건</span>
        )}
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 px-2 sm:px-3">
        <section
          aria-label="카메라 화면"
          className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl border-[10px] bg-black transition-colors duration-300 sm:border-[14px] ${borderClass}`}
        >
          {resetPending ? (
            <p className="flex h-full items-center justify-center whitespace-nowrap text-white/70">초기화 확인 중 · 스캔 일시 중지</p>
          ) : modeLoaded ? (
            <QRScanner onScan={handleScan} />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-white/70">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <p className="whitespace-nowrap">모드 확인 중...</p>
            </div>
          )}
        </section>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="kiosk-status flex min-w-0 shrink-0 items-center overflow-x-auto overflow-y-hidden rounded-lg bg-white px-2 text-slate-900 sm:px-3"
        >
          {result ? (
            <div className="mx-auto flex w-max shrink-0 items-center gap-2 whitespace-nowrap">
              {result.user?.photoUrl ? (
                <img
                  src={result.user.photoUrl}
                  alt=""
                  className="kiosk-result-avatar shrink-0 rounded-md object-cover"
                />
              ) : result.user ? (
                <span aria-hidden="true" className="kiosk-result-avatar flex shrink-0 items-center justify-center rounded-md bg-slate-200 text-base font-bold text-slate-700">
                  {result.user.name.charAt(0)}
                </span>
              ) : null}
              {result.user && (
                <span className="text-sm font-bold sm:text-base">
                  {result.user.role === "STUDENT"
                    ? `${result.user.grade != null && result.user.classNum != null && result.user.number != null ? `${result.user.grade}학년 ${result.user.classNum}반 ${result.user.number}번 ` : ""}${result.user.name}`
                    : `${result.user.name} 선생님`}
                </span>
              )}
              {result.user && <span aria-hidden="true" className="text-slate-400">·</span>}
              <span className={`text-sm font-semibold sm:text-base ${RESULT_TEXT_CLASS[resultCategory(result)]}`}>
                {result.success
                  ? result.user?.role === "TEACHER" && result.checkedAt
                    ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 ${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 되었습니다.`
                    : `${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 하였습니다.`
                  : result.error || (result.duplicate ? "이미 체크인 되었습니다." : result.notApplicant ? "신청자가 아닙니다." : "인정되지 않는 QR입니다.")}
              </span>
            </div>
          ) : (
            <p className="mx-auto flex w-max shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium sm:text-base">
              <QrCode className="h-5 w-5 shrink-0" />
              QR 코드를 카메라에 보여주세요
            </p>
          )}
        </div>
      </main>

      <footer className="kiosk-footer shrink-0 px-2 text-white sm:px-3">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {(operationMode === "local" || unsyncedCount > 0 || syncRejectedCount > 0) && (
            <div className="mr-auto flex shrink-0 items-center gap-2">
              <button
                onClick={() => performSync()}
                disabled={syncing || !isOnline}
                className="kiosk-action flex items-center gap-1 rounded-full bg-blue-500/90 px-3 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-blue-500 disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "동기화 중..." : "동기화"}
              </button>
              <button
                onClick={handleClearSynced}
                className="kiosk-action flex items-center gap-1 rounded-full bg-white/10 px-2 text-xs whitespace-nowrap transition-colors hover:bg-white/20"
                title="동기화된 체크인 정리"
              >
                <Trash2 className="h-3 w-3" /> 정리
              </button>
              <button
                onClick={handleClearAll}
                className="kiosk-action flex items-center gap-1 rounded-full bg-red-500/30 px-2 text-xs whitespace-nowrap transition-colors hover:bg-red-500/50"
                title="전체 초기화"
              >
                <Trash2 className="h-3 w-3" /> 초기화
              </button>
            </div>
          )}
          {/* 오프라인 이동은 SW가 캐시한 /facecheck 문서를 사용한다. */}
          <a
            href="/facecheck"
            className="kiosk-action flex items-center gap-2 rounded-full bg-white/90 px-3 text-sm font-semibold text-gray-900 whitespace-nowrap"
          >
            <ScanFace className="h-4 w-4" /> 얼굴로 체크인
          </a>
        </div>
        {(operationMode === "local" || unsyncedCount > 0 || syncRejectedCount > 0) && (
          <div className="kiosk-sync-details flex min-w-0 items-center gap-2 overflow-x-auto text-xs leading-5">
            <span className="text-white/80 whitespace-nowrap">
              마지막 동기화: {lastSyncAt ? new Date(lastSyncAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음"}
            </span>
            {syncRejectedCount > 0 && (
              <span className="rounded bg-red-500 px-2 font-semibold whitespace-nowrap">
                서버 미반영 {syncRejectedCount}건 — 재시도 대기
              </span>
            )}
            {staleRoster && (
              <span className="rounded border border-amber-400 bg-transparent px-2 font-semibold whitespace-nowrap text-amber-300">재동기화 필요</span>
            )}
            {syncMessage && <span className="text-amber-300 whitespace-nowrap" title={syncMessage}>{syncMessage}</span>}
          </div>
        )}
      </footer>

      {resetPending && (
        <ForceResetDialog
          counts={resetPending}
          onClose={() => { resettingRef.current = false; setResetPending(null); }}
          onSync={() => {
            resettingRef.current = false;
            setResetPending(null);
            performSync();
          }}
          onCleared={afterReset}
        />
      )}
    </KioskViewport>
  );
}
