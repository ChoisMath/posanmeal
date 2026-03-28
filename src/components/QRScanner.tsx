"use client";

import { useEffect, useRef, useCallback } from "react";
import jsQR from "jsqr";

interface QRScannerProps {
  onScan: (data: string) => void;
}

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScanRef = useRef(onScan);
  const cooldownRef = useRef(false);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const scan = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scan);
      return;
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(scan);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    if (code && code.data && !cooldownRef.current) {
      console.log("QR decoded:", code.data.substring(0, 30) + "...");
      cooldownRef.current = true;
      onScanRef.current(code.data);

      // Cooldown: ignore scans for 2.5 seconds
      setTimeout(() => {
        cooldownRef.current = false;
      }, 2500);
    }

    animFrameRef.current = requestAnimationFrame(scan);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          await video.play();
          console.log("Camera started, scanning for QR codes...");
          animFrameRef.current = requestAnimationFrame(scan);
        }
      } catch (err) {
        console.error("Camera access error:", err);
        // Retry without facingMode constraint
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });

          if (!mounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }

          streamRef.current = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            video.setAttribute("playsinline", "true");
            await video.play();
            console.log("Camera started (fallback), scanning for QR codes...");
            animFrameRef.current = requestAnimationFrame(scan);
          }
        } catch (retryErr) {
          console.error("Camera fallback error:", retryErr);
        }
      }
    }

    startCamera();

    return () => {
      mounted = false;
      cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [scan]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <video
        ref={videoRef}
        className="w-full rounded-lg"
        style={{ maxHeight: "400px", objectFit: "cover" }}
        muted
        playsInline
      />
      <canvas ref={canvasRef} className="hidden" />
      {/* Scan guide overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-56 h-56 border-2 border-white/60 rounded-xl" />
      </div>
    </div>
  );
}
