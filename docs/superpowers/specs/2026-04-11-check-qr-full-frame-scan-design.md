# /check QR 전체 프레임 스캔 개선 설계

**작성일:** 2026-04-11
**대상 경로:** `/check` (식당 태블릿 체크인 페이지)
**변경 파일:** `src/components/QRScanner.tsx` (단일 파일)

## 1. 배경 및 문제

현재 `/check` 페이지의 QR 스캐너는 화면 중앙의 고정된 영역(비디오의 중앙 2/3 정사각형)에 QR 코드가 정확히 위치해야만 인식된다. 모바일 네이티브 QR 스캐너나 일반 앱처럼 "카메라 화면 어디에 QR을 비추든 즉시 인식"되는 동작이 요구된다.

### 원인

`src/components/QRScanner.tsx:24-57`에서 nimiq `qr-scanner` 라이브러리를 기본 설정으로 사용 중이다. 이 라이브러리는 성능 최적화를 위해 기본적으로 비디오 중앙 `min(width, height) * 2/3` 크기의 정사각형만 스캔한다. `highlightScanRegion: true` 옵션이 이 스캔 영역을 시각화하여, 사용자에게 "이 박스 안에 맞춰야 한다"는 인상을 준다.

## 2. 목표

- 카메라 프레임의 **어느 위치에 QR이 있어도** 즉시 인식
- 참고용 가이드 프레임은 시각적으로 유지 (사용자의 기존 습관 보존, 부드러운 전환)
- 가이드 프레임은 **시각적 힌트일 뿐** 실제 스캔 영역을 제한하지 않음
- AI API 등 외부 의존 도입 없이 클라이언트 사이드에서 해결

## 3. 비목표

- 라이브러리 교체 (최근 커밋 `73eef43`에서 `jsQR → qr-scanner`로 교체한 성능 개선 이력 유지)
- `/check` 이외 페이지의 QR 관련 동작 변경
- 체크인 API, JWT 검증, 쿨다운, 비프음 로직 변경

## 4. 설계

### 4.1 스캔 영역 전환

`QrScanner` 생성자 옵션에 `calculateScanRegion` 콜백을 추가하여 전체 비디오 프레임을 반환한다:

```ts
calculateScanRegion: (video: HTMLVideoElement) => ({
  x: 0,
  y: 0,
  width: video.videoWidth,
  height: video.videoHeight,
})
```

`highlightScanRegion`은 `false`로 변경한다 (라이브러리 내장 박스 제거). `highlightCodeOutline: true`는 **유지**하여, QR이 실제로 인식된 순간 그 테두리만 하이라이트된다 (사용자 선호 방식 B의 핵심 피드백).

### 4.2 참고용 가이드 프레임 (CSS 오버레이)

`QRScanner` 컴포넌트의 JSX에 비디오 위로 `position: absolute`된 반투명 보더 박스를 오버레이한다. 이 박스는 `pointer-events: none`으로 설정하여 터치/클릭을 가로채지 않는다. 디코딩에는 영향을 주지 않는, 순수 시각적 힌트다.

- 크기: 비디오 영역의 약 70% (기존 스캔 영역과 비슷한 크기 유지)
- 스타일: 얇은 흰색 테두리 + 모서리 강조 (네이티브 카메라 앱 스타일)
- 중앙 정렬

### 4.3 성능 튜닝

전체 프레임 스캔은 중앙 ROI 대비 디코딩 비용이 약 2~2.5배 증가한다. 현재 `maxScansPerSecond: 25`는 대부분 모바일 기기에서 과한 설정이므로 **15**로 낮춰 전반적인 CPU 부하를 기존과 유사한 수준으로 유지한다.

nimiq `qr-scanner`는 내부적으로 WebWorker + WebAssembly에서 디코딩하므로 메인 스레드 블로킹은 발생하지 않는다.

### 4.4 유지되는 동작

- 2초 쿨다운 (`cooldownRef`) — 중복 체크인 방지
- 성공 시 비프음 (1200Hz, 0.1s)
- `preferredCamera: "environment"` — 후면 카메라 우선
- `returnDetailedScanResult: true`
- 결과 콜백 시그니처 `(data: string) => void`

## 5. 변경 요약

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 스캔 영역 | 중앙 2/3 정사각형 | 전체 비디오 프레임 |
| `highlightScanRegion` | `true` | `false` |
| `highlightCodeOutline` | `true` | `true` (유지) |
| `maxScansPerSecond` | `25` | `15` |
| 가이드 프레임 | 라이브러리 내장 박스 | CSS 오버레이 (시각적 힌트) |

## 6. 테스트 계획

UI/카메라 동작 변경이므로 자동화가 어렵다. 수동 체크리스트:

- [ ] 모바일 크롬에서 화면 **모서리**에 QR을 비춰도 즉시 인식되는지
- [ ] 비디오 영역의 **약 1/5 크기**인 작은 QR이 중앙이 아닌 위치에서 인식되는지
- [ ] CSS 가이드 프레임이 시각적으로는 보이지만, **박스 밖** QR도 인식되는지
- [ ] 인식된 QR 주변에 `qr-scanner` 기본 outline이 정상 표시되는지
- [ ] 회귀 확인: 2초 쿨다운 작동, 비프음 재생, 중복 체크인 거부, 성공 시 배경색 전환
- [ ] 데스크톱 크롬에서 기본 동작 정상

## 7. 리스크 및 롤백

- **리스크:** 저사양 기기에서 전체 프레임 스캔이 느려질 가능성 → `maxScansPerSecond: 15`로 완화. 실측 후 필요 시 10까지 낮출 수 있음.
- **리스크:** 일부 사용자가 기존 중앙 정렬 습관에 혼란 → CSS 가이드 프레임으로 완화.
- **롤백:** 단일 파일(`src/components/QRScanner.tsx`) 변경이므로 해당 파일을 이전 버전으로 되돌리면 즉시 원복 가능.
