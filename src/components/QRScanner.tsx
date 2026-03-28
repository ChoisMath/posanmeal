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

        // Vibrate
        try { navigator.vibrate(100); } catch {}

        // Cooldown 2 seconds
        setTimeout(() => {
          cooldownRef.current = false;
        }, 2000);
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 25,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
      }
    );

    scannerRef.current = scanner;
    scanner.start().then(() => {
      console.log("QR Scanner started (nimiq/qr-scanner)");
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
    </div>
  );
}
