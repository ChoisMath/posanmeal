"use client";

import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface SignaturePadProps {
  onSignatureChange: (base64: string | null) => void;
  height?: number;
}

export function SignaturePad({ onSignatureChange, height = 150 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);
  const onSignatureChangeRef = useRef(onSignatureChange);
  onSignatureChangeRef.current = onSignatureChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
      if (hasDrawn.current) {
        hasDrawn.current = false;
        onSignatureChangeRef.current(null);
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [height]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDrawing.current = true;
    hasDrawn.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    canvas.setPointerCapture(e.pointerId);
  }, [getPos]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, [getPos]);

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false;
    if (hasDrawn.current) {
      onSignatureChange(canvasRef.current!.toDataURL("image/png"));
    }
  }, [onSignatureChange]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    onSignatureChange(null);
  }, [onSignatureChange]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 cursor-crosshair"
        style={{ height, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex justify-end mt-2">
        <Button variant="outline" size="sm" onClick={handleClear} className="rounded-lg">
          서명 지우기
        </Button>
      </div>
    </div>
  );
}
