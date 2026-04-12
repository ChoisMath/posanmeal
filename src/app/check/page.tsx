"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { QRScanner } from "@/components/QRScanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import {
  getSetting,
  setSetting,
  getUser,
  getMealPeriod,
  getCheckIn,
  addCheckIn,
  getUnsyncedCheckIns,
  getUnsyncedCount,
  markCheckInsSynced,
  replaceAllUsers,
  replaceAllMealPeriods,
  clearSyncedCheckIns,
  clearAllData,
} from "@/lib/local-db";
import type { LocalUser } from "@/lib/local-db";
import { RefreshCw, Wifi, WifiOff, Trash2 } from "lucide-react";

interface CheckInResult {
  success: boolean;
  duplicate?: boolean;
  error?: string;
  user?: {
    id: number;
    name: string;
    role: string;
    grade?: number;
    classNum?: number;
    number?: number;
    photoUrl?: string;
  };
  type?: string;
  checkedAt?: string;
}

// AudioContext singleton
let _audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

function playChime() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.4;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 523;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 659;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.18);
    osc2.stop(ctx.currentTime + 0.38);
  } catch {}
}

function playLongBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.6;
    const osc = ctx.createOscillator();
    osc.frequency.value = 400;
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
  } catch {}
}

function playDoubleBeep() {
  try {
    const ctx = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.5;
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = 500;
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.2);
    const osc2 = ctx.createOscillator();
    osc2.frequency.value = 500;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.35);
    osc2.stop(ctx.currentTime + 0.55);
  } catch {}
}

function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalQR(data: string): { userId: number; generation: string; type: string } | null {
  const parts = data.split(":");
  if (parts.length !== 4 || parts[0] !== "posanmeal") return null;
  const userId = parseInt(parts[1], 10);
  if (isNaN(userId)) return null;
  return { userId, generation: parts[2], type: parts[3] };
}

