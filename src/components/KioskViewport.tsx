"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function KioskViewport({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const visualViewport = window.visualViewport;
    let animationFrame: number | null = null;

    const measureHeight = () => {
      animationFrame = null;
      // 확대 중에는 축소된 visual viewport에 맞춰 화면을 다시 배치하지 않는다.
      if (visualViewport && Math.abs(visualViewport.scale - 1) > 0.01) return;

      const heights = [window.innerHeight, visualViewport?.height].filter(
        (height): height is number =>
          typeof height === "number" && Number.isFinite(height) && height > 0,
      );
      if (heights.length === 0) return;

      viewport.style.setProperty("--kiosk-height", `${Math.min(...heights)}px`);
    };

    const scheduleMeasurement = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(measureHeight);
    };

    measureHeight();
    scheduleMeasurement();
    window.addEventListener("resize", scheduleMeasurement);
    window.addEventListener("pageshow", scheduleMeasurement);
    window.addEventListener("orientationchange", scheduleMeasurement);
    document.addEventListener("visibilitychange", scheduleMeasurement);
    visualViewport?.addEventListener("resize", scheduleMeasurement);

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasurement);
      window.removeEventListener("pageshow", scheduleMeasurement);
      window.removeEventListener("orientationchange", scheduleMeasurement);
      document.removeEventListener("visibilitychange", scheduleMeasurement);
      visualViewport?.removeEventListener("resize", scheduleMeasurement);
    };
  }, []);

  return (
    <div ref={viewportRef} className="kiosk-viewport flex flex-col overflow-hidden bg-gray-950 text-white">
      {children}
    </div>
  );
}
