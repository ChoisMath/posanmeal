"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (data: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, scanning }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!scanning) {
      // Stop scanner if it's running
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      return;
    }

    let stopped = false;

    async function startScanner() {
      // Wait for DOM element to be ready
      await new Promise((r) => setTimeout(r, 300));
      if (stopped || !mountedRef.current) return;

      const el = document.getElementById("qr-reader");
      if (!el) return;

      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      // Try to get available cameras first
      let cameraId: string | { facingMode: string } = { facingMode: "environment" };

      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          // Prefer back camera, fallback to first available
          const backCamera = cameras.find(
            (c) =>
              c.label.toLowerCase().includes("back") ||
              c.label.toLowerCase().includes("rear") ||
              c.label.toLowerCase().includes("environment")
          );
          cameraId = backCamera ? backCamera.id : cameras[0].id;
        }
      } catch {
        // getCameras failed, fall back to facingMode
        cameraId = { facingMode: "environment" };
      }

      if (stopped || !mountedRef.current) return;

      try {
        await scanner.start(
          cameraId,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (mountedRef.current) {
              onScan(decodedText);
            }
          },
          () => {}
        );
        if (mountedRef.current) setError("");
      } catch (err) {
        console.error("QR Scanner start error:", err);
        // If environment camera failed, try without facingMode constraint
        if (typeof cameraId === "object") {
          try {
            const cameras = await Html5Qrcode.getCameras();
            if (cameras && cameras.length > 0 && !stopped && mountedRef.current) {
              await scanner.start(
                cameras[0].id,
                {
                  fps: 10,
                  qrbox: { width: 250, height: 250 },
                  aspectRatio: 1.0,
                },
                (decodedText) => {
                  if (mountedRef.current) {
                    onScan(decodedText);
                  }
                },
                () => {}
              );
              if (mountedRef.current) setError("");
            } else if (mountedRef.current) {
              setError("카메라를 찾을 수 없습니다.");
            }
          } catch (retryErr) {
            console.error("QR Scanner retry error:", retryErr);
            if (mountedRef.current) {
              setError("카메라를 시작할 수 없습니다. 카메라 권한을 확인해 주세요.");
            }
          }
        } else if (mountedRef.current) {
          setError("카메라를 시작할 수 없습니다. 카메라 권한을 확인해 주세요.");
        }
      }
    }

    startScanner();

    return () => {
      stopped = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scanning, onScan]);

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
