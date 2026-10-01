import type { CSSProperties } from "react";
import { Check, QrCode, ScanFace } from "lucide-react";
import styles from "./landing.module.css";

/** 장면 단위(--u) 좌표. x는 화면 가로 중앙 기준 왼쪽 끝, w·h는 크기. 모든 요소는 바닥선에 선다. */
function place(x: number, w: number, h: number): CSSProperties {
  return { "--x": x, "--w": w, "--h": h } as CSSProperties;
}

function Student({ variant }: { variant: "qr" | "face" }) {
  const isQr = variant === "qr";
  return (
    <div
      className={`${styles.at} ${styles.actor} ${isQr ? styles.actorQr : styles.actorFace}`}
      style={place(-175, 100, 190)}
    >
      <svg viewBox="0 0 100 190">
        <rect className={isQr ? styles.packQr : styles.packFace} x="16" y="58" width="24" height="48" rx="10" />
        <g className={styles.legsWalk}>
          <g className={`${styles.leg} ${styles.legBack}`}>
            <rect className={styles.shade} x="43" y="110" width="14" height="76" rx="7" />
            <rect className={styles.shade} x="43" y="178" width="25" height="12" rx="6" />
          </g>
          <g className={styles.leg}>
            <rect className={styles.body} x="43" y="110" width="14" height="76" rx="7" />
            <rect className={styles.body} x="43" y="178" width="25" height="12" rx="6" />
          </g>
        </g>
        <g className={styles.legsStand}>
          <rect className={styles.shade} x="39" y="110" width="14" height="76" rx="7" />
          <rect className={styles.shade} x="39" y="178" width="25" height="12" rx="6" />
          <rect className={styles.body} x="47" y="110" width="14" height="76" rx="7" />
          <rect className={styles.body} x="47" y="178" width="25" height="12" rx="6" />
        </g>
        <rect className={styles.body} x="32" y="50" width="38" height="78" rx="18" />
        {!isQr && <circle className={styles.shade} cx="29" cy="30" r="10" />}
        <circle className={styles.body} cx="52" cy="26" r="19" />
        <g className={`${styles.arm} ${isQr ? styles.armQr : ""}`}>
          <rect className={styles.shade} x="46.5" y="58" width="13" height="50" rx="6.5" />
          {isQr && <rect className={styles.phone} x="39" y="103" width="28" height="7" rx="2.5" />}
        </g>
        {!isQr && (
          <>
            <path
              className={styles.faceFrame}
              d="M24 12V2h10 M70 2h10v10 M80 40v10H70 M34 50H24V40"
            />
            <rect className={styles.faceScan} x="29" y="5" width="46" height="2.5" rx="1.25" />
          </>
        )}
      </svg>
    </div>
  );
}

/** QR 체크인 → 문 열림, 얼굴 체크인 → 문 열림을 번갈아 보여 주는 배경 모션그래픽. 순수 CSS로 돈다. */
export function LandingScene() {
  return (
    <div aria-hidden="true">
      <div className={styles.floor}>
        <div className={styles.spill} />
      </div>
      <div className={styles.scene}>
        <div className={styles.glow} />
        <div className={`${styles.at} ${styles.door}`} style={place(40, 210, 300)}>
          <div className={styles.doorway}>
            <div className={`${styles.leaf} ${styles.leafLeft}`} />
            <div className={`${styles.leaf} ${styles.leafRight}`} />
          </div>
        </div>
        <div className={styles.at} style={place(-52, 64, 152)}>
          <div className={styles.kioskBase} />
          <div className={styles.kioskPole} />
          <div className={styles.pulse} />
          <div className={styles.kioskHead}>
            <div className={styles.screen}>
              <QrCode className={`${styles.screenIcon} ${styles.modeQr}`} />
              <ScanFace className={`${styles.screenIcon} ${styles.modeFace}`} />
              <div className={styles.scanline} />
            </div>
            <div className={styles.okLayer}>
              <Check strokeWidth={3} />
            </div>
          </div>
        </div>
        <Student variant="qr" />
        <Student variant="face" />
      </div>
    </div>
  );
}
