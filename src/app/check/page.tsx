"use client";

import { useState, useRef, useCallback } from "react";
import { QRScanner } from "@/components/QRScanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";

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

// AudioContext 싱글턴 (매 사운드마다 생성하지 않음)
let _audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") _audioCtx = new AudioContext();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// 승인: "딩-동" 차임 (C5→E5 상승음)
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

// 중복: "삐—" 길고 큰 단일 경고음
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

// 오류/잘못된 QR: "삐-삐-" 짧은 2연속음
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

export default function CheckPage() {
  const [result, setResult] = useState<CheckInResult | null>(null);
  const processingRef = useRef(false);

  const handleScan = useCallback(async (data: string) => {
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

      if (json.success) {
        playChime();
      } else if (json.duplicate) {
        playLongBeep();
      } else {
        playDoubleBeep();
      }
    } catch (err) {
      console.error("Check-in fetch error:", err);
      setResult({ success: false, error: "서버 연결 오류" });
      playDoubleBeep();
    }

    setTimeout(() => {
      setResult(null);
      processingRef.current = false;
    }, 2000);
  }, []);

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

      {/* Tablet-optimized layout: side-by-side on wider screens */}
      <div className="min-h-screen flex flex-col md:flex-row">
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
                      이미 체크인 되었습니다.
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
    </div>
  );
}
