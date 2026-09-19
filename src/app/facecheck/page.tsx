"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Human } from "@vladmandic/human";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import { KioskViewport } from "@/components/KioskViewport";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MEAL_LABEL, studentNumberOf } from "@/lib/meal-plan";
import { DEFAULT_MEAL_WINDOWS, type MealKind } from "@/lib/meal-kind-local";
import { postCheckInWithRetry } from "@/lib/checkin-client";
import { isLocalQR, runLocalQrCheckIn } from "@/lib/qr-checkin-local";
import { playDenied, playDuplicate, playError, playSuccess } from "@/lib/checkin-sounds";
import { RESULT_BORDER_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";
import { UnmatchedTracker } from "@/lib/unmatched-tracker";
import { detectFaces, getActiveFaceBackend, loadHuman, qualityIssue } from "@/lib/human-client";
import { nextDetectDelay, resolveFaceBackends } from "@/lib/face-pacing";
import { enrollmentQualityIssue } from "@/lib/face-quality";
import { FaceStabilityTracker } from "@/lib/face-stability";
import {
  runLocalFaceCheckIn,
  toFaceCandidates,
  type FaceCheckResult,
  type FaceCheckUser,
} from "@/lib/facecheck-local";
import {
  fetchKioskSettings,
  loadSavedKioskSettings,
  performKioskSync,
  type KioskSettings,
} from "@/lib/kiosk-sync";
import {
  addCheckIn,
  getAllFaceProfiles,
  getCheckIn,
  getDeviceId,
  getLocalSnapshotState,
  getSetting,
  getUnsyncedCount,
  getUser,
  isEligible,
} from "@/lib/local-db";
import type { FaceCandidate, MatchScore } from "@/lib/face-match";
import { LoaderCircle, QrCode, RefreshCw, ScanFace, Wifi, WifiOff } from "lucide-react";

interface PendingConfirmation {
  user: FaceCheckUser;
  mealKind: MealKind;
  date: string;
  embedding: number[];
  gen: number;
  expiresAt: number;
  local: boolean;
}

// 얼굴 루프의 화면 표시용 단계. busyRef(루프 정지 플래그)와 반드시 함께 바뀐다.
type ScanPhase = "loading" | "scanning" | "processing" | "waiting" | "blocked";

const PHASE_LABEL: Record<ScanPhase, string> = {
  loading: "준비 중",
  scanning: "인식 준비",
  processing: "인식 중",
  waiting: "대기 중",
  blocked: "중단",
};

function PhaseIndicator({ phase, className = "" }: { phase: ScanPhase; className?: string }) {
  if (phase === "scanning") {
    return (
      <span className={`relative flex h-2.5 w-2.5 shrink-0 ${className}`}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (phase === "blocked") {
    return <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 ${className}`} />;
  }
  return <LoaderCircle className={`h-3.5 w-3.5 shrink-0 animate-spin ${className}`} />;
}

const RESULT_DISPLAY_MS = 2000;
const CONFIRMATION_TIMEOUT_S = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const STABILITY_COOLDOWN_MS = 200;
const KIOSK_KEY_STORAGE = "facecheck.kioskKey";
const BACKEND_STORAGE = "facecheck.backend";
const MAX_LOOP_FAILURES = 3;
const QUIET_COOLDOWN_MS = 800;
const SUPPRESSED_COOLDOWN_MS = 1500;
const NO_MEAL_WINDOW_COOLDOWN_MS = 8000;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
const RESULT_SUPPRESS_MS = 10_000;
const UNMATCHED_SAME_FACE_SIM = 0.6;
const UNMATCHED_CONFIRM_WINDOW_MS = 3000;
const UNMATCHED_PENDING_COOLDOWN_MS = 300;
const CANCEL_SUPPRESS_MS = 15_000;
const BUSY_POLL_MS = 100;
const PERF_UPDATE_MS = 500;

const snapshotRepo = { getSnapshotState: getLocalSnapshotState, getDeviceId };
const localRepo = { getUser, getCheckIn, isEligible, addCheckIn, ...snapshotRepo };
const localQrRepo = { getSetting, getUser, isEligible, getCheckIn, addCheckIn, ...snapshotRepo };

function formatSyncTime(iso: string | null): string {
  if (!iso) return "없음";
  return new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function FaceCheckPage() {
  const [mode, setMode] = useState<"face" | "qr">("face");
  const [isFrontFacing, setIsFrontFacing] = useState(true);
  const [result, setResult] = useState<FaceCheckResult | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [countdown, setCountdown] = useState(CONFIRMATION_TIMEOUT_S);
  const [status, setStatus] = useState("카메라 준비 중...");
  const [phase, setPhase] = useState<ScanPhase>("loading");
  const [settings, setSettings] = useState<KioskSettings | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [staleRoster, setStaleRoster] = useState(false);
  const [perf, setPerf] = useState<{ backend: string | null; detectMs: number | null }>({ backend: null, detectMs: null });
  // 직전 판정의 1·2위 유사도 — 현장에서 임계값을 조정할 때 참고한다
  const [lastScore, setLastScore] = useState<MatchScore | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const kioskKeyRef = useRef<string | null>(null);
  const kioskBlockedRef = useRef(false); // 키오스크 키 거부됨 — 카메라는 유지, POST만 중단
  const suppressRef = useRef<Map<number, number>>(new Map()); // userId → 억제 만료 시각(ms)
  const unmatchedRef = useRef<UnmatchedTracker | null>(null);
  const lastStatusRef = useRef("카메라 준비 중...");
  const settingsRef = useRef<KioskSettings | null>(null);
  const candidatesRef = useRef<FaceCandidate[]>([]);
  // 결과 카드가 떠 있는 동안에도 스캔이 계속되므로, 뒤늦게 도는 타이머가 새 결과를 지우지 않게 세대로 구분한다.
  const resultGenRef = useRef(0);
  // 모드가 바뀌거나 언마운트되면 세대를 올려, 그 이전 세대에서 시작된 fetch가
  // 뒤늦게 응답으로 돌아와도 화면(setPending/setResult 등)을 침범하지 못하게 한다.
  const modeGenRef = useRef(0);
  const modeRef = useRef(mode);
  const stabilityRef = useRef(new FaceStabilityTracker());
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestsRef = useRef(new Set<AbortController>());
  const isLocal = settings?.operationMode === "local";

  const resetScanSession = useCallback(() => {
    modeGenRef.current += 1;
    busyRef.current = false;
    pendingRef.current = null;
    stabilityRef.current.reset();
    unmatchedRef.current = null;
    resultGenRef.current += 1;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resumeTimerRef.current = null;
    resultTimerRef.current = null;
    requestsRef.current.forEach((controller) => controller.abort());
    requestsRef.current.clear();
  }, []);

  useEffect(() => resetScanSession, [mode, resetScanSession]);

  // 키오스크 키·백엔드 고정: URL 쿼리로 최초 접속 시 localStorage에 저장하고 주소창에서 지운다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    if (key) localStorage.setItem(KIOSK_KEY_STORAGE, key);
    const backend = params.get("backend");
    if (backend === "webgl" || backend === "webgpu") localStorage.setItem(BACKEND_STORAGE, backend);
    else if (backend === "auto") localStorage.removeItem(BACKEND_STORAGE);
    if (key || backend) history.replaceState(null, "", "/facecheck");
    kioskKeyRef.current = localStorage.getItem(KIOSK_KEY_STORAGE);
  }, []);

  const updateStatus = useCallback((text: string) => {
    if (lastStatusRef.current === text) return;
    lastStatusRef.current = text;
    setStatus(text);
  }, []);

  const pauseScan = useCallback((next: "processing" | "waiting") => {
    busyRef.current = true;
    setPhase(next);
  }, []);

  const resumeScan = useCallback(() => {
    busyRef.current = false;
    setPhase(kioskBlockedRef.current && modeRef.current === "face" ? "blocked" : "scanning");
  }, []);

  const scheduleResume = useCallback((delay: number) => {
    const gen = modeGenRef.current;
    busyRef.current = true;
    setPhase("waiting");
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      if (modeGenRef.current !== gen) return;
      resumeTimerRef.current = null;
      resumeScan();
    }, delay);
  }, [resumeScan]);

  const changeMode = useCallback((next: "face" | "qr") => {
    resetScanSession();
    modeRef.current = next;
    setPending(null);
    setResult(null);
    setLastScore(null);
    setPhase(next === "face" ? "loading" : "scanning");
    updateStatus(next === "face" ? "카메라 준비 중..." : "카메라에 QR 코드를 보여주세요");
    setMode(next);
  }, [resetScanSession, updateStatus]);

  const runRequest = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    requestsRef.current.add(controller);
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
      requestsRef.current.delete(controller);
    }
  }, []);

  const postFaceCheck = useCallback((body: object) => runRequest(async (signal) => {
    const res = await fetch("/api/facecheck", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kiosk-key": kioskKeyRef.current ?? "" },
      body: JSON.stringify(body),
      signal,
    });
    return await res.json() as FaceCheckResult;
  }), [runRequest]);

  const refreshUnsyncedCount = useCallback(async (gen: number) => {
    const count = await getUnsyncedCount();
    if (modeGenRef.current === gen) setUnsyncedCount(count);
  }, []);

  // --- 운영 모드·로컬 동기화 ---
  const applySettings = useCallback((s: KioskSettings) => {
    settingsRef.current = s;
    setSettings(s);
  }, []);

  const loadCandidates = useCallback(async () => {
    candidatesRef.current = toFaceCandidates(await getAllFaceProfiles());
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const outcome = await performKioskSync();
      setSyncMessage(outcome.message);
      if (outcome.ok) {
        setStaleRoster(false);
        applySettings(await loadSavedKioskSettings());
        await loadCandidates();
        setLastSyncAt((await getSetting("lastSyncAt")) ?? null);
      }
    } catch (err) {
      console.error("kiosk sync error:", err);
      setSyncMessage("동기화 오류가 발생했습니다.");
    } finally {
      setUnsyncedCount(await getUnsyncedCount());
      setSyncing(false);
    }
  }, [applySettings, loadCandidates, syncing]);

  const runSyncRef = useRef(runSync);
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useEffect(() => {
    let cancelled = false;
    setIsOnline(navigator.onLine);
    (async () => {
      const fetched = await fetchKioskSettings();
      const s = fetched ?? (await loadSavedKioskSettings());
      if (cancelled) return;
      applySettings(s);
      await loadCandidates();
      setUnsyncedCount(await getUnsyncedCount());
      setLastSyncAt((await getSetting("lastSyncAt")) ?? null);
      if (s.operationMode === "local" && navigator.onLine) runSyncRef.current();
    })();
    const handleOnline = () => {
      setIsOnline(true);
      if (settingsRef.current?.operationMode === "local") runSyncRef.current();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [applySettings, loadCandidates]);

  // 키오스크 키 거부(401/503)·레이트리밋(429) 공용 처리. true를 반환하면 호출자는 더 진행하지 않는다.
  const handleGateErrors = useCallback((json: FaceCheckResult): boolean => {
    if (json.errorCode === "KIOSK_UNAUTHORIZED" || json.errorCode === "KIOSK_KEY_UNSET") {
      kioskBlockedRef.current = true;
      updateStatus("키오스크 키가 필요합니다 — /facecheck?key=<키> 로 접속하세요");
      busyRef.current = false;
      setPhase("blocked");
      return true;
    }
    if (json.errorCode === "RATE_LIMITED") {
      updateStatus(json.error || "요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
      setPhase("waiting");
      scheduleResume(RATE_LIMIT_COOLDOWN_MS);
      return true;
    }
    return false;
  }, [scheduleResume, updateStatus]);

  // --- 결과 처리 (학생 성공/중복/미자격/미매칭 공용) ---
  const applyResult = useCallback((json: FaceCheckResult, embedding?: ArrayLike<number>) => {
    if (json.needConfirmation || json.needType) return;
    if (!json.matched && !json.success) {
      if (json.errorCode === "UNMATCHED" && embedding) {
        const tracker = (unmatchedRef.current ??= new UnmatchedTracker({
          sameFaceSimilarity: UNMATCHED_SAME_FACE_SIM,
          confirmWindowMs: UNMATCHED_CONFIRM_WINDOW_MS,
          suppressMs: RESULT_SUPPRESS_MS,
        }));
        const verdict = tracker.observe(embedding, Date.now());
        if (verdict === "pending") {
          updateStatus("확인 중...");
          setPhase("waiting");
          scheduleResume(UNMATCHED_PENDING_COOLDOWN_MS);
          return;
        }
        if (verdict === "suppressed") {
          updateStatus("미등록 사용자 — 다음 분 서 주세요");
          setPhase("waiting");
          scheduleResume(SUPPRESSED_COOLDOWN_MS);
          return;
        }
        // confirm: 아래 공용 경로에서 주황 카드 + 오류음
      } else {
        // 식사 시간 아님·명단 없음 등은 전체 화면 결과 대신 상태 문구만
        const cooldown = json.errorCode === "NO_MEAL_WINDOW" ? NO_MEAL_WINDOW_COOLDOWN_MS : QUIET_COOLDOWN_MS;
        updateStatus(json.error || "인식되지 않았습니다. 다시 서 주세요.");
        setPhase("waiting");
        scheduleResume(cooldown);
        return;
      }
    }
    const gen = ++resultGenRef.current;
    setResult(json);
    if (json.stale) setStaleRoster(true);
    // 같은 사람이 프레임에 남아 결과/경고음이 반복되는 것을 막는다.
    if (json.user?.id) suppressRef.current.set(json.user.id, Date.now() + RESULT_SUPPRESS_MS);
    const category = resultCategory(json);
    if (category === "success") playSuccess();
    else if (category === "duplicate") playDuplicate();
    else if (category === "notApplicant") playDenied();
    else playError();
    // 결과 카드는 남겨 두고 스캔은 즉시 재개 — 다음 사람을 바로 인식한다.
    resumeScan();
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      if (resultGenRef.current === gen) setResult(null);
    }, RESULT_DISPLAY_MS);
  }, [resumeScan, scheduleResume, updateStatus]);

  const handleMatchedResponse = useCallback(
    (json: FaceCheckResult, embedding: number[], gen: number) => {
      setLastScore(json.similarity === undefined ? null : { similarity: json.similarity, runnerUp: json.runnerUp });
      if (!json.needConfirmation || !json.user || !json.mealKind || !json.date) {
        stabilityRef.current.reset();
        applyResult(json, embedding);
        return;
      }
      const uid = json.user.id;
      const suppressedUntil = suppressRef.current.get(uid);
      if (suppressedUntil !== undefined && suppressedUntil > Date.now()) {
        stabilityRef.current.reset();
        updateStatus("처리 또는 취소된 분입니다 — 잠시 후 다시 서 주세요");
        scheduleResume(SUPPRESSED_COOLDOWN_MS);
        return;
      }
      suppressRef.current.delete(uid);
      const observation = stabilityRef.current.observe(uid, Date.now(), `${json.date}:${json.mealKind}`);
      if (!observation.ready) {
        updateStatus(`얼굴 확인 중 (${observation.count}/3) — 정면을 바라봐 주세요`);
        scheduleResume(STABILITY_COOLDOWN_MS);
        return;
      }
      stabilityRef.current.reset();
      const confirmation: PendingConfirmation = {
        user: json.user,
        mealKind: json.mealKind,
        date: json.date,
        embedding,
        gen,
        expiresAt: Date.now() + CONFIRMATION_TIMEOUT_S * 1000,
        local: settingsRef.current?.operationMode === "local",
      };
      pendingRef.current = confirmation;
      setResult(null);
      setPending(confirmation);
      setCountdown(CONFIRMATION_TIMEOUT_S);
      pauseScan("waiting");
      updateStatus("학번과 이름을 확인해 주세요");
    },
    [applyResult, pauseScan, scheduleResume, updateStatus],
  );

  // --- 1단계 호출 ---
  const submitEmbedding = useCallback(
    async (embedding: number[]) => {
      const gen = modeGenRef.current;
      const s = settingsRef.current;
      if (s?.operationMode === "local") {
        if (candidatesRef.current.length === 0) {
          updateStatus("얼굴 명단이 없습니다 — [동기화]를 눌러 주세요");
          setPhase("waiting");
          scheduleResume(NO_MEAL_WINDOW_COOLDOWN_MS);
          return;
        }
        try {
          const json = await runLocalFaceCheckIn(
            { embedding, candidates: candidatesRef.current, faceMatch: s.faceMatch, now: new Date(), mealWindows: s.mealWindows },
            localRepo,
          );
          if (modeGenRef.current !== gen) return;
          handleMatchedResponse(json, embedding, gen);
          if (json.success) await refreshUnsyncedCount(gen);
        } catch (err) {
          if (modeGenRef.current !== gen) return;
          stabilityRef.current.reset();
          console.error("local facecheck error:", err);
          updateStatus("로컬 저장 오류 — 다시 시도해 주세요");
          setPhase("waiting");
          scheduleResume(1500);
        }
        return;
      }
      try {
        const json = await postFaceCheck({ embedding });
        if (modeGenRef.current !== gen) return;
        if (handleGateErrors(json)) return;
        handleMatchedResponse(json, embedding, gen);
      } catch {
        if (modeGenRef.current !== gen) return;
        stabilityRef.current.reset();
        updateStatus("서버 연결 오류 — 잠시 후 다시 시도됩니다");
        setPhase("waiting");
        scheduleResume(1500);
      }
    },
    [handleGateErrors, handleMatchedResponse, postFaceCheck, refreshUnsyncedCount, scheduleResume, updateStatus],
  );

  const cancelConfirmation = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    if (current.gen !== modeGenRef.current) return;
    suppressRef.current.set(current.user.id, Date.now() + CANCEL_SUPPRESS_MS);
    stabilityRef.current.reset();
    updateStatus("취소했습니다 — 식사 기록은 저장하지 않았습니다");
    resumeScan();
  }, [resumeScan, updateStatus]);

  const submitConfirmation = useCallback(async (type?: "WORK" | "PERSONAL") => {
    const current = pendingRef.current;
    if (!current) return;
    if (current.expiresAt <= Date.now()) {
      cancelConfirmation();
      return;
    }
    pendingRef.current = null;
    setPending(null);
    if (modeGenRef.current !== current.gen || modeRef.current !== "face") return;
    if (current.local !== (settingsRef.current?.operationMode === "local")) {
      updateStatus("운영 모드가 변경되었습니다 — 다시 인식해 주세요");
      resumeScan();
      return;
    }
    pauseScan("processing");
    updateStatus("확인 중...");
    const confirmation = { userId: current.user.id, mealKind: current.mealKind, date: current.date };
    try {
      const settings = settingsRef.current;
      const json = current.local && settings
        ? await runLocalFaceCheckIn({
            embedding: current.embedding, candidates: candidatesRef.current,
            faceMatch: settings.faceMatch, now: new Date(), mealWindows: settings.mealWindows,
            type, confirmation,
          }, localRepo)
        : await postFaceCheck({ embedding: current.embedding, type, confirmation });
      if (modeGenRef.current !== current.gen) return;
      if (!current.local && handleGateErrors(json)) return;
      if (json.needConfirmation || json.errorCode === "CONFIRMATION_CHANGED") {
        stabilityRef.current.reset();
        updateStatus("인식 정보가 변경되었습니다 — 다시 인식해 주세요");
        scheduleResume(QUIET_COOLDOWN_MS);
        return;
      }
      applyResult(json, current.embedding);
      if (current.local && json.success) await refreshUnsyncedCount(current.gen);
    } catch (err) {
      if (modeGenRef.current !== current.gen) return;
      console.error("face confirmation error:", err);
      updateStatus(current.local ? "로컬 저장 오류 — 다시 시도해 주세요" : "서버 연결 오류 — 다시 인식해 주세요");
      scheduleResume(1500);
    }
  }, [applyResult, cancelConfirmation, handleGateErrors, pauseScan, postFaceCheck, refreshUnsyncedCount, resumeScan, scheduleResume, updateStatus]);

  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      if (pendingRef.current !== pending) return;
      const remaining = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) cancelConfirmation();
    };
    const timer = setInterval(tick, 200);
    tick();
    return () => clearInterval(timer);
  }, [pending, cancelConfirmation]);

  // --- 얼굴 감지 루프 ---
  useEffect(() => {
    if (mode !== "face") return;
    let cancelled = false;
    const controller = new AbortController();

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    // 안면인식을 더 쓸 수 없을 때는 온라인·로컬 모두 이 페이지의 QR 모드로 전환한다.
    const giveUpFace = (reason: string) => {
      stopCamera();
      changeMode("qr");
      updateStatus(`${reason} — QR 모드로 전환합니다`);
    };

    (async () => {
      // 카메라를 먼저 확보하고(권한 프롬프트가 먼저 뜨도록), 모델 로딩은 그다음에
      // 한다 — 두 작업을 Promise.all로 동시에 시작하면 모델 로딩이 느릴 때
      // 카메라 권한 프롬프트도 함께 지연되어 화면이 오래 멈춘 것처럼 보인다.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      } catch (err) {
        if (cancelled) return;
        console.error("Camera access error:", err);
        updateStatus(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "카메라 권한을 허용해 주세요"
            : "카메라를 사용할 수 없습니다",
        );
        setPhase("blocked");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      setIsFrontFacing(stream.getVideoTracks()[0]?.getSettings().facingMode !== "environment");
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {}
      }
      if (cancelled) return;

      updateStatus("인식 모델 로딩 중...");
      const candidates = resolveFaceBackends(localStorage.getItem(BACKEND_STORAGE), "gpu" in navigator);
      let human: Human;
      try {
        human = await loadHuman(candidates);
      } catch (err) {
        console.error("Human load error:", err);
        if (cancelled) return;
        giveUpFace("안면인식을 사용할 수 없습니다");
        return;
      }
      if (cancelled) return;
      setPerf({ backend: getActiveFaceBackend(), detectMs: null });

      updateStatus(kioskBlockedRef.current ? "키오스크 키를 확인해 주세요" : "얼굴을 화면에 보여주세요");
      setPhase(kioskBlockedRef.current ? "blocked" : "scanning");

      let failures = 0;
      let downgraded = false;
      let lastDetectMs = 0;
      let lastPerfAt = 0;
      while (!cancelled) {
        const idle = busyRef.current || kioskBlockedRef.current;
        await new Promise((r) => setTimeout(r, idle ? BUSY_POLL_MS : nextDetectDelay(lastDetectMs)));
        if (cancelled) break;
        if (busyRef.current || kioskBlockedRef.current) continue;
        const currentVideo = videoRef.current;
        if (!currentVideo) continue;
        try {
          const t0 = performance.now();
          const outcome = await detectFaces(human, currentVideo, controller.signal);
          lastDetectMs = performance.now() - t0;
          if (cancelled) break;
          failures = 0;
          if (t0 - lastPerfAt > PERF_UPDATE_MS) {
            lastPerfAt = t0;
            setPerf({ backend: getActiveFaceBackend(), detectMs: Math.round(lastDetectMs) });
          }
          if (outcome.kind === "none") {
            stabilityRef.current.reset();
            updateStatus("얼굴을 화면에 보여주세요");
            continue;
          }
          if (outcome.kind === "multiple") {
            stabilityRef.current.reset();
            updateStatus("한 분씩 서 주세요");
            continue;
          }
          const issue = qualityIssue(outcome.face);
          if (issue === "spoof") {
            stabilityRef.current.reset();
            updateStatus("실제 얼굴로 인식해 주세요");
            continue;
          }
          if (issue === "lowScore") {
            stabilityRef.current.reset();
            updateStatus("정면을 바라봐 주세요");
            continue;
          }
          const geometry = outcome.face.geometry;
          const geometryIssue = geometry ? enrollmentQualityIssue(geometry) : "turned";
          if (geometryIssue) {
            stabilityRef.current.reset();
            updateStatus(geometryIssue === "tooSmall"
              ? "카메라에 조금 더 가까이 서 주세요"
              : geometryIssue === "clipped" ? "얼굴 전체가 화면 안에 들어오도록 서 주세요" : "정면을 바라봐 주세요");
            continue;
          }
          pauseScan("processing");
          updateStatus("인식 중...");
          await submitEmbedding(outcome.face.embedding);
          if (cancelled) break;
        } catch (err) {
          if (cancelled) break;
          stabilityRef.current.reset();
          failures += 1;
          if (failures === 1) console.error("face loop error:", err);
          if (failures < MAX_LOOP_FAILURES) continue;
          // WebGPU에서 반복 실패하면 QR로 가기 전에 WebGL로 한 번 더 시도한다.
          if (getActiveFaceBackend() === "webgpu" && !downgraded) {
            downgraded = true;
            failures = 0;
            updateStatus("WebGPU 오류 — WebGL로 전환합니다");
            try {
              human = await loadHuman(["webgl"]);
              if (cancelled) break;
              setPerf({ backend: getActiveFaceBackend(), detectMs: null });
              continue;
            } catch (reloadErr) {
              console.error("webgl fallback failed:", reloadErr);
            }
          }
          if (cancelled) break;
          giveUpFace("안면인식 오류가 반복됩니다");
          break;
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      stopCamera();
    };
  }, [mode, changeMode, pauseScan, submitEmbedding, updateStatus]);

  // --- QR 모드: 인쇄 카드 QR·로컬 모드는 기기 IndexedDB(/check와 같은 판정), 그 외는 서버 JWT 검증 ---
  const handleQrScan = useCallback(
    async (data: string) => {
      if (modeRef.current !== "qr" || busyRef.current) return;
      pauseScan("processing");
      const gen = modeGenRef.current;
      const s = settingsRef.current;
      const useLocal = isLocalQR(data) || s?.operationMode === "local";
      try {
        const json = useLocal
          ? await runLocalQrCheckIn({ data, now: new Date(), mealWindows: s?.mealWindows ?? DEFAULT_MEAL_WINDOWS }, localQrRepo)
          : await runRequest((signal) => postCheckInWithRetry(data, {
              fetchFn: (url, init) => fetch(url, { ...init, signal }),
            }));
        if (modeGenRef.current !== gen) return;
        applyResult({ ...json, matched: true });
        if (useLocal && json.success) await refreshUnsyncedCount(gen);
      } catch (err) {
        console.error("qr checkin error:", err);
        if (modeGenRef.current !== gen) return;
        applyResult({
          success: false,
          matched: true,
          error: useLocal ? "저장 오류가 발생했습니다. 다시 스캔해 주세요." : "서버 연결 오류",
        });
      }
    },
    [applyResult, pauseScan, refreshUnsyncedCount, runRequest],
  );

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

  const switchMode = () => changeMode(mode === "face" ? "qr" : "face");

  const borderClass = result ? RESULT_BORDER_CLASS[resultCategory(result)] : "border-slate-700";
  const pendingIdentity = pending
    ? pending.user.role === "TEACHER" ? `${pending.user.name} 선생님`
      : `${pending.user.grade != null && pending.user.classNum != null && pending.user.number != null
        ? `${studentNumberOf(pending.user.grade, pending.user.classNum, pending.user.number)} ` : ""}${pending.user.name}`
    : "";

  return (
    <KioskViewport>
      {/* Status Bar */}
      <div className="flex shrink-0 items-center gap-2 px-2 text-xs sm:px-3">
        <BrandMark variant="overlay" href="/" label="홈으로" className="static min-h-11 shrink-0 whitespace-nowrap" />

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <span className="hidden font-medium whitespace-nowrap sm:inline">안면인식 체크인</span>
          {isOnline ? (
            <span className="flex items-center gap-1 text-emerald-400 whitespace-nowrap">
              <Wifi className="h-3 w-3" /> 온라인
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 whitespace-nowrap">
              <WifiOff className="h-3 w-3" /> 오프라인
            </span>
          )}
          {isLocal && <span className="text-amber-400 whitespace-nowrap">로컬 모드</span>}
          {(isLocal || unsyncedCount > 0) && (
            <span className="text-white/70 whitespace-nowrap">미전송 {unsyncedCount}건</span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-white/70 whitespace-nowrap shrink-0">
          {mode === "face" ? (
            <>
              <PhaseIndicator phase={phase} />
              얼굴 인식 · {PHASE_LABEL[phase]}
              {perf.backend && (
                <span className="hidden sm:inline text-white/50">
                  · {perf.backend}
                  {perf.detectMs !== null ? ` ${perf.detectMs}ms` : ""}
                </span>
              )}
              {lastScore?.similarity !== undefined && (
                <span className="hidden sm:inline text-white/50">
                  · 유사도 {lastScore.similarity.toFixed(2)}
                  {lastScore.runnerUp !== undefined ? `/${lastScore.runnerUp.toFixed(2)}` : ""}
                </span>
              )}
            </>
          ) : (
            "QR 모드"
          )}
        </span>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 px-2 sm:px-3">
        <section
          aria-label="카메라 화면"
          className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl border-[10px] bg-black transition-colors duration-300 sm:border-[14px] ${borderClass}`}
        >
          {mode === "face" ? (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="얼굴 인식 카메라"
              className={`h-full w-full object-contain object-center ${isFrontFacing ? "-scale-x-100" : ""}`}
            />
          ) : (
            <QRScanner onScan={handleQrScan} />
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
                    ? `${result.user.grade}학년 ${result.user.classNum}반 ${result.user.number}번 ${result.user.name}`
                    : `${result.user.name} 선생님`}
                </span>
              )}
              {result.user && <span aria-hidden="true" className="text-slate-400">·</span>}
              <span className={`text-sm font-semibold sm:text-base ${RESULT_TEXT_CLASS[resultCategory(result)]}`}>
                {result.success
                  ? result.user?.role === "TEACHER" && result.checkedAt
                    ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 ${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 되었습니다.`
                    : `${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 하였습니다.`
                  : result.error || (result.duplicate ? "이미 체크인 되었습니다." : result.notApplicant ? "신청자가 아닙니다." : "인식되지 않았습니다.")}
              </span>
                {result.errorCode === "UNMATCHED" && (
                  <span className="text-sm text-slate-600 dark:text-slate-300">등록했다면 정면을 봐 주세요</span>
                )}

            </div>
          ) : (
            <div className="mx-auto flex w-max shrink-0 items-center gap-2 whitespace-nowrap">
              {mode === "face" ? <PhaseIndicator phase={phase} /> : <QrCode className="h-5 w-5 shrink-0" />}
              <span className="text-sm font-medium sm:text-base">{status}</span>
            </div>
          )}
        </div>
      </main>

      {pending && (
        <Dialog open onOpenChange={(open) => { if (!open) cancelConfirmation(); }}>
          <DialogContent
            showCloseButton={false}
            initialFocus={cancelButtonRef}
            finalFocus={modeButtonRef}
            className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-auto rounded-2xl bg-white p-4 text-slate-900 shadow-xl sm:max-w-md sm:p-6 text-center"
          >
            {pending.user.photoUrl ? (
              <img
                src={pending.user.photoUrl}
                alt={pending.user.name}
                className="w-20 h-20 rounded-2xl object-cover mx-auto"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center text-2xl font-bold text-primary mx-auto">
                {pending.user.name.charAt(0)}
              </div>
            )}
            <div>
              <DialogTitle className="overflow-x-auto text-fit-lg font-bold whitespace-nowrap">{pendingIdentity}</DialogTitle>
              <p className="mt-1 text-sm whitespace-nowrap">위 사용자로 인식했습니다.</p>
              <DialogDescription className="overflow-x-auto text-fit-sm text-muted-foreground mt-1 whitespace-nowrap">
                이 이름으로 {MEAL_LABEL[pending.mealKind]} 체크인하시겠습니까?
              </DialogDescription>
              <p className="mt-2 text-sm text-slate-500 whitespace-nowrap">선택하지 않으면 {countdown}초 후 취소됩니다.</p>
            </div>
            <div className="flex gap-2">
              {pending.user.role === "TEACHER" ? (
                <>
                  <button
                    onClick={() => submitConfirmation("WORK")}
                    className="flex-1 min-h-14 rounded-xl bg-blue-600 text-white text-lg font-bold whitespace-nowrap"
                  >근무</button>
                  <button
                    onClick={() => submitConfirmation("PERSONAL")}
                    className="flex-1 min-h-14 rounded-xl bg-emerald-600 text-white text-lg font-bold whitespace-nowrap"
                  >개인</button>
                </>
              ) : (
                <button
                  onClick={() => submitConfirmation()}
                  className="flex-1 min-h-14 rounded-xl bg-emerald-600 text-white text-lg font-bold whitespace-nowrap"
                >확인</button>
              )}
              <button
                ref={cancelButtonRef}
                onClick={cancelConfirmation}
                className="flex-1 min-h-14 rounded-xl bg-gray-500 text-white text-lg font-bold whitespace-nowrap"
              >
                취소
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <footer className="kiosk-footer shrink-0 px-2 sm:px-3">
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {isLocal && (
            <button
              onClick={runSync}
              disabled={syncing || !isOnline}
              className="kiosk-action mr-auto flex items-center gap-1 whitespace-nowrap rounded-full bg-blue-500/90 px-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "동기화"}
            </button>
          )}
          <button
            ref={modeButtonRef}
            onClick={switchMode}
            className="kiosk-action flex items-center gap-2 whitespace-nowrap rounded-full bg-white/90 px-3 text-sm font-semibold text-gray-900"
          >
            {mode === "face" ? (
              <>
                <QrCode className="h-4 w-4" /> QR로 체크인
              </>
            ) : (
              <>
                <ScanFace className="h-4 w-4" /> 얼굴로 체크인
              </>
            )}
          </button>
        </div>
        {isLocal && (
          <div className="kiosk-sync-details flex min-w-0 items-center gap-2 overflow-x-auto text-xs leading-5">
            <span className="whitespace-nowrap text-white/80">마지막 동기화: {formatSyncTime(lastSyncAt)}</span>
            {staleRoster && (
              <span className="rounded bg-amber-500 px-2 font-semibold whitespace-nowrap text-slate-900">재동기화 필요</span>
            )}
            {syncMessage && <span className="whitespace-nowrap text-amber-300" title={syncMessage}>{syncMessage}</span>}
          </div>
        )}
      </footer>
    </KioskViewport>
  );
}
