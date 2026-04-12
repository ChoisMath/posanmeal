"use client";

import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";

interface QRGeneratorProps {
  type: "STUDENT" | "WORK" | "PERSONAL";
}

export function QRGenerator({ type }: QRGeneratorProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [mode, setMode] = useState<"online" | "local">("online");

  const generateQRImage = useCallback(async (data: string) => {
    const dataUrl = await QRCode.toDataURL(data, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    setQrDataUrl(dataUrl);
  }, []);

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch(`/api/qr/token?type=${type}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "QR 코드를 생성할 수 없습니다.");
        setQrDataUrl("");
        return;
      }

      setError("");
      setMode(data.mode || "online");
      await generateQRImage(data.token);
      setTimeLeft(data.expiresIn);
    } catch {
      setError("QR 코드 생성 중 오류가 발생했습니다.");
    }
  }, [type, generateQRImage]);

  useEffect(() => {
    fetchToken();
  }, [fetchToken]);

  // Timer: only for online mode (local mode has expiresIn=0)
  useEffect(() => {
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          fetchToken();
          return 0;
        }
        if (prev === 30) {
          fetchToken();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, fetchToken]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="QR Code"
          className="w-[280px] h-[280px] rounded-xl border"
        />
      ) : (
        <div className="w-[280px] h-[280px] rounded-xl border flex items-center justify-center">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      )}
      {mode === "online" ? (
        <p className="text-sm font-mono text-muted-foreground">
          {minutes}:{seconds.toString().padStart(2, "0")} 남음
        </p>
      ) : (
        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
          로컬 모드 — 고유 QR코드
        </p>
      )}
    </div>
  );
}
