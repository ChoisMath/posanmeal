"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Human } from "@vladmandic/human";
import { QRScanner } from "@/components/QRScanner";
import { BrandMark } from "@/components/BrandMark";
import { MEAL_LABEL } from "@/lib/meal-plan";
import type { MealKind } from "@/lib/meal-kind-local";
import { postCheckInWithRetry } from "@/lib/checkin-client";
import { playChime, playDoubleBeep, playLongBeep } from "@/lib/checkin-sounds";
import { detectSingleFace, isQualityFace, loadHuman } from "@/lib/human-client";
import { QrCode, ScanFace } from "lucide-react";

interface FaceCheckUser {
  id: number;
  name: string;
  role: string;
  grade?: number | null;
  classNum?: number | null;
  number?: number | null;
  photoUrl?: string | null;
}

interface FaceCheckResult {
  success: boolean;
  matched?: boolean;
  duplicate?: boolean;
  notApplicant?: boolean;
  needType?: boolean;
  error?: string;
  user?: FaceCheckUser;
  type?: string;
  checkedAt?: string;
  mealKind?: MealKind;
}

interface PendingTeacher {
  user: FaceCheckUser;
  mealKind: MealKind;
  embedding: number[];
}

const DETECT_INTERVAL_MS = 300;
const RESULT_DISPLAY_MS = 2000;
const TEACHER_TIMEOUT_S = 10;

