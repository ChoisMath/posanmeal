"use client";

import { useState } from "react";
import { toLocalCheckInRow, type LocalCheckInRow } from "@/components/LocalCheckInsTable";
import { buildLocalCheckInsFile } from "@/lib/local-checkins-export";
import {
  FORCE_RESET_PHRASE,
  forceClearLocalData,
  getReviewableCheckIns,
  getUser,
  type PendingCheckInCounts,
} from "@/lib/local-db";

interface ForceResetDialogProps {
  counts: PendingCheckInCounts;
  onClose: () => void;
  /** 동기화를 걸 수 있는 화면(키오스크)에서만 준다. */
  onSync?: () => void;
  onCleared: () => void;
}

async function downloadPendingCheckIns(): Promise<"xlsx" | "csv"> {
  const checkins = await getReviewableCheckIns();
  const rows: LocalCheckInRow[] = [];
  for (const checkin of checkins) {
    rows.push(toLocalCheckInRow(checkin, await getUser(checkin.userId)));
  }
  // 오프라인이면 exceljs 청크를 못 받을 수 있다. 그때도 내보내기는 끝나야 한다.
  const { blob, extension } = await buildLocalCheckInsFile(rows);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `local-checkins-${new Date().toISOString().slice(0, 10)}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
  return extension;
}

/** 미전송·확인 대기 기록이 남은 기기에서만 뜬다. 내보내기 없이는 지우지 않는다. */
export function ForceResetDialog({ counts, onClose, onSync, onCleared }: ForceResetDialogProps) {
  const [exported, setExported] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"xlsx" | "csv" | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      setFormat(await downloadPendingCheckIns());
      setExported(true);
    } catch {
      setError("내보내기에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForce() {
    setBusy(true);
    setError(null);
    try {
      await forceClearLocalData({ exported, typed });
      onCleared();
    } catch (err) {
      setError(err instanceof Error ? err.message : "초기화하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="초기화 확인"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2"
    >
      <div className="flex max-h-[calc(100svh-1rem)] w-full max-w-md flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 text-slate-900">
        <p className="shrink-0 text-base font-bold whitespace-nowrap">아직 서버에 없는 기록이 있습니다</p>
        <p className="shrink-0 text-sm whitespace-nowrap">
          미전송 {counts.unsynced}건 · 확인 대기 {counts.review}건
        </p>
        {onSync && (
          <button
            onClick={onSync}
            disabled={busy}
            className="min-h-11 w-full shrink-0 rounded-xl bg-blue-600 px-3 text-sm font-semibold whitespace-nowrap text-white disabled:opacity-40"
          >
            동기화 후 다시 시도
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={busy}
          className="min-h-11 w-full shrink-0 rounded-xl bg-slate-200 px-3 text-sm font-semibold whitespace-nowrap disabled:opacity-40"
        >
          {exported ? `내보내기 완료(${format?.toUpperCase()}) — 다시 내보내기` : "Excel로 내보내기"}
        </button>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={`${FORCE_RESET_PHRASE} 입력`}
          aria-label="확인 문구"
          className="min-h-11 w-full shrink-0 rounded-xl border border-slate-300 px-3 text-base"
        />
        <button
          onClick={handleForce}
          disabled={busy || !exported || typed.trim() !== FORCE_RESET_PHRASE}
          className="min-h-11 w-full shrink-0 rounded-xl bg-red-600 px-3 text-sm font-semibold whitespace-nowrap text-white disabled:opacity-40"
        >
          강제 초기화
        </button>
        {error && <p className="shrink-0 text-sm font-semibold whitespace-nowrap text-red-700">{error}</p>}
        <button
          onClick={onClose}
          disabled={busy}
          className="min-h-11 w-full shrink-0 rounded-xl bg-slate-100 px-3 text-sm font-semibold whitespace-nowrap disabled:opacity-40"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
