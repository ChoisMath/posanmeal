"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import QrScanner from "qr-scanner";
import { SwitchCamera } from "lucide-react";

interface QRScannerProps {
  onScan: (data: string) => void;
}

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onScanRef = useRef(onScan);
  const cooldownRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

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

        // Cooldown 2 seconds
        setTimeout(() => {
          cooldownRef.current = false;
        }, 2000);
      },
      {
        preferredCamera: "user",
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
      console.log("QR Scanner started (nimiq/qr-scanner)");
      QrScanner.listCameras(true).then((cameras) => {
        setHasMultipleCameras(cameras.length > 1);
      });
    }).catch((err) => {
      console.error("QR Scanner start error:", err);
    });

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, []);

  const handleToggleCamera = useCallback(() => {
    const newMode = facingMode === "user" ? "environment" : "user";
    if (scannerRef.current) {
      scannerRef.current.setCamera(newMode).then(() => {
        setFacingMode(newMode);
      }).catch((err) => {
        console.error("Camera switch error:", err);
      });
    }
  }, [facingMode]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <video
        ref={videoRef}
        className="w-full rounded-lg"
        style={{ maxHeight: "400px", objectFit: "cover" }}
      />
      {hasMultipleCameras && (
        <button
          onClick={handleToggleCamera}
          className="absolute bottom-3 right-3 bg-black/50 hover:bg-black/70 text-white rounded-full p-2.5 transition-colors z-10"
          aria-label="카메라 전환"
        >
          <SwitchCamera className="h-5 w-5" />
        </button>
      )}
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
