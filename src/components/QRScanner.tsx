"use client";

import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (data: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, scanning }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("qr-reader");

  useEffect(() => {
    if (!scanning) return;

    const scanner = new Html5Qrcode(containerRef.current);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          onScan(decodedText);
        },
        () => {}
      )
      .catch((err) => {
        console.error("QR Scanner error:", err);
      });

    return () => {
      scanner
        .stop()
        .catch(() => {});
    };
  }, [scanning, onScan]);

  return (
    <div
      id={containerRef.current}
      className="w-full max-w-md mx-auto rounded-lg overflow-hidden"
    />
  );
}