export default function CheckPage() {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const processingRef = useRef(false);
  const [operationMode, setOperationMode] = useState<"online" | "local">("online");
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Register Service Worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  // Sync logic (defined before useEffect that references it)
  const performSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    setSyncMessage(null);

    try {
      // 1. Upload unsynced check-ins
      const unsynced = await getUnsyncedCheckIns();
      if (unsynced.length > 0) {
        const payload = unsynced.map((ci) => ({
          userId: ci.userId,
          date: ci.date,
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
          const ids = unsynced.map((ci) => ci.id!);
          await markCheckInsSynced(ids);
          setSyncMessage(`업로드: ${upData.accepted}건 전송, ${upData.duplicates}건 중복`);
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
        await replaceAllUsers(data.users);
        await replaceAllMealPeriods(data.mealPeriods);

        const now = new Date().toISOString();
        await setSetting("lastSyncAt", now);

        setOperationMode(data.operationMode);
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

  // Initialize mode and online status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      setTimeout(() => performSync(), 3000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Load mode: try IndexedDB first, then server API as fallback
    getSetting("operationMode").then(async (mode) => {
      if (mode === "local") {
        setOperationMode("local");
      } else if (navigator.onLine) {
        // IndexedDB empty or "online" — check server for actual mode
        try {
          const res = await fetch("/api/system/settings");
          if (res.ok) {
            const data = await res.json();
            if (data.operationMode === "local") {
              setOperationMode("local");
              await setSetting("operationMode", "local");
              await setSetting("qrGeneration", data.qrGeneration.toString());
            }
          }
        } catch {}
      }
    });
    getSetting("lastSyncAt").then((ts) => setLastSyncAt(ts || null));
    getUnsyncedCount().then(setUnsyncedCount);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [performSync]);

  // --- Online mode: existing server-based check-in ---
  const handleOnlineScan = useCallback(async (data: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data }),
      });
      const json = await res.json();
      setResult(json);

      if (json.success) playChime();
      else if (json.duplicate) playLongBeep();
      else playDoubleBeep();
    } catch {
      setResult({ success: false, error: "서버 연결 오류" });
      playDoubleBeep();
    }

    setTimeout(() => {
      setResult(null);
      processingRef.current = false;
    }, 2000);
  }, []);

  // --- Local mode: IndexedDB-based check-in ---
  const handleLocalScan = useCallback(async (data: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      // 1. Parse QR
      const parsed = parseLocalQR(data);
      if (!parsed) {
        setResult({ success: false, error: "잘못된 QR코드입니다." });
        playDoubleBeep();
        return;
      }

      // 2. Generation check
      const storedGen = await getSetting("qrGeneration");
      if (storedGen && parsed.generation !== storedGen) {
        setResult({ success: false, error: "QR코드가 만료되었습니다. 학생 앱에서 새 QR을 확인하세요." });
        playDoubleBeep();
        return;
      }

      // 3. User lookup
      const user = await getUser(parsed.userId);
      if (!user) {
        setResult({ success: false, error: "미등록 사용자입니다." });
        playDoubleBeep();
        return;
      }

      // 4. Role/type validation
      const validTypes: Record<string, string[]> = {
        STUDENT: ["STUDENT"],
        TEACHER: ["WORK", "PERSONAL"],
      };
      if (!validTypes[user.role]?.includes(parsed.type)) {
        setResult({ success: false, error: "잘못된 QR 유형입니다." });
        playDoubleBeep();
        return;
      }

      // 5. Meal period check (students only)
      if (user.role === "STUDENT") {
        const mp = await getMealPeriod(parsed.userId);
        const today = todayLocal();
        if (!mp) {
          setResult({ success: false, error: "석식 신청 기간이 없습니다." });
          playDoubleBeep();
          return;
        }
        if (today < mp.startDate || today > mp.endDate) {
          setResult({ success: false, error: "오늘은 석식 대상이 아닙니다." });
          playDoubleBeep();
          return;
        }
      }

      // 6. Duplicate check
      const today = todayLocal();
      const existing = await getCheckIn(parsed.userId, today);
      if (existing) {
        const time = new Date(existing.checkedAt);
        const hh = String(time.getHours()).padStart(2, "0");
        const mm = String(time.getMinutes()).padStart(2, "0");
        setResult({
          success: false,
          duplicate: true,
          user: { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number },
          checkedAt: existing.checkedAt,
          error: `이미 체크인되었습니다 (${hh}:${mm})`,
        });
        playLongBeep();
        return;
      }

      // 7. Save check-in
      const checkedAt = new Date().toISOString();
      await addCheckIn({
        userId: parsed.userId,
        date: today,
        checkedAt,
        type: parsed.type as "STUDENT" | "WORK" | "PERSONAL",
        synced: 0,
      });

      setResult({
        success: true,
        user: { id: user.id, name: user.name, role: user.role, grade: user.grade, classNum: user.classNum, number: user.number },
        type: parsed.type,
        checkedAt,
      });
      playChime();

      getUnsyncedCount().then(setUnsyncedCount);
    } catch {
      setResult({ success: false, error: "저장 오류가 발생했습니다. 다시 스캔해 주세요." });
      playDoubleBeep();
    } finally {
      setTimeout(() => {
        setResult(null);
        processingRef.current = false;
      }, 2000);
    }
  }, []);

  const handleScan = useCallback(
    (data: string) => {
      // Auto-detect: if QR starts with "posanmeal:", always use local handler
      if (data.startsWith("posanmeal:")) {
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

  const bgClass = result
    ? result.duplicate
      ? "bg-red-500"
      : result.success
        ? "bg-emerald-500"
        : "bg-amber-500"
    : "bg-background";

  return (
    <div className={`min-h-screen transition-colors duration-300 ${bgClass}`}>
      <BrandMark variant="overlay" href="/" label="홈으로" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Status Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-1.5 bg-black/60 text-white text-xs">
        <div className="flex items-center gap-3">
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-400"><Wifi className="h-3 w-3" /> 온라인</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400"><WifiOff className="h-3 w-3" /> 오프라인</span>
          )}
          <span className={operationMode === "local" ? "text-amber-400" : "text-white/70"}>
            {operationMode === "local" ? "로컬 모드" : "온라인 모드"}
          </span>
        </div>
        {operationMode === "local" && (
          <span className="text-white/70">미전송: {unsyncedCount}건</span>
        )}
      </div>

      {/* Main layout */}
      <div className="min-h-screen flex flex-col md:flex-row pt-8">
        {/* Camera Area */}
        <div className="bg-gray-900/95 p-4 md:p-6 md:flex-1 md:flex md:items-center md:justify-center">
          <div className="max-w-md mx-auto md:max-w-lg w-full">
            <QRScanner onScan={handleScan} />
          </div>
        </div>

        {/* Result Area */}
        <div className="p-6 md:flex-1 md:flex md:items-center md:justify-center">
          <div className="max-w-md mx-auto w-full">
            {result && (
              <div className="flex items-center gap-4 glass rounded-2xl p-5 card-elevated animate-in fade-in duration-200">
                {result.user?.photoUrl ? (
                  <img
                    src={result.user.photoUrl}
                    alt={result.user.name}
                    className="w-18 h-18 md:w-20 md:h-20 rounded-2xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-18 h-18 md:w-20 md:h-20 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0">
                    {result.user?.name?.charAt(0) || "?"}
                  </div>
                )}
                <div className="min-w-0">
                  {result.user?.role === "STUDENT" ? (
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white">
                      {result.user.grade}-{result.user.classNum}{" "}
                      {result.user.number}번 {result.user.name}
                    </p>
                  ) : result.user ? (
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white">
                      {result.user.name} 선생님
                    </p>
                  ) : null}

                  {result.success && (
                    <p className="text-emerald-700 dark:text-emerald-300 text-fit-sm mt-1.5 font-medium">
                      {result.user?.role === "TEACHER" && result.checkedAt
                        ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 석식 체크인 되었습니다.`
                        : "석식 체크인 되었습니다."}
                    </p>
                  )}

                  {result.duplicate && (
                    <p className="text-red-700 dark:text-red-300 text-fit-sm mt-1.5 font-semibold">
                      {result.error || "이미 체크인 되었습니다."}
                    </p>
                  )}

                  {!result.success && !result.duplicate && (
                    <p className="text-amber-800 dark:text-amber-200 text-fit-sm mt-1.5 font-medium">
                      {result.error || "인정되지 않는 QR입니다."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!result && (
              <div className="text-center text-muted-foreground">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
                <p className="text-lg font-semibold">QR 코드를 스캔해 주세요</p>
                <p className="text-sm mt-1 opacity-70">카메라에 QR 코드를 보여주세요</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sync Footer (local mode only) */}
      {operationMode === "local" && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/80 text-white text-xs px-4 py-2 flex items-center justify-between z-20">
          <div className="flex items-center gap-4">
            <span className="text-white/60">
              마지막 동기화: {lastSyncAt ? new Date(lastSyncAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음"}
            </span>
            {syncMessage && <span className="text-amber-400">{syncMessage}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearSynced}
              className="flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
              title="동기화된 체크인 정리"
            >
              <Trash2 className="h-3 w-3" /> 정리
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/30 hover:bg-red-500/50 transition-colors"
              title="전체 초기화"
            >
              <Trash2 className="h-3 w-3" /> 초기화
            </button>
            <button
              onClick={() => performSync()}
              disabled={syncing || !isOnline}
              className="flex items-center gap-1 px-3 py-1 rounded bg-blue-500/80 hover:bg-blue-500 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "동기화"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
