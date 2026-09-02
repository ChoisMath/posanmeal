"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanFace, Trash2 } from "lucide-react";
import { FACE_CONSENT_TEXT, FACE_CONSENT_VERSION } from "@/lib/face-consent";
import { FACE_MIN_EMBEDDINGS } from "@/lib/face-constants";
import { detectSingleFace, isQualityFace, loadHuman } from "@/lib/human-client";

interface FaceStatus {
  registered: boolean;
  consentAt?: string;
}

type Phase = "idle" | "consent" | "capturing" | "saving";

const CAPTURE_INTERVAL_MS = 400;
const CAPTURE_GAP_MS = 700;

export function FaceEnroll() {
  const { data, mutate } = useSWR<FaceStatus>("/api/users/me/face", fetcher);
  const [phase, setPhase] = useState<Phase>("idle");
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const embeddingsRef = useRef<number[][]>([]);
  const stopRef = useRef(false);

  const stopCamera = useCallback(() => {
    stopRef.current = true;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCapture = useCallback(async () => {
    setPhase("capturing");
    setProgress(0);
    setMessage("카메라 준비 중...");
    embeddingsRef.current = [];
    stopRef.current = false;

    try {
      const [human, stream] = await Promise.all([
        loadHuman(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }),
      ]);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      setMessage("얼굴을 화면 중앙에 맞춰주세요");
      let lastCaptureAt = 0;

      while (!stopRef.current && embeddingsRef.current.length < FACE_MIN_EMBEDDINGS) {
        await new Promise((r) => setTimeout(r, CAPTURE_INTERVAL_MS));
        if (stopRef.current) return;
        const face = await detectSingleFace(human, video);
        if (!face) {
          setMessage("얼굴이 인식되지 않습니다. 혼자, 정면으로 서 주세요");
          continue;
        }
        if (!isQualityFace(face)) {
          setMessage("조금 더 밝은 곳에서 정면을 바라봐 주세요");
          continue;
        }
        if (Date.now() - lastCaptureAt < CAPTURE_GAP_MS) continue;
        lastCaptureAt = Date.now();
        embeddingsRef.current.push(face.embedding);
        setProgress(embeddingsRef.current.length);
        setMessage(`촬영 ${embeddingsRef.current.length}/${FACE_MIN_EMBEDDINGS} — 고개를 살짝 움직여 주세요`);
      }

      if (embeddingsRef.current.length >= FACE_MIN_EMBEDDINGS) {
        setPhase("saving");
        setMessage("저장 중...");
        const res = await fetch("/api/users/me/face", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeddings: embeddingsRef.current,
            consentVersion: FACE_CONSENT_VERSION,
          }),
        });
        if (!res.ok) throw new Error("save failed");
        await mutate();
        setPhase("idle");
        setMessage(null);
      }
    } catch (err) {
      console.error("Face enroll error:", err);
      setPhase("idle");
      setMessage(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "카메라 권한을 허용해 주세요."
          : "등록에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      stopCamera();
    }
  }, [mutate, stopCamera]);

  const handleDelete = useCallback(async () => {
    if (!confirm("등록된 안면인식 정보를 삭제(동의 철회)하시겠습니까?")) return;
    await fetch("/api/users/me/face", { method: "DELETE" });
    await mutate();
  }, [mutate]);

  const handleCancelCapture = useCallback(() => {
    stopCamera();
    setPhase("idle");
    setMessage(null);
  }, [stopCamera]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
        <span className="text-muted-foreground whitespace-nowrap">안면인식</span>
        {data?.registered ? (
          <span className="flex items-center gap-2">
            <span className="font-medium text-emerald-600 whitespace-nowrap">
              등록됨 ({data.consentAt ? new Date(data.consentAt).toLocaleDateString("ko-KR") : ""})
            </span>
            <Button size="sm" variant="outline" className="rounded-xl min-h-9" onClick={() => { setAgreed(false); setPhase("consent"); }}>
              재등록
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl min-h-9 text-red-600" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </span>
        ) : (
          <Button size="sm" className="rounded-xl min-h-9 whitespace-nowrap" onClick={() => { setAgreed(false); setPhase("consent"); }}>
            <ScanFace className="h-4 w-4 mr-1" /> 얼굴 등록하기
          </Button>
        )}
      </div>
      {message && phase === "idle" && <p className="text-xs text-red-600">{message}</p>}

      {/* 동의 모달 */}
      <Dialog open={phase === "consent"} onOpenChange={(open) => !open && setPhase("idle")}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>안면인식정보 수집·이용 동의</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground rounded-xl bg-muted/40 p-3">
            {FACE_CONSENT_TEXT}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4" />
            위 내용에 동의합니다
          </label>
          <Button disabled={!agreed} onClick={startCapture} className="rounded-xl min-h-11 w-full">
            동의하고 촬영 시작
          </Button>
        </DialogContent>
      </Dialog>

      {/* 촬영 모달 */}
      <Dialog open={phase === "capturing" || phase === "saving"} onOpenChange={(open) => !open && handleCancelCapture()}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>얼굴 등록 ({progress}/{FACE_MIN_EMBEDDINGS})</DialogTitle>
          </DialogHeader>
          <video ref={videoRef} playsInline muted className="w-full rounded-xl bg-black aspect-[3/4] object-cover" />
          <p className="text-sm text-center text-muted-foreground">{message}</p>
          <Button variant="outline" onClick={handleCancelCapture} className="rounded-xl min-h-11 w-full">
            취소
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