export default function FaceCheckPage() {
  const [mode, setMode] = useState<"face" | "qr">("face");
  const [result, setResult] = useState<FaceCheckResult | null>(null);
  const [pending, setPending] = useState<PendingTeacher | null>(null);
  const [countdown, setCountdown] = useState(TEACHER_TIMEOUT_S);
  const [status, setStatus] = useState("카메라 준비 중...");
  const [modelFailed, setModelFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false); // API 호출·결과 표시·선택 대기 중 스캔 정지
  const pendingRef = useRef<PendingTeacher | null>(null);

  // --- 결과 처리 (학생 성공/중복/미자격/미매칭 공용) ---
  const applyResult = useCallback((json: FaceCheckResult) => {
    if (json.needType && json.user && json.mealKind) return; // 교사 분기에서 별도 처리
    if (!json.matched && !json.success) {
      // 미매칭: 전체 화면 결과 대신 상태 문구만 (지나가는 사람마다 삐 소리 방지)
      setStatus(json.error || "인식되지 않았습니다. 다시 서 주세요.");
      setTimeout(() => {
        busyRef.current = false;
      }, 800);
      return;
    }
    setResult(json);
    if (json.success) playChime();
    else if (json.duplicate || json.notApplicant) playLongBeep();
    else playDoubleBeep();
    setTimeout(() => {
      setResult(null);
      busyRef.current = false;
    }, RESULT_DISPLAY_MS);
  }, []);

  // --- 1단계 호출 ---
  const submitEmbedding = useCallback(
    async (embedding: number[]) => {
      try {
        const res = await fetch("/api/facecheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embedding }),
        });
        const json: FaceCheckResult = await res.json();
        if (json.needType && json.user && json.mealKind) {
          const p = { user: json.user, mealKind: json.mealKind, embedding };
          pendingRef.current = p;
          setPending(p);
          setCountdown(TEACHER_TIMEOUT_S);
          return; // busyRef 유지 — 선택 대기
        }
        applyResult(json);
      } catch {
        setStatus("서버 연결 오류 — 잠시 후 다시 시도됩니다");
        setTimeout(() => {
          busyRef.current = false;
        }, 1500);
      }
    },
    [applyResult],
  );

  // --- 2단계 호출 (교사 type 확정 / 자동 개인) ---
  const submitTeacherType = useCallback(
    async (type: "WORK" | "PERSONAL") => {
      const p = pendingRef.current;
      pendingRef.current = null;
      setPending(null);
      if (!p) return;
      try {
        const res = await fetch("/api/facecheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embedding: p.embedding, type }),
        });
        applyResult(await res.json());
      } catch {
        setStatus("서버 연결 오류");
        setTimeout(() => {
          busyRef.current = false;
        }, 1500);
      }
    },
    [applyResult],
  );

  const cancelTeacher = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
    busyRef.current = false;
  }, []);

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
        setStatus(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "카메라 권한을 허용해 주세요"
            : "카메라를 사용할 수 없습니다",
        );
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

      setStatus("인식 모델 로딩 중...");
      let human: Human | undefined;
      try {
        human = await loadHuman();
      } catch (err) {
        console.error("Human load error:", err);
        if (cancelled) return;
        setModelFailed(true);
        setStatus("안면인식을 사용할 수 없습니다 — QR 모드를 이용하세요");
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        return;
      }
      if (cancelled || !human) return;

      setStatus("얼굴을 화면에 보여주세요");

      while (!cancelled) {
        await new Promise((r) => setTimeout(r, DETECT_INTERVAL_MS));
        if (cancelled) break;
        if (busyRef.current) continue;
        const currentVideo = videoRef.current;
        if (!currentVideo) continue;
        const face = await detectSingleFace(human, currentVideo);
        if (cancelled) break;
        if (!face || !isQualityFace(face)) continue;
        busyRef.current = true;
        setStatus("인식 중...");
        await submitEmbedding(face.embedding);
        if (cancelled) break;
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [mode, submitEmbedding]);

  // --- QR 폴백 (온라인 JWT QR 전용 — 인쇄 카드 QR은 /check 사용) ---
  const handleQrScan = useCallback(
    async (data: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const json = await postCheckInWithRetry(data);
        applyResult({ ...json, matched: true });
      } catch {
        applyResult({ success: false, matched: true, error: "서버 연결 오류" });
      }
    },
    [applyResult],
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

  const bgClass = result
    ? result.duplicate || result.notApplicant
      ? "bg-red-500"
      : result.success
        ? "bg-emerald-500"
        : "bg-amber-500"
    : "bg-background";

  return (
    <div className={`min-h-dvh transition-colors duration-300 ${bgClass}`}>
      <BrandMark variant="overlay" href="/" label="홈으로" />

      {/* Status Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-1.5 bg-black/60 text-white text-xs">
        <span className="font-medium whitespace-nowrap">안면인식 체크인</span>
        <span className="text-white/70 whitespace-nowrap">
          {mode === "face" ? "얼굴 인식 모드" : "QR 모드"}
        </span>
      </div>

      {/* Main layout */}
      <div className="min-h-dvh flex flex-col md:flex-row pt-8 pb-16">
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
                  <span className="max-w-full truncate px-3 py-1.5 rounded-full bg-black/60 text-white text-xs sm:text-sm">
                    {status}
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
                    <p className="font-bold text-fit-lg text-gray-900 dark:text-white">
                      {result.user.name} 선생님
                    </p>
                  ) : null}

                  {result.success && (
                    <p className="text-emerald-700 dark:text-emerald-300 text-fit-sm mt-1.5 font-medium">
                      {result.user?.role === "TEACHER" && result.checkedAt
                        ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 석식 체크인 되었습니다.`
                        : `${result.mealKind ? MEAL_LABEL[result.mealKind] : "석식"} 체크인 하였습니다.`}
                    </p>
                  )}

                  {result.duplicate && (
                    <p className="text-red-700 dark:text-red-300 text-fit-sm mt-1.5 font-semibold">
                      {result.error || "이미 체크인 되었습니다."}
                    </p>
                  )}

                  {result.notApplicant && (
                    <p className="text-red-700 dark:text-red-300 text-fit-sm mt-1.5 font-semibold">
                      {result.error || "신청자가 아닙니다."}
                    </p>
                  )}

                  {!result.success && !result.duplicate && !result.notApplicant && (
                    <p className="text-amber-800 dark:text-amber-200 text-fit-sm mt-1.5 font-medium">
                      {result.error || "인식되지 않았습니다."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!result && (
              <div className="text-center text-muted-foreground">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                  {mode === "face" ? (
                    <ScanFace className="w-8 h-8 text-primary" />
                  ) : (
                    <QrCode className="w-8 h-8 text-primary" />
                  )}
                </div>
                <p className="text-lg font-semibold whitespace-nowrap">
                  {mode === "face" ? "얼굴을 카메라에 보여주세요" : "QR 코드를 스캔해 주세요"}
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

      {/* 하단 고정 모드 전환 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 z-20 flex justify-center p-3 bg-gradient-to-t from-black/50 to-transparent">
        <button
          onClick={() => setMode((m) => (m === "face" ? "qr" : "face"))}
          className="min-h-11 px-5 rounded-full bg-white/90 dark:bg-black/70 text-gray-900 dark:text-white font-semibold text-sm shadow-lg flex items-center gap-2 whitespace-nowrap"
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
    </div>
  );
}
