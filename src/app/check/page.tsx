"use client";

import { useState, useRef, useCallback } from "react";
import { QRScanner } from "@/components/QRScanner";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    } catch (err) {
      console.error("Check-in fetch error:", err);
      setResult({ success: false, error: "서버 연결 오류" });
    }

    // Reset after 2 seconds
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
        ? "bg-green-500"
        : "bg-yellow-500"
    : "bg-background";

  return (
    <div className={`min-h-screen transition-colors duration-300 ${bgClass}`}>
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Camera Area — always active */}
      <div className="bg-gray-900 p-4">
        <div className="max-w-md mx-auto">
          <QRScanner onScan={handleScan} />
        </div>
      </div>

      {/* Result Area */}
      <div className="p-6 max-w-md mx-auto">
        {result && (
          <div className="flex items-center gap-4 bg-white/90 dark:bg-gray-800/90 rounded-xl p-4">
            {result.user?.photoUrl ? (
              <img
                src={result.user.photoUrl}
                alt={result.user.name}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xl font-bold">
                {result.user?.name?.charAt(0) || "?"}
              </div>
            )}
            <div>
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
                <p className="text-green-700 dark:text-green-300 text-fit-sm mt-1">
                  {result.user?.role === "TEACHER" && result.checkedAt
                    ? `${formatCheckedAt(result.checkedAt)} ${typeLabel(result.type)}로 석식 체크인 되었습니다.`
                    : "석식 체크인 되었습니다."}
                </p>
              )}

              {result.duplicate && (
                <p className="text-red-700 dark:text-red-300 text-fit-sm mt-1 font-semibold">
                  이미 Checkin 되었습니다. 확인해 주세요.
                </p>
              )}

              {!result.success && !result.duplicate && (
                <p className="text-yellow-700 dark:text-yellow-300 text-fit-sm mt-1">
                  {result.error}
                </p>
              )}
            </div>
          </div>
        )}

        {!result && (
          <div className="text-center text-muted-foreground">
            <p className="text-lg font-semibold">QR 코드를 스캔해 주세요</p>
            <p className="text-sm mt-1">카메라에 QR 코드를 보여주세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
