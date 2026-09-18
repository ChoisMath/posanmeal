"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import QrScanner from "qr-scanner";
import { SwitchCamera } from "lucide-react";

interface QRScannerProps {
  onScan: (data: string) => void;
}

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onScanRef = useRef(onScan);
  const cooldownRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;
    let disposed = false;
    let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

    const scanner = new QrScanner(
      video,
      (result) => {
        if (disposed || cooldownRef.current) return;
        cooldownRef.current = true;
        onScanRef.current(result.data);

        cooldownTimer = setTimeout(() => {
          cooldownRef.current = false;
        }, 2000);
      },
      {
        preferredCamera: "user",
        maxScansPerSecond: 15,
        highlightScanRegion: false,
        highlightCodeOutline: true,
        overlay,
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
    // StrictMode의 첫 정리 이후 시작해야 이전 인스턴스의 지연 stop이 새 스트림을 끄지 않는다.
    Promise.resolve().then(async () => {
      if (disposed) return;
      await scanner.start();
      if (disposed) return;
      const cameras = await QrScanner.listCameras(true);
      if (!disposed) {
        setHasMultipleCameras(cameras.length > 1);
      }
    }).catch((err) => {
      if (disposed) return;
      console.error("QR Scanner start error:", err);
      setCameraError(true);
    });

    return () => {
      disposed = true;
      clearTimeout(cooldownTimer);
      cooldownRef.current = false;
      scanner.destroy();
      scannerRef.current = null;
      overlay.replaceChildren();
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
    <div className="relative w-full h-full min-h-0 overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain object-center"
      />
      <div ref={overlayRef} aria-hidden="true" />
      {cameraError && (
        <p
          role="alert"
          className="absolute inset-0 grid place-items-center bg-black/60 px-6 text-center text-sm text-white"
        >
          카메라를 시작할 수 없습니다. 카메라 권한을 확인해 주세요.
        </p>
      )}
      {hasMultipleCameras && (
        <button
          onClick={handleToggleCamera}
          className="absolute bottom-3 right-3 bg-black/50 hover:bg-black/70 text-white rounded-full p-3 transition-colors z-10"
          aria-label="카메라 전환"
        >
          <SwitchCamera className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
