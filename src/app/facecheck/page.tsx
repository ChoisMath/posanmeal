"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Human } from "@vladmandic/human";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-kind-local";
import { postCheckInWithRetry } from "@/lib/checkin-client";
import { playDenied, playDuplicate, playError, playSuccess } from "@/lib/checkin-sounds";
import { RESULT_BG_CLASS, RESULT_TEXT_CLASS, resultCategory } from "@/lib/checkin-result-style";
import { detectFaces, getActiveFaceBackend, loadHuman, qualityIssue } from "@/lib/human-client";
import { nextDetectDelay, resolveFaceBackends } from "@/lib/face-pacing";
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
  getSetting,
  getUnsyncedCount,
  getUser,
  isEligible,
} from "@/lib/local-db";
import type { FaceCandidate } from "@/lib/face-match";
import { LoaderCircle, QrCode, RefreshCw, ScanFace, Wifi, WifiOff } from "lucide-react";

interface PendingTeacher {
  user: FaceCheckUser;
  mealKind: MealKind;
  embedding: number[];
  gen: number;
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

const PHASE_HEADLINE: Record<ScanPhase, string> = {
  loading: "준비 중...",
  scanning: "얼굴을 카메라에 보여주세요",
  processing: "인식 중...",
  waiting: "잠시 후 다시 인식합니다",
  blocked: "인식이 중단되었습니다",
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
const TEACHER_TIMEOUT_S = 10;
const KIOSK_KEY_STORAGE = "facecheck.kioskKey";
const BACKEND_STORAGE = "facecheck.backend";
const MAX_LOOP_FAILURES = 3;
const QUIET_COOLDOWN_MS = 800;
const SUPPRESSED_COOLDOWN_MS = 1500;
const NO_MEAL_WINDOW_COOLDOWN_MS = 8000;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
const RESULT_SUPPRESS_MS = 10_000;
const TEACHER_CANCEL_SUPPRESS_MS = 15_000;
const BUSY_POLL_MS = 100;
const PERF_UPDATE_MS = 500;

const localRepo = { getUser, getCheckIn, isEligible, addCheckIn };

function formatSyncTime(iso: string | null): string {
  if (!iso) return "없음";
  return new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function FaceCheckPage() {
  const [mode, setMode] = useState<"face" | "qr">("face");
  const [result, setResult] = useState<FaceCheckResult | null>(null);
  const [pending, setPending] = useState<PendingTeacher | null>(null);
  const [countdown, setCountdown] = useState(TEACHER_TIMEOUT_S);
  const [status, setStatus] = useState("카메라 준비 중...");
  const [phase, setPhase] = useState<ScanPhase>("loading");
  const [settings, setSettings] = useState<KioskSettings | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [perf, setPerf] = useState<{ backend: string | null; detectMs: number | null }>({ backend: null, detectMs: null });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false); // API 호출·선택 대기 중 스캔 정지 — pauseScan/resumeScan으로만 변경
  const pendingRef = useRef<PendingTeacher | null>(null);
  const kioskKeyRef = useRef<string | null>(null);
  const kioskBlockedRef = useRef(false); // 키오스크 키 거부됨 — 카메라는 유지, POST만 중단
  const suppressRef = useRef<Map<number, number>>(new Map()); // userId → 억제 만료 시각(ms)
  const lastStatusRef = useRef("카메라 준비 중...");
  const settingsRef = useRef<KioskSettings | null>(null);
  const candidatesRef = useRef<FaceCandidate[]>([]);
  // 결과 카드가 떠 있는 동안에도 스캔이 계속되므로, 뒤늦게 도는 타이머가 새 결과를 지우지 않게 세대로 구분한다.
  const resultGenRef = useRef(0);
  // 모드가 바뀌거나 언마운트되면 세대를 올려, 그 이전 세대에서 시작된 fetch가
  // 뒤늦게 응답으로 돌아와도 화면(setPending/setResult 등)을 침범하지 못하게 한다.
  const modeGenRef = useRef(0);
  const isLocal = settings?.operationMode === "local";

  useEffect(() => {
    return () => {
      modeGenRef.current += 1;
    };
  }, [mode]);

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
    setPhase("scanning");
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
      setTimeout(resumeScan, RATE_LIMIT_COOLDOWN_MS);
      return true;
    }
    return false;
  }, [resumeScan, updateStatus]);

  // --- 결과 처리 (학생 성공/중복/미자격/미매칭 공용) ---
  const applyResult = useCallback((json: FaceCheckResult) => {
    if (json.needType && json.user && json.mealKind) return; // 교사 분기에서 별도 처리
    if (!json.matched && !json.success) {
      // 미매칭: 전체 화면 결과 대신 상태 문구만 (지나가는 사람마다 경고음 방지)
      const cooldown = json.errorCode === "NO_MEAL_WINDOW" ? NO_MEAL_WINDOW_COOLDOWN_MS : QUIET_COOLDOWN_MS;
      updateStatus(json.error || "인식되지 않았습니다. 다시 서 주세요.");
      setPhase("waiting");
      setTimeout(resumeScan, cooldown);
      return;
    }
    const gen = ++resultGenRef.current;
    setResult(json);
    // 같은 사람이 프레임에 남아 결과/경고음이 반복되는 것을 막는다.
    if (json.user?.id) suppressRef.current.set(json.user.id, Date.now() + RESULT_SUPPRESS_MS);
    const category = resultCategory(json);
    if (category === "success") playSuccess();
    else if (category === "duplicate") playDuplicate();
    else if (category === "notApplicant") playDenied();
    else playError();
    // 결과 카드는 남겨 두고 스캔은 즉시 재개 — 다음 사람을 바로 인식한다.
    resumeScan();
    setTimeout(() => {
      if (resultGenRef.current === gen) setResult(null);
    }, RESULT_DISPLAY_MS);
  }, [resumeScan, updateStatus]);

  // 매칭 응답 공용 처리(온라인·로컬): 억제 확인 → 교사 선택 대기 → 결과 표시
  const handleMatchedResponse = useCallback(
    (json: FaceCheckResult, embedding: number[], gen: number) => {
      const uid = json.user?.id;
      if (uid !== undefined) {
        const suppressedUntil = suppressRef.current.get(uid);
        if (suppressedUntil !== undefined) {
          if (suppressedUntil > Date.now()) {
            // 방금 처리된 사람이 프레임에 남아 있음 — 재요청을 잠시 멈추고 안내만 한다.
            updateStatus("처리된 분입니다 — 다음 분 서 주세요");
            setPhase("waiting");
            setTimeout(resumeScan, SUPPRESSED_COOLDOWN_MS);
            return;
          }
          suppressRef.current.delete(uid);
        }
      }
      if (json.needType && json.user && json.mealKind) {
        const p = { user: json.user, mealKind: json.mealKind, embedding, gen };
        pendingRef.current = p;
        setPending(p);
        setCountdown(TEACHER_TIMEOUT_S);
        setPhase("waiting");
        updateStatus("근무/개인 선택 대기 중");
        return; // busyRef 유지 — 선택 대기
      }
      applyResult(json);
    },
    [applyResult, resumeScan, updateStatus],
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
          setTimeout(resumeScan, NO_MEAL_WINDOW_COOLDOWN_MS);
          return;
        }
        try {
          const json = await runLocalFaceCheckIn(
            { embedding, candidates: candidatesRef.current, faceMatch: s.faceMatch, now: new Date(), mealWindows: s.mealWindows },
            localRepo,
          );
          if (modeGenRef.current !== gen) {
            resumeScan();
            return;
          }
          handleMatchedResponse(json, embedding, gen);
          if (json.success) setUnsyncedCount(await getUnsyncedCount());
        } catch (err) {
          console.error("local facecheck error:", err);
          if (modeGenRef.current !== gen) {
            resumeScan();
            return;
          }
          updateStatus("로컬 저장 오류 — 다시 시도해 주세요");
          setPhase("waiting");
          setTimeout(resumeScan, 1500);
        }
        return;
      }
      try {
        const res = await fetch("/api/facecheck", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kiosk-key": kioskKeyRef.current ?? "" },
          body: JSON.stringify({ embedding }),
        });
        const json: FaceCheckResult = await res.json();
        if (modeGenRef.current !== gen) {
          // 응답 도착 전에 모드가 전환됨 — 화면을 건드리지 않고 조용히 버린다.
          resumeScan();
          return;
        }
        if (handleGateErrors(json)) return;
        handleMatchedResponse(json, embedding, gen);
      } catch {
        if (modeGenRef.current !== gen) {
          resumeScan();
          return;
        }
        updateStatus("서버 연결 오류 — 잠시 후 다시 시도됩니다");
        setPhase("waiting");
        setTimeout(resumeScan, 1500);
      }
    },
    [handleGateErrors, handleMatchedResponse, resumeScan, updateStatus],
  );

  // --- 2단계 호출 (교사 type 확정 / 자동 개인) ---
  const submitTeacherType = useCallback(
    async (type: "WORK" | "PERSONAL") => {
      const p = pendingRef.current;
      pendingRef.current = null;
      setPending(null);
      if (!p) return;
      setPhase("processing");
      updateStatus("확인 중...");
      const s = settingsRef.current;
      const local = s?.operationMode === "local";
      try {
        let json: FaceCheckResult;
        if (local) {
          json = await runLocalFaceCheckIn(
            { embedding: p.embedding, candidates: candidatesRef.current, faceMatch: s.faceMatch, now: new Date(), mealWindows: s.mealWindows, type },
            localRepo,
          );
        } else {
          const res = await fetch("/api/facecheck", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-kiosk-key": kioskKeyRef.current ?? "" },
            body: JSON.stringify({ embedding: p.embedding, type }),
          });
          json = await res.json();
        }
        if (modeGenRef.current !== p.gen) {
          resumeScan();
          return;
        }
        if (!local && handleGateErrors(json)) return;
        applyResult(json);
        if (local && json.success) setUnsyncedCount(await getUnsyncedCount());
      } catch (err) {
        console.error("teacher type submit error:", err);
        if (modeGenRef.current !== p.gen) {
          resumeScan();
          return;
        }
        updateStatus(local ? "로컬 저장 오류" : "서버 연결 오류");
        setPhase("waiting");
        setTimeout(resumeScan, 1500);
      }
    },
    [applyResult, handleGateErrors, resumeScan, updateStatus],
  );

  const cancelTeacher = useCallback(() => {
    if (!pendingRef.current) return;
    suppressRef.current.set(pendingRef.current.user.id, Date.now() + TEACHER_CANCEL_SUPPRESS_MS);
    pendingRef.current = null;
    setPending(null);
    resumeScan();
  }, [resumeScan]);

  // --- 교사 10초 카운트다운 → 자동 "개인" ---
  useEffect(() => {
    if (!pending) return;
    if (countdown <= 0) {
      submitTeacherType("PERSONAL");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [pending, countdown, submitTeacherType]);

  // --- 얼굴 감지 루프 ---
  useEffect(() => {
    if (mode !== "face") return;
    let cancelled = false;

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    // 안면인식을 더 쓸 수 없을 때: 온라인은 이 페이지의 QR 모드로, 로컬은 /check(로컬 QR) 안내
    const giveUpFace = (reason: string) => {
      stopCamera();
      if (settingsRef.current?.operationMode === "local") {
        updateStatus(`${reason} — QR은 /check에서 이용하세요`);
        setPhase("blocked");
      } else {
        updateStatus(`${reason} — QR 모드로 전환합니다`);
        setMode("qr");
      }
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

      updateStatus("얼굴을 화면에 보여주세요");
      setPhase("scanning");

      let failures = 0;
      let downgraded = false;
      let lastDetectMs = 0;
      let lastPerfAt = 0;
      while (!cancelled) {
        const idle = busyRef.current || kioskBlockedRef.current;
        await new Promise((r) => setTimeout(r, idle ? BUSY_POLL_MS : nextDetectDelay(lastDetectMs)));
        if (cancelled) break;
        if (idle) continue;
        const currentVideo = videoRef.current;
        if (!currentVideo) continue;
        try {
          const t0 = performance.now();
          const outcome = await detectFaces(human, currentVideo);
          lastDetectMs = performance.now() - t0;
          if (cancelled) break;
          failures = 0;
          if (t0 - lastPerfAt > PERF_UPDATE_MS) {
            lastPerfAt = t0;
            setPerf({ backend: getActiveFaceBackend(), detectMs: Math.round(lastDetectMs) });
          }
          if (outcome.kind === "none") {
            updateStatus("얼굴을 화면에 보여주세요");
            continue;
          }
          if (outcome.kind === "multiple") {
            updateStatus("한 분씩 서 주세요");
            continue;
          }
          const issue = qualityIssue(outcome.face);
          if (issue === "spoof") {
            updateStatus("실제 얼굴로 인식해 주세요");
            continue;
          }
          if (issue === "lowScore") {
            updateStatus("정면을 바라봐 주세요");
            continue;
          }
          pauseScan("processing");
          updateStatus("인식 중...");
          await submitEmbedding(outcome.face.embedding);
          if (cancelled) break;
        } catch (err) {
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
      stopCamera();
    };
  }, [mode, pauseScan, submitEmbedding, updateStatus]);

  // --- QR 폴백 (온라인 JWT QR 전용 — 인쇄 카드 QR·로컬 모드는 /check 사용) ---
  const handleQrScan = useCallback(
    async (data: string) => {
      if (busyRef.current) return;
      pauseScan("processing");
      const gen = modeGenRef.current;
      try {
        const json = await postCheckInWithRetry(data);
        if (modeGenRef.current !== gen) {
          resumeScan();
          return;
        }
        applyResult({ ...json, matched: true });
      } catch {
        if (modeGenRef.current !== gen) {
          resumeScan();
          return;
        }
        applyResult({ success: false, matched: true, error: "서버 연결 오류" });
      }
    },
    [applyResult, pauseScan, resumeScan],
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

  const switchMode = () => {
    if (mode === "face") {
      if (isLocal) {
        window.location.href = "/check";
        return;
      }
      setMode("qr");
    } else {
      setPhase("loading");
      setMode("face");
    }
  };

  const bgClass = result ? RESULT_BG_CLASS[resultCategory(result)] : "bg-background";

  return (
    <div className={`min-h-dvh transition-colors duration-300 ${bgClass}`}>
      <BrandMark variant="overlay" href="/" label="홈으로" />

      {/* Status Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 px-4 py-1.5 bg-black/60 text-white text-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="font-medium whitespace-nowrap">안면인식 체크인</span>
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
                <span className="text-white/50">
                  · {perf.backend}
                  {perf.detectMs !== null ? ` ${perf.detectMs}ms` : ""}
                </span>
              )}
            </>
          ) : (
            "QR 모드"
          )}
        </span>
      </div>

      {/* Main layout */}
      <div className="min-h-dvh flex flex-col md:flex-row pt-8 pb-20">
        {/* Camera Area */}
        <div className="bg-gray-900/95 p-4 md:p-6 md:flex-1 md:flex md:items-center md:justify-center">
          <div className="max-w-md mx-auto md:max-w-lg w-full">
            {mode === "face" ? (
              <div className="relative w-full max-w-md mx-auto">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full rounded-lg bg-black aspect-[3/4] object-cover"
                />
                <div className="absolute inset-x-2 bottom-3 flex justify-center">
                  <span className="max-w-full flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs sm:text-sm">
                    <PhaseIndicator phase={phase} />
                    <span className="truncate">{status}</span>
                  </span>
                </div>
              </div>
            ) : (
              <QRScanner onScan={handleQrScan} />
            )}
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
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white whitespace-nowrap">
                      {result.user.grade}-{result.user.classNum} {result.user.number}번{" "}
                      {result.user.name}
                    </p>
                  ) : result.user ? (
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white whitespace-nowrap">
                      {result.user.name} 선생님
                    </p>
                  ) : null}

                  {result.success && (
                    <p className={`${RESULT_TEXT_CLASS.success} text-fit-sm mt-1.5 font-medium`}>
                      {result.user?.role === "TEACHER" && result.checkedAt
                        ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 ${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 되었습니다.`
                        : `${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 하였습니다.`}
                    </p>
                  )}

                  {result.duplicate && (
                    <p className={`${RESULT_TEXT_CLASS.duplicate} text-fit-sm mt-1.5 font-semibold`}>
                      {result.error || "이미 체크인 되었습니다."}
                    </p>
                  )}

                  {result.notApplicant && (
                    <p className={`${RESULT_TEXT_CLASS.notApplicant} text-fit-sm mt-1.5 font-semibold`}>
                      {result.error || "신청자가 아닙니다."}
                    </p>
                  )}

                  {!result.success && !result.duplicate && !result.notApplicant && (
                    <p className={`${RESULT_TEXT_CLASS.error} text-fit-sm mt-1.5 font-medium`}>
                      {result.error || "인식되지 않았습니다."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!result && (
              <div className="text-center text-muted-foreground">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                  {mode !== "face" ? (
                    <QrCode className="w-8 h-8 text-primary" />
                  ) : phase === "scanning" || phase === "blocked" ? (
                    <ScanFace className="w-8 h-8 text-primary" />
                  ) : (
                    <LoaderCircle className="w-8 h-8 text-primary animate-spin" />
                  )}
                </div>
                <p className="text-lg font-semibold whitespace-nowrap">
                  {mode === "face" ? PHASE_HEADLINE[phase] : "QR 코드를 스캔해 주세요"}
                </p>
                <p className="text-sm mt-1 opacity-70 truncate">{status}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 교사 근무/개인/취소 선택 오버레이 */}
      {pending && (
        <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
          <div className="glass card-elevated rounded-2xl p-6 w-full max-w-md text-center space-y-4">
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
              <p className="text-fit-lg font-bold whitespace-nowrap">{pending.user.name} 선생님</p>
              <p className="text-fit-sm text-muted-foreground mt-1 whitespace-nowrap">
                {MEAL_LABEL[pending.mealKind]} 체크인 — 근무/개인을 선택하세요
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => submitTeacherType("WORK")}
                className="flex-1 min-h-14 rounded-xl bg-blue-600 text-white text-lg font-bold whitespace-nowrap"
              >
                근무
              </button>
              <button
                onClick={() => submitTeacherType("PERSONAL")}
                className="flex-1 min-h-14 rounded-xl bg-emerald-600 text-white text-lg font-bold whitespace-nowrap"
              >
                개인 ({countdown})
              </button>
              <button
                onClick={cancelTeacher}
                className="flex-1 min-h-14 rounded-xl bg-gray-500 text-white text-lg font-bold whitespace-nowrap"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 하단 고정 바: 로컬 동기화 + 모드 전환 */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-20 flex items-center gap-2 p-3 bg-gradient-to-t from-black/60 to-transparent ${
          isLocal ? "justify-between" : "justify-center"
        }`}
      >
        {isLocal && (
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={runSync}
              disabled={syncing || !isOnline}
              className="min-h-11 px-4 rounded-full bg-blue-500/90 text-white text-sm font-semibold shadow-lg flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "동기화 중..." : "동기화"}
            </button>
            <span className="text-white/80 text-xs whitespace-nowrap">마지막 동기화: {formatSyncTime(lastSyncAt)}</span>
            {syncMessage && <span className="text-amber-300 text-xs truncate min-w-0">{syncMessage}</span>}
          </div>
        )}
        <button
          onClick={switchMode}
          className="min-h-11 px-5 rounded-full bg-white/90 dark:bg-black/70 text-gray-900 dark:text-white font-semibold text-sm shadow-lg flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          {mode === "face" ? (
            <>
              <QrCode className="h-4 w-4" /> {isLocal ? "QR로 체크인 (/check)" : "QR로 체크인"}
            </>
          ) : (
            <>
              <ScanFace className="h-4 w-4" /> 얼굴로 체크인
            </>
          )}
        </button>
      </div>
    </div>
  );
}
