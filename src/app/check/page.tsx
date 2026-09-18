"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import {
  getSetting,
  setSetting,
  getUser,
  isEligible,
  getCheckIn,
  addCheckIn,
  getUnsyncedCheckIns,
  getUnsyncedCount,
  markCheckInsSynced,
  replaceAllUsers,
  replaceAllEligibleUsers,
  replaceAllEligibleEntries,
  clearSyncedCheckIns,
  clearAllData,
} from "@/lib/local-db";
import { RefreshCw, QrCode, ScanFace, Wifi, WifiOff, Trash2 } from "lucide-react";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "@/lib/meal-kind-local";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { postCheckInWithRetry, type CheckInResult } from "@/lib/checkin-client";
import { playDenied, playDuplicate, playError, playLockClick, playSuccess } from "@/lib/checkin-sounds";
import { RESULT_BORDER_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";
import { isLocalQR, runLocalQrCheckIn } from "@/lib/qr-checkin-local";
import { fetchKioskSettings, loadSavedKioskSettings } from "@/lib/kiosk-sync";

const localQrRepo = { getSetting, getUser, isEligible, getCheckIn, addCheckIn };

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
  const prevModeRef = useRef<"online" | "local">("online");

  // Service Worker registration is handled globally in <SwUpdater /> (layout).

  // Sync logic (defined before useEffect that references it)
  const performSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      // 1. Upload unsynced check-ins
      const unsynced = await getUnsyncedCheckIns();
      if (unsynced.length > 0) {
        const payload = unsynced
          .filter((ci) => typeof ci.id === "number")
          .map((ci) => ({
            clientId: ci.id!,
            userId: ci.userId,
            date: ci.date,
            mealKind: ci.mealKind,
            checkedAt: ci.checkedAt,
            type: ci.type,
          }));

        const upRes = await fetch("/api/sync/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkins: payload }),
        });

        if (upRes.ok) {
          const upData = await upRes.json();
          const syncedIds: number[] = Array.isArray(upData.syncedClientIds)
            ? upData.syncedClientIds.filter((id: unknown): id is number => typeof id === "number")
            : [];
          if (syncedIds.length > 0) {
            await markCheckInsSynced(syncedIds);
          }
          const accepted = upData.acceptedCount ?? 0;
          const duplicates = upData.duplicatesCount ?? 0;
          const rejectedCount = upData.rejectedCount ?? 0;
          setSyncRejectedCount(rejectedCount);
          let msg = `업로드: ${accepted}건 전송, ${duplicates}건 중복`;
          if (rejectedCount > 0) msg += `, 미반영 ${rejectedCount}건 (재시도 대기)`;
          setSyncMessage(msg);
        } else if (upRes.status === 403) {
          setSyncMessage("업로드 실패: 관리자 로그인이 필요합니다. /admin/login에서 먼저 로그인하세요.");
          setSyncing(false);
          return;
        } else {
          const errData = await upRes.json().catch(() => ({}));
          setSyncMessage(`업로드 실패 (${upRes.status}): ${errData.error || "알 수 없는 오류"}`);
          setSyncing(false);
          return;
        }
      }

      // 2. Download latest data
      const downRes = await fetch("/api/sync/download");
      if (downRes.ok) {
        const data = await downRes.json();

        await setSetting("operationMode", data.operationMode);
        await setSetting("qrGeneration", data.qrGeneration.toString());
        await setSetting("mealWindows", JSON.stringify(data.mealWindows || DEFAULT_MEAL_WINDOWS));
        await replaceAllUsers(data.users);
        if (Array.isArray(data.eligibleEntries)) {
          await replaceAllEligibleEntries(data.eligibleEntries);
        } else {
          await replaceAllEligibleUsers(data.eligibleUserIds);
        }

        const now = new Date().toISOString();
        await setSetting("lastSyncAt", now);

        setOperationMode(data.operationMode);
        setMealWindows(data.mealWindows || DEFAULT_MEAL_WINDOWS);
        setLastSyncAt(now);

        // Check server time drift
        const serverTime = new Date(data.serverTime).getTime();
        const localTime = Date.now();
        if (Math.abs(serverTime - localTime) > 30 * 60 * 1000) {
          setSyncMessage((prev) =>
            (prev ? prev + " | " : "") + "경고: 태블릿 시계를 확인하세요 (서버와 30분 이상 차이)"
          );
        }

        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "다운로드 완료"
        );
      } else if (downRes.status === 403) {
        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "관리자 재로그인이 필요합니다"
        );
      } else {
        setSyncMessage((prev) =>
          (prev ? prev + " | " : "") + "다운로드 실패"
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Sync error:", err);
      setSyncMessage(`동기화 오류: ${msg}`);
    }

    await getUnsyncedCount().then(setUnsyncedCount);
    setSyncing(false);
  }, []);

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

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(pollInterval);
    };
  }, [fetchMode, performSync]);

  // --- Online mode: existing server-based check-in ---
  const handleOnlineScan = useCallback(async (data: string) => {
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
    if (processingRef.current) {
      playLockClick();
      return;
    }
    processingRef.current = true;

    try {
      const json = await runLocalQrCheckIn({ data, now: new Date(), mealWindows }, localQrRepo);
      setResult(json);
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
  }, [mealWindows]);

  const handleScan = useCallback(
    (data: string) => {
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

  async function handleClearAll() {
    if (!confirm("모든 로컬 데이터를 삭제하시겠습니까? 미전송 체크인도 삭제됩니다.")) return;
    if (!confirm("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    await clearAllData();
    setOperationMode("online");
    setUnsyncedCount(0);
    setLastSyncAt(null);
    setSyncMessage("모든 로컬 데이터가 삭제되었습니다.");
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
    <div className="flex h-dvh flex-col overflow-hidden bg-gray-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white">

      {/* Status Bar */}
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-xs sm:px-3">
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

      <main className="flex min-h-0 flex-1 flex-col gap-2 px-2 sm:px-3">
        <section
          aria-label="카메라 화면"
          className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl border-[10px] bg-black transition-colors duration-300 sm:border-[14px] ${borderClass}`}
        >
          {modeLoaded ? (
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
          className="flex h-16 shrink-0 items-center overflow-x-auto rounded-xl bg-white px-3 text-slate-900 sm:h-20 sm:px-4 dark:bg-slate-900 dark:text-white"
        >
          {result ? (
            <div className="mx-auto flex w-max items-center gap-3 whitespace-nowrap">
              {result.user?.photoUrl ? (
                <img
                  src={result.user.photoUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover sm:h-12 sm:w-12"
                />
              ) : result.user ? (
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-lg font-bold text-slate-700 sm:h-12 sm:w-12">
                  {result.user.name.charAt(0)}
                </span>
              ) : null}
              {result.user && (
                <span className="text-base font-bold sm:text-xl">
                  {result.user.role === "STUDENT"
                    ? `${result.user.grade}학년 ${result.user.classNum}반 ${result.user.number}번 ${result.user.name}`
                    : `${result.user.name} 선생님`}
                </span>
              )}
              {result.user && <span aria-hidden="true" className="text-slate-400">·</span>}
              <span className={`text-sm font-semibold sm:text-lg ${RESULT_TEXT_CLASS[resultCategory(result)]}`}>
                {result.success
                  ? result.user?.role === "TEACHER" && result.checkedAt
                    ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 ${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 되었습니다.`
                    : `${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 하였습니다.`
                  : result.error || (result.duplicate ? "이미 체크인 되었습니다." : result.notApplicant ? "신청자가 아닙니다." : "인정되지 않는 QR입니다.")}
              </span>
            </div>
          ) : (
            <p className="mx-auto flex w-max items-center gap-2 whitespace-nowrap text-base font-medium sm:text-xl">
              <QrCode className="h-5 w-5 shrink-0" />
              QR 코드를 카메라에 보여주세요
            </p>
          )}
        </div>
      </main>

      {/* 하단 바: 로컬 동기화 + 얼굴 체크인 이동 (/facecheck 하단 바와 같은 위치·모양) */}
      <div className="flex shrink-0 items-center justify-end gap-2 p-2 text-white text-xs sm:px-3">
        {(operationMode === "local" || unsyncedCount > 0 || syncRejectedCount > 0) && (
          <div className="mr-auto flex items-center gap-2 min-w-0 overflow-x-auto">
            <button
              onClick={() => performSync()}
              disabled={syncing || !isOnline}
              className="min-h-11 flex items-center gap-1 px-4 rounded-full bg-blue-500/90 hover:bg-blue-500 disabled:opacity-40 transition-colors text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "동기화"}
            </button>
            <button
              onClick={handleClearSynced}
              className="min-h-11 flex items-center gap-1 px-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
              title="동기화된 체크인 정리"
            >
              <Trash2 className="h-3 w-3" /> 정리
            </button>
            <button
              onClick={handleClearAll}
              className="min-h-11 flex items-center gap-1 px-3 rounded-full bg-red-500/30 hover:bg-red-500/50 transition-colors whitespace-nowrap shrink-0"
              title="전체 초기화"
            >
              <Trash2 className="h-3 w-3" /> 초기화
            </button>
            <span className="text-white/80 whitespace-nowrap">
              마지막 동기화: {lastSyncAt ? new Date(lastSyncAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음"}
            </span>
            {syncRejectedCount > 0 && (
              <span className="px-2 py-0.5 rounded bg-red-500 text-white font-semibold whitespace-nowrap">
                서버 미반영 {syncRejectedCount}건 — 재시도 대기
              </span>
            )}
            {syncMessage && (
              <span className="text-amber-300 whitespace-nowrap" title={syncMessage}>
                {syncMessage}
              </span>
            )}
          </div>
        )}
        {/* 오프라인에서도 열리도록 <Link> 대신 전체 이동 — SW가 /facecheck 내비게이션을 캐시로 응답한다 */}
        <a
          href="/facecheck"
          className="min-h-11 px-5 rounded-full bg-white/90 dark:bg-black/70 text-gray-900 dark:text-white font-semibold text-sm shadow-lg flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <ScanFace className="h-4 w-4" /> 얼굴로 체크인
        </a>
      </div>
    </div>
  );
}
