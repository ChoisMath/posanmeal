"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { Fredoka } from "next/font/google";
import styles from "./landing.module.css";

const logoFont = Fredoka({ subsets: ["latin"], weight: "700", display: "swap" });

const WORD = "Meal In Posan";
const LINES: { text: string; colors: string[] }[] = [
  { text: "Meal", colors: ["--logo-indigo", "--logo-blue", "--logo-green", "--logo-red"] },
  { text: "In", colors: ["--logo-yellow", "--logo-magenta"] },
  { text: "Posan", colors: ["--logo-gray"] },
];

const EXTRUSION_LAYERS = 14;
const MAX_YAW = 26;
const MAX_PITCH = 16;
const FOLLOW_MS = 130;

function Letters() {
  return LINES.map((line) => (
    <span key={line.text} className={styles.line}>
      {Array.from(line.text).map((char, index) => (
        <span
          key={index}
          className={styles.letter}
          style={{ "--c": `var(${line.colors[index % line.colors.length]})` } as CSSProperties}
        >
          {char}
        </span>
      ))}
    </span>
  ));
}

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export function LandingWord() {
  const areaRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = areaRef.current;
    const word = wordRef.current;
    if (!area || !word) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let previous = performance.now();
    let yaw = 0;
    let pitch = 0;
    let lookX = 0;
    let lookY = 0;
    let isTracking = false;
    let centerX = 0;
    let centerY = 0;

    const measure = () => {
      const rect = area.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
    };

    const onMove = (event: PointerEvent) => {
      isTracking = true;
      lookX = clampUnit((event.clientX - centerX) / (window.innerWidth / 2));
      lookY = clampUnit((event.clientY - centerY) / (window.innerHeight / 2));
    };
    const stopTracking = () => {
      isTracking = false;
    };
    // 터치는 손을 떼면 가리키는 곳이 사라지지만, 마우스는 멈춰 있어도 그 자리를 계속 본다.
    const onRelease = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") isTracking = false;
    };

    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 100);
      previous = now;
      // 가리키는 곳이 없으면(터치 기기 등) 천천히 좌우로 둘러본다.
      const targetX = isTracking ? lookX : Math.sin(now / 1900) * 0.55;
      const targetY = isTracking ? lookY : Math.sin(now / 2700) * 0.3;
      const ease = 1 - Math.exp(-elapsed / FOLLOW_MS);
      yaw += (targetX * MAX_YAW - yaw) * ease;
      pitch += (-targetY * MAX_PITCH - pitch) * ease;
      word.style.setProperty("--yaw", yaw.toFixed(2));
      word.style.setProperty("--pitch", pitch.toFixed(2));
      frame = requestAnimationFrame(tick);
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onRelease, { passive: true });
    window.addEventListener("pointercancel", stopTracking, { passive: true });
    document.documentElement.addEventListener("pointerleave", stopTracking);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", stopTracking);
      document.documentElement.removeEventListener("pointerleave", stopTracking);
    };
  }, []);

  return (
    <div ref={areaRef} className={`${styles.wordArea} ${logoFont.className}`}>
      <div className={styles.wordEnter}>
        <div ref={wordRef} className={styles.word}>
          <div className={styles.wordShadow} aria-hidden="true">
            <Letters />
          </div>
          {Array.from({ length: EXTRUSION_LAYERS }, (_, index) => {
            const depth = EXTRUSION_LAYERS - index;
            return (
              <div
                key={depth}
                className={styles.layer}
                style={{ "--i": depth } as CSSProperties}
                aria-hidden="true"
              >
                <Letters />
              </div>
            );
          })}
          <h1 className={styles.wordFront} aria-label={WORD}>
            <span aria-hidden="true">
              <Letters />
            </span>
          </h1>
        </div>
      </div>
    </div>
  );
}
