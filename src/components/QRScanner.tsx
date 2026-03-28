"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (data: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, scanning }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string>("");

  // Keep onScan ref up to date without causing re-renders
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!scanning) {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    async function startScanner() {
      // Wait for DOM
      await new Promise((r) => setTimeout(r, 500));
      if (cancelled) return;

      const el = document.getElementById("qr-reader");
      if (!el) {
        console.error("QR reader element not found");
        return;
      }

      // Clean up any previous instance
      if (scannerRef.current) {
        try { await scannerRef.current.stop(); } catch {}
        scannerRef.current = null;
      }

      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      // Get available cameras
      let cameraConfig: string | { facingMode: string };
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          if (!cancelled) setError("카메라를 찾을 수 없습니다.");
          return;
        }
        const backCam = cameras.find(
          (c) =>
            c.label.toLowerCase().includes("back") ||
            c.label.toLowerCase().includes("rear") ||
            c.label.toLowerCase().includes("environment")
        );
        cameraConfig = backCam ? backCam.id : cameras[0].id;
      } catch {
        // Fallback to facingMode
        cameraConfig = { facingMode: "environment" };
      }

      if (cancelled) return;

      const scanConfig = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      };

      const successCallback = (decodedText: string) => {
        console.log("QR scanned:", decodedText.substring(0, 20) + "...");
        onScanRef.current(decodedText);
      };

      try {
        await scanner.start(cameraConfig, scanConfig, successCallback, () => {});
        if (!cancelled) setError("");
        console.log("QR Scanner started successfully");
      } catch (err) {
        console.error("QR Scanner start failed:", err);
        // Retry with first available camera if facingMode failed
        if (typeof cameraConfig === "object") {
          try {
            const cameras = await Html5Qrcode.getCameras();
            if (cameras?.length > 0 && !cancelled) {
              await scanner.start(cameras[0].id, scanConfig, successCallback, () => {});
              if (!cancelled) setError("");
              console.log("QR Scanner started with fallback camera");
            }
          } catch (retryErr) {
            console.error("QR Scanner fallback failed:", retryErr);
            if (!cancelled) setError("카메라를 시작할 수 없습니다. 권한을 확인해 주세요.");
          }
        } else if (!cancelled) {
          setError("카메라를 시작할 수 없습니다. 권한을 확인해 주세요.");
        }
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scanning]);

  return (
    <div>
      <div
        id="qr-reader"
        className="w-full max-w-md mx-auto rounded-lg overflow-hidden"
        style={{ minHeight: "300px" }}
      />
      {error && (
        <p className="text-center text-red-400 text-sm mt-2">{error}</p>
      )}
    </div>
  );
}
