# /check QR 전체 프레임 스캔 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/check` 페이지의 QR 스캐너가 카메라 프레임 전체에서 QR 코드를 인식하도록 변경하고, 참고용 시각 가이드는 CSS 오버레이로 유지한다.

**Architecture:** nimiq `qr-scanner` 라이브러리의 `calculateScanRegion` 옵션을 오버라이드하여 전체 비디오 프레임을 스캔 영역으로 지정한다. 라이브러리 내장 하이라이트 박스는 끄고, CSS `position:absolute` 오버레이로 사용자 친화적인 가이드 프레임만 유지한다. 단일 파일(`src/components/QRScanner.tsx`) 변경으로 완결된다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `qr-scanner` (nimiq), Tailwind CSS v4

**Related spec:** `docs/superpowers/specs/2026-04-11-check-qr-full-frame-scan-design.md`

**Testing note:** 이 변경은 카메라/UI 동작이라 자동화 단위 테스트가 부적합하다. 검증은 수동 브라우저 테스트로 수행한다 (스펙의 테스트 계획 참조). 프로젝트에는 기존 테스트 스위트가 없으므로 TDD 대신 **"작게 변경 → 브라우저에서 확인 → 커밋"** 사이클을 따른다.

---

## Task 1: QRScanner에 전체 프레임 스캔 설정 적용

**Files:**
- Modify: `src/components/QRScanner.tsx` (전체 파일 재작성)

- [ ] **Step 1: 현재 파일 확인**

Run: `git show HEAD:src/components/QRScanner.tsx`
Expected: 현재 버전이 출력되는지 확인 (기준점 파악).

- [ ] **Step 2: `QRScanner.tsx` 전체 교체**

다음 내용으로 `src/components/QRScanner.tsx`를 완전히 교체한다:

```tsx
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

        // Cooldown 2 seconds
        setTimeout(() => {
          cooldownRef.current = false;
        }, 2000);
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 15,
        highlightScanRegion: false,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        calculateScanRegion: (v: HTMLVideoElement) => ({
          x: 0,
          y: 0,
          width: v.videoWidth,
          height: v.videoHeight,
        }),
      }
    );

    scannerRef.current = scanner;
    scanner.start().then(() => {
      console.log("QR Scanner started (full-frame scan)");
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
      {/* 시각적 가이드 프레임 — 실제 스캔 영역을 제한하지 않음 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="relative w-[70%] aspect-square">
          {/* 네 모서리 강조 (L자 코너) */}
          <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-white/80 rounded-tl" />
          <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-white/80 rounded-tr" />
          <div className="absolute left-0 bottom-0 h-6 w-6 border-l-2 border-b-2 border-white/80 rounded-bl" />
          <div className="absolute right-0 bottom-0 h-6 w-6 border-r-2 border-b-2 border-white/80 rounded-br" />
        </div>
      </div>
    </div>
  );
}
```

변경 요약:
- `maxScansPerSecond: 25` → `15` (성능 예산 복원)
- `highlightScanRegion: true` → `false` (라이브러리 내장 박스 제거)
- `calculateScanRegion` 추가 → 전체 비디오 프레임 반환
- JSX에 CSS 오버레이 가이드 프레임 추가 (`pointer-events-none`, `aria-hidden`, 70% 크기, 네 모서리 L자 코너)

- [ ] **Step 3: 타입 체크 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음. `calculateScanRegion` 시그니처는 `qr-scanner` 타입 정의에 존재하므로 통과해야 한다.

- [ ] **Step 4: 린트 확인**

Run: `npm run lint`
Expected: `QRScanner.tsx`에 대한 새 경고 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/components/QRScanner.tsx
git commit -m "feat(check): scan QR across full camera frame

- Override calculateScanRegion to use entire video frame
- Replace library highlight box with CSS corner-guide overlay
- Lower maxScansPerSecond from 25 to 15 to offset larger ROI cost
- Keep 2s cooldown, beep, and highlightCodeOutline feedback"
```

---

## Task 2: 수동 브라우저 검증

**Files:** (코드 변경 없음 — 수동 검증만)

이 태스크는 개발 서버를 띄우고 실제 카메라로 동작을 확인한다. 실패 항목이 있으면 Task 3 롤백/조정 단계로 간다.

- [ ] **Step 1: 개발 서버 기동**

Run: `npm run dev`
Expected: `http://localhost:3000` 에서 서비스 접근 가능.

- [ ] **Step 2: `/check` 페이지 카메라 권한 허용**

브라우저(데스크톱 크롬 우선)에서 `http://localhost:3000/check` 접속.
Expected: 카메라 권한 프롬프트 → 허용 → 비디오 스트림 표시, 네 모서리 코너 가이드가 보임. 라이브러리 기본 파란 박스는 **보이지 않아야** 함.

- [ ] **Step 3: 전체 프레임 스캔 확인 — 모서리 배치**

