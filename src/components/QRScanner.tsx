"use client";

import { useEffect, useRef } from "react";
import QrScanner from "qr-scanner";

interface QRScannerProps {
  onScan: (data: string) => void;
}

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onScanRef = useRef(onScan);
  const cooldownRef = useRef(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const scanner = new QrScanner(
      video,
      (result) => {
        if (cooldownRef.current) return;
        console.log("QR decoded:", result.data.substring(0, 30) + "...");
        cooldownRef.current = true;
        onScanRef.current(result.data);

        // Beep sound
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 1200;
          gain.gain.value = 0.3;
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } catch {}

        // Cooldown 2 seconds
        setTimeout(() => {
          cooldownRef.current = false;
        }, 2000);
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 15,
        highlightScanRegion: false,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        calculateScanRegion: (v: HTMLVideoElement) => ({
          x: 0,
          y: 0,
          width: v.videoWidth,
          height: v.videoHeight,
        }),
      }
    );

    scannerRef.current = scanner;
    scanner.start().then(() => {
      console.log("QR Scanner started (full-frame scan)");
    }).catch((err) => {
      console.error("QR Scanner start error:", err);
    });

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <video
        ref={videoRef}
        className="w-full rounded-lg"
        style={{ maxHeight: "400px", objectFit: "cover" }}
      />
      {/* 시각적 가이드 프레임 — 실제 스캔 영역을 제한하지 않음 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="relative w-[70%] aspect-square">
          {/* 네 모서리 강조 (L자 코너) */}
          <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-white/80 rounded-tl" />
          <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-white/80 rounded-tr" />
          <div className="absolute left-0 bottom-0 h-6 w-6 border-l-2 border-b-2 border-white/80 rounded-bl" />
          <div className="absolute right-0 bottom-0 h-6 w-6 border-r-2 border-b-2 border-white/80 rounded-br" />
        </div>
      </div>
    </div>
  );
}
