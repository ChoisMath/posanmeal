"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudentQRCard } from "@/components/StudentQRCard";
import { chunk } from "@/lib/qr-card";

export interface PrintStudent {
  id: number;
  name: string;
  number: number;
  qrString: string;
}

interface StudentQRPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: PrintStudent[];
  grade: number;
  classNum: number;
}

const CARDS_PER_PAGE = 16; // 4열 × 4행

export function StudentQRPrintDialog({
  open,
  onOpenChange,
  students,
  grade,
  classNum,
}: StudentQRPrintDialogProps) {
  const [qrMap, setQrMap] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // students 는 부모 filter 로 매 렌더 새 배열 → id 목록 키로 재생성 제어.
  const idsKey = students.map((s) => s.id).join(",");

  useEffect(() => {
    if (!open || students.length === 0) {
      setQrMap({});
      return;
    }
    let cancelled = false;
    setGenerating(true);
    (async () => {
      const entries = await Promise.all(
        students.map(async (s) => {
          const url = await QRCode.toDataURL(s.qrString, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#000000", light: "#ffffff" },
          });
          return [s.id, url] as const;
        }),
      );
      if (!cancelled) {
        setQrMap(Object.fromEntries(entries));
        setGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  const pages = chunk(students, CARDS_PER_PAGE);
  const handlePrint = () => window.print();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[92vw] sm:max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="whitespace-nowrap">
                QR 카드 출력 — {students.length}명
              </DialogTitle>
              <Button
                size="sm"
                className="rounded-xl"
                onClick={handlePrint}
                disabled={generating || students.length === 0}
              >
                <Printer className="mr-1 h-4 w-4" />
                {generating ? "준비 중..." : "인쇄"}
              </Button>
            </div>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-auto rounded-lg bg-muted/40 p-2">
            <div className="flex flex-wrap justify-center gap-2">
              {students.map((s) => (
                <StudentQRCard
                  key={s.id}
                  grade={grade}
                  classNum={classNum}
                  number={s.number}
                  name={s.name}
                  qrDataUrl={qrMap[s.id] ?? ""}
                />
              ))}
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            A4 한 장에 최대 16명(4×4)씩 인쇄됩니다.
          </p>
        </DialogContent>
      </Dialog>

      {/* 인쇄 전용 루트: 화면에선 숨김, 인쇄 시 이 영역만 노출(@page A4). body 직속 포털이라 fixed 모달과 위치 충돌 없음. */}
      {open &&
        mounted &&
        createPortal(
          <div className="qr-print-root" style={{ display: "none" }}>
            <style>{`
@page { size: A4; margin: 8mm; }
@media print {
  body > *:not(.qr-print-root) { display: none !important; }
  .qr-print-root { display: block !important; }
  .qr-print-page { break-after: page; }
  .qr-print-page:last-child { break-after: auto; }
}
            `}</style>
            {pages.map((page, pageIndex) => (
              <div
                key={pageIndex}
                className="qr-print-page"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 47mm)",
                  gap: "2mm",
                  justifyContent: "center",
                  alignContent: "start",
                }}
              >
                {page.map((s) => (
                  <StudentQRCard
                    key={s.id}
                    grade={grade}
                    classNum={classNum}
                    number={s.number}
                    name={s.name}
                    qrDataUrl={qrMap[s.id] ?? ""}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