유효한 학생/교사 QR(테스트용 `/student` 또는 `/teacher`에서 생성)을 카메라 프레임의 **좌측 상단 모서리** 근처에 위치시킨다.
Expected: 가이드 프레임 박스 밖이지만 **즉시 인식**되어 결과 카드 표시, 비프음, 2초 후 리셋.

- [ ] **Step 4: 전체 프레임 스캔 확인 — 우하단 + 작은 크기**

QR을 우측 하단에 배치하고 카메라에서 조금 멀리 떨어뜨려 화면상 크기가 프레임의 약 1/5이 되게 한다.
Expected: 인식 성공.

- [ ] **Step 5: 회귀 확인 — 쿨다운**

동일 QR을 연속으로 가져다 댄다.
Expected: 첫 인식 후 2초 동안은 추가 요청이 발생하지 않음 (네트워크 탭에서 `/api/checkin` POST가 2초당 1회 이하로 제한됨).

- [ ] **Step 6: 회귀 확인 — 중복 체크인**

같은 사용자 QR을 쿨다운 이후 다시 스캔한다.
Expected: 배경이 빨간색, "이미 Checkin 되었습니다" 메시지 표시.

- [ ] **Step 7: 회귀 확인 — 성공/실패 배경 색상**

- 정상 체크인 → 배경 녹색
- 잘못된/만료된 토큰(예: 3분 이상 지난 QR) → 배경 노란색, 에러 메시지

Expected: 모든 배경 전환이 기존과 동일.

- [ ] **Step 8: 모바일 크롬 실측 (가능한 경우)**

같은 내부망에서 모바일 크롬으로 `/check` 접속 (필요 시 `next dev --hostname 0.0.0.0` 또는 로컬 IP 사용).
Expected: 모바일에서도 프레임 모서리 QR 인식 성공, 프레임레이트 체감 저하 없음.

- [ ] **Step 9: 검증 결과 기록**

모든 체크박스가 통과하면 Task 3으로, 하나라도 실패하면 아래 "실패 시 대응"을 따른다.

**실패 시 대응:**
- 저사양 모바일에서 체감 느림 → `maxScansPerSecond: 15` → `10`으로 낮춘 후 재측정 후 커밋
- 스캔이 여전히 중앙만 되는 것처럼 보임 → `calculateScanRegion`이 실제로 반환되는지 `console.log`로 확인, `video.videoWidth/videoHeight`가 0이 아닌 값인지 검증 (start 이후 호출되므로 정상이어야 함)
- 타입 에러 `calculateScanRegion does not exist` → `node_modules/qr-scanner/qr-scanner.d.ts`에서 옵션 타입 확인 후 필요한 타입 캐스트 추가

---

## Task 3: 문서 업데이트 및 PR 준비

**Files:**
- Modify: `PROJECT_MAP.md` (필요 시)

- [ ] **Step 1: PROJECT_MAP 확인**

Run: `grep -n "QRScanner" PROJECT_MAP.md`
Expected: line 127 근처에 `QRScanner.tsx` 항목. 설명은 "qr-scanner 카메라 w/ 2s cooldown" — 기능 경계는 변하지 않았으므로 **업데이트 불필요**. 만약 기능 경계가 바뀌었다면 `project-map-keeper` 에이전트 실행.

- [ ] **Step 2: 최종 diff 리뷰**

Run: `git diff main...HEAD -- src/components/QRScanner.tsx`
Expected: Task 1의 변경만 포함, 부수적 포맷 변화 없음.

- [ ] **Step 3: 브랜치 푸시 및 사용자에게 결과 보고**

변경이 메인 브랜치에서 직접 이루어진 경우에는 푸시 명시적 승인을 받은 후에만 진행. (CLAUDE.md의 user-authorization 규칙)

Expected: 사용자가 merge/PR 방식을 지시할 때까지 대기.

---

## Self-Review 결과

- **스펙 커버리지:**
  - 스캔 영역 → Task 1 Step 2 (`calculateScanRegion`) ✓
  - `highlightScanRegion: false` → Task 1 Step 2 ✓
  - CSS 가이드 오버레이 → Task 1 Step 2 (JSX) ✓
  - `maxScansPerSecond: 15` → Task 1 Step 2 ✓
  - 유지 항목(쿨다운, 비프, outline) → Task 1 코드에 모두 존재 ✓
  - 수동 테스트 체크리스트 (모서리, 작은 QR, 가이드 밖, 회귀) → Task 2 ✓
  - 롤백 경로 → Task 2 Step 9 실패 대응 + 단일 파일이므로 git revert로 즉시 가능 ✓

- **Placeholder 스캔:** TBD/TODO/"적절히 처리" 없음. 모든 코드 블록 완전.

- **타입 일관성:** `QrScanner` 생성자 옵션, `HTMLVideoElement`, `onScan` 시그니처 모두 일관.
