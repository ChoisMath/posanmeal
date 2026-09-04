# 안면인식 체크인 2단계 — 고성능 기기 대응·로컬 모드·결과 색상/사운드 설계

작성일: 2026-09-05. 1단계 설계(`2026-09-02-facecheck-design.md`)를 전제로 한다.

## 1. 배경과 목표

1단계는 중저가 Android 태블릿 기준으로 보수적으로 설계했다(WebGL 고정, 프레임당 300ms 스로틀).
그 결과 기기 부담은 적지만 인식 속도·반응이 느리다. 노트북/맥북/플래그십 태블릿을
키오스크로 쓸 때 성능을 끌어올리되, **임베딩 모델(FaceRes 1024차원)과 그 입력 단계는
바꾸지 않아** 기존 등록(`FaceProfile`)이 그대로 유효해야 한다.

추가 목표 두 가지:
- 운영 모드가 `local`일 때도 `/facecheck`가 동작하도록 한다(매칭·검증·저장을 브라우저에서).
- 체크인 결과를 4색(정상 초록 / 중복 파랑 / 미신청 빨강 / 기타 오류 주황)과 4가지 사운드로
  구분한다. `/facecheck`와 `/check` 모두 적용.

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 연산 위치 | 변경 없음 — 추론은 브라우저, 서버는 매칭만(온라인). 로컬 모드는 매칭도 브라우저 |
| 모델 | 변경 없음. detector/mesh/rotation/equalization/`cacheSensitivity:0` 유지(등록·인식 일관성) |
| 백엔드 | `/facecheck`: `webgpu` 우선 → 실패 시 `webgl`. `FaceEnroll`(등록)은 `webgl` 유지 |
| 페이싱 | 고정 300ms 제거. 직전 검출 시간의 1/3(30~200ms 클램프)만 양보 |
| 결과 표시 중 스캔 | 결과 카드 2초 표시는 유지하되 스캔은 즉시 재개(같은 사람은 10초 억제 맵이 차단) |
| 성능 표시 | 상태바에 `백엔드 · 검출ms` 표시 |
| 로컬 모드 임베딩 보관 | 서버 모드가 `local`일 때 동기화로 다운로드, `online` 확인 시 기기에서 삭제 |
| 로컬 동기화 인증 | 기존과 동일하게 관리자 로그인(ADMIN) 필요 — `/api/sync/*` 권한 유지 |
| 색상·사운드 범위 | `/facecheck` + `/check`. `/check`의 인라인 사운드 복사본은 공용 유틸로 교체 |

## 3. 성능 (고성능 기기 대응)

### 3.1 백엔드 선택 — `src/lib/human-client.ts`

- `type FaceBackend = "webgpu" | "webgl"`.
- 순수 함수 `resolveFaceBackends(override: string | null, hasWebGpu: boolean): FaceBackend[]`
  - `override === "webgl"` → `["webgl"]`
  - `override === "webgpu"` → `["webgpu", "webgl"]`
  - 그 외 → `hasWebGpu ? ["webgpu", "webgl"] : ["webgl"]`
- `loadHuman(candidates?: FaceBackend[])`: 후보를 순서대로 시도. 각 후보는 새 `Human`
  인스턴스로 `load()` → 필수 모델 검증 → `warmup()`까지 성공해야 채택. 실패하면 다음 후보.
  기본 후보는 `["webgl"]`(등록 화면 호환). 싱글턴은 "채택된 백엔드"와 함께 보관하며,
  다른 후보 목록으로 다시 호출되면 재생성한다.
- `getActiveFaceBackend(): FaceBackend | null` — 상태바 표시용.
- Human은 `webgpu` 지정 시 `navigator.gpu`가 없거나 어댑터가 없으면 스스로 `webgl`로 내린다.
  우리 폴백은 그 위에서 초기화·warmup 예외까지 잡는 2중 안전장치다.
- `warmup`은 `"face"`로 지정해 얼굴 파이프라인만 예열한다(로드 시간 단축).

### 3.2 페이싱 — `src/lib/face-pacing.ts`

- `nextDetectDelay(lastDetectMs: number): number = clamp(lastDetectMs / 3, 30, 200)`.
- 빠른 기기(검출 40ms)는 30ms 양보 → 초당 약 14회. 느린 기기(900ms)는 200ms 양보 →
  지금(300ms 고정)보다 나빠지지 않는다.

### 3.3 `/facecheck` 루프 변경

- 루프: `sleep(nextDetectDelay(lastMs))` → `performance.now()`로 `detectFaces` 소요 측정 →
  상태바에 `webgpu · 42ms` 갱신(200ms마다 한 번만 setState).
- 결과 처리(옵션 A): `applyResult`는 결과 표시·사운드·억제 맵 등록 후 **즉시 `resumeScan()`**.
  결과 카드는 `RESULT_DISPLAY_MS` 후 지우되, 그 사이 새 결과가 들어오면 이전 타이머가 새 결과를
  지우지 않도록 결과 세대 카운터로 보호한다. 교사 선택 대기(`pending`)는 지금처럼 스캔 정지.
- 오류 강등: 루프 실패 `MAX_LOOP_FAILURES` 도달 시 활성 백엔드가 `webgpu`면
  `loadHuman(["webgl"])`로 1회 재시도 후 실패 카운터 초기화. 이미 `webgl`이면 QR 모드 전환(기존).
- 운영자 고정: `/facecheck?backend=webgl|webgpu` → localStorage `facecheck.backend` 저장
  (키오스크 키와 같은 패턴, 주소창에서 제거). 값이 없으면 자동.

### 3.4 문구 정정 — `/api/facecheck`

- 미신청 학생 응답 `error`: `"식사 신청 기간이 아닙니다."` → `` `오늘 ${MEAL_LABEL[mealKind]} 신청자가 아닙니다.` ``

## 4. 결과 색상·사운드 — `src/lib/checkin-result-style.ts`, `src/lib/checkin-sounds.ts`

### 4.1 분류(순수 함수)

`resultCategory(r): "success" | "duplicate" | "notApplicant" | "error"`
- `success` → 초록(`bg-emerald-500`), `duplicate` → 파랑(`bg-blue-500`),
  `notApplicant` → 빨강(`bg-red-500`), 그 외 → 주황(`bg-orange-500`).
- 카드 문구 색도 같은 계열(`text-emerald-700/300`, `text-blue-700/300`, `text-red-700/300`,
  `text-orange-800/200`).
- 우선순위: `success` > `duplicate` > `notApplicant` > `error` (서버 응답은 상호 배타적이라
  실제로는 겹치지 않는다).

### 4.2 사운드(공용 유틸, 두 페이지 공통)

| 함수 | 상황 | 소리 |
|------|------|------|
| `playSuccess` | 정상 체크인 | 상승 2음(A5 880→D6 1175Hz), 삼각파, 약 0.4s |
| `playDuplicate` | 이미 체크인 | 하강 2음(C6 1047→G5 784Hz), 사각파(다른 음색), 약 0.45s |
| `playDenied` | 미신청 | 저음 버저(톱니파 200Hz + 150Hz 겹침) 0.7s |
| `playError` | 기타 오류(잘못된 QR, 서버 오류 등) | 고음 3연타(G6 1568Hz × 3, 간격 0.14s) |
| `playLockClick` | `/check` 처리 중 재스캔 무시 | 기존 유지(공용 유틸로 이동) |

- 게인 0.9~1.0 + 짧은 어택/릴리즈 램프(클릭 잡음 방지). 실제 음량은 기기 볼륨이 상한이므로
  키오스크에 외장 스피커 연결을 권장한다.
- 기존 `playChime/playLongBeep/playDoubleBeep`는 제거하고 위 이름으로 교체.
  `/check`의 인라인 복사본도 제거하고 공용 유틸 import. `/check`의 다른 로직은 무변경.
- 얼굴 미매칭(지나가는 사람)은 지금처럼 전체 화면 결과·소리 없이 상태 문구만.

## 5. 로컬 모드 — `/facecheck`

### 5.1 데이터 흐름

```
[온라인 동기화 — 관리자 로그인 상태의 키오스크 브라우저]
  POST /api/sync/upload      ← IDB checkins(synced=0)          (기존)
  GET  /api/sync/download?faces=1
        → users, eligibleEntries, mealWindows, operationMode, qrGeneration  (기존)
        → faceProfiles[{userId, embeddings[][]}], faceMatch{threshold,margin} (신규, faces=1일 때만)
  IDB: users / eligibleEntries / faceProfiles(신규) / settings(faceMatch, lastSyncAt …)

[로컬 인식]
  카메라 → Human(브라우저) → 임베딩
       → findBestMatch(임베딩, IDB faceProfiles, faceMatch)   ← src/lib/face-match.ts 재사용
       → IDB users 조회 → mealKind(resolveMealKindLocal) → 중복(getCheckIn) → 학생 자격(isEligible)
       → 교사면 근무/개인/취소 선택(10초 자동 개인) → addCheckIn(synced=0)
```

### 5.2 서버 — `GET /api/sync/download`

- 쿼리 `faces=1`일 때만 `faceProfiles`와 `faceMatch`를 포함(기존 `/check` 페이로드 불변).
- `faceProfiles`는 `prisma.faceProfile.findMany({ select: { userId, embeddings } })` 그대로
  (숫자 배열 JSON). 수백 명 기준 수십 MB — 노트북·Wi-Fi 1회 동기화 수준으로 허용.
- 권한: 기존과 동일 `canWriteAdmin`.

### 5.3 IndexedDB — `src/lib/local-db.ts`

- `DB_VERSION` 4 → 5. 새 스토어 `faceProfiles`(keyPath `userId`), 레코드
  `{ userId, embeddings: number[][] }`.
- 함수: `replaceAllFaceProfiles(profiles)`, `getAllFaceProfiles()`, `clearFaceProfiles()`.
  `clearAllData()`에 `faceProfiles` 포함.
- 설정 키: `faceMatch`(JSON), 기존 `operationMode`/`mealWindows`/`qrGeneration`/`lastSyncAt` 재사용.

### 5.4 로컬 판정 엔진 — `src/lib/facecheck-local.ts` (순수, 저장소 주입)

```ts
interface LocalFaceRepo {
  getUser(id): Promise<LocalUser | undefined>;
  getCheckIn(userId, date, mealKind): Promise<LocalCheckIn | undefined>;
  isEligible(userId, date, mealKind): Promise<boolean>;
  addCheckIn(checkin): Promise<void>;
}
runLocalFaceCheckIn(input: { embedding, candidates, faceMatch, now, mealWindows, type? }, repo)
  : Promise<FaceCheckResult>   // /api/facecheck와 같은 응답 모양
```

판정 순서는 서버 라우트와 동일: 식사 시간 없음(`NO_MEAL_WINDOW`) → 미매칭(`matched:false`)
→ 사용자 없음 → 중복(`duplicate`) → 교사 `type` 없음(`needType`) → 학생 미신청(`notApplicant`,
문구 `오늘 {식사} 신청자가 아닙니다.`) → 저장 후 `success`. `photoUrl`은 오프라인에 없으므로
생략(이니셜 아바타 표시).

### 5.5 페이지 통합

- 모드 판단: 마운트 시 `GET /api/system/settings`(공개) → `operationMode`, `mealWindows`,
  `faceMatch`를 IDB `settings`에 저장. 실패(오프라인) 시 IDB 저장값 사용. `/check`와 동일.
- `submitEmbedding`/`submitTeacherType`: `operationMode === "local"`이면 `fetch` 대신
  `runLocalFaceCheckIn` 호출. 결과 처리(`applyResult`, 억제 맵, 사운드, 색상)는 공용.
- 후보 임베딩은 모드 진입·동기화 직후 IDB에서 한 번 읽어 `Float32Array[]`로 메모리에 보관.
- 동기화(`src/lib/kiosk-sync.ts`): `performKioskSync()` = 업로드 → 다운로드(`faces=1`) → IDB 갱신.
  서버 `operationMode`가 `online`이면 `clearFaceProfiles()`(보관 정책). 트리거: 로컬 모드로
  마운트 시, `online` 이벤트, 수동 [동기화] 버튼. 업로드 403이면 "관리자 로그인이 필요합니다" 안내.
- UI: 상태바 좌측에 온라인/오프라인 + `로컬 모드` 배지 + `미전송 N건`. 하단 바(기존 모드 전환
  버튼 자리)에 `마지막 동기화 · [동기화]`를 로컬 모드일 때 함께 표시.
- 로컬 모드의 QR 폴백: `/facecheck`의 QR 모드는 온라인 JWT QR 전용이므로, 로컬 모드에서는
  [QR로 체크인] 버튼이 `/check`(로컬 QR 지원)로 이동한다.
- 로컬 저장 체크인의 `source`는 업로드 시 기존대로 `LOCAL_SYNC`(얼굴/QR 구분 없음 — 필요 시 후속).

### 5.6 개인정보

- 로컬 모드에서는 등록자 전원의 임베딩이 키오스크 IndexedDB에 존재한다. 서버 모드가 `online`으로
  확인되는 즉시 삭제하고, `/check`의 [초기화](`clearAllData`)로도 삭제된다.
- 동의문(`FACE_CONSENT_TEXT`)은 이번에 바꾸지 않는다(버전 상승 시 전원 재동의 필요). 학교
  개인정보처리방침에 "로컬 운영 시 학교 관리 기기 내 임시 보관" 문구 반영은 행정 절차로 별도 안내.

## 6. 테스트

- `face-backend.test.ts`: `resolveFaceBackends` 4가지 분기, `nextDetectDelay` 경계(30/200 클램프).
- `checkin-result-style.test.ts`: 분류·색상 매핑.
- `facecheck-local.test.ts`: 인메모리 repo로 순서(식사시간→미매칭→중복→needType→미신청→성공),
  교사 2단계, 저장 payload(`synced:0`, `type`).
- `sync-download.test.ts`: `faces=1`일 때만 `faceProfiles`/`faceMatch` 포함, 권한 403.
- `facecheck-route.test.ts`: 미신청 문구 갱신.
- 게이트: `npm run build` + `npm test`. 수동: 맥북(Chrome·Safari)·태블릿에서 상태바 백엔드/ms 확인,
  로컬 모드 전환 후 동기화→인식→업로드 왕복.

## 7. 파일 목록

| 파일 | 변경 |
|------|------|
| `src/lib/human-client.ts` | 백엔드 후보 로딩·폴백, `getActiveFaceBackend`, warmup face |
| `src/lib/face-pacing.ts` (신규) | `nextDetectDelay`, `resolveFaceBackends` |
| `src/lib/checkin-result-style.ts` (신규) | 결과 분류·색상 |
| `src/lib/checkin-sounds.ts` | 4종 사운드 + lockClick |
| `src/lib/local-db.ts` | v5 `faceProfiles` 스토어 |
| `src/lib/facecheck-local.ts` (신규) | 로컬 판정 엔진 |
| `src/lib/kiosk-sync.ts` (신규) | 동기화(업로드/다운로드/IDB 갱신) |
| `src/app/api/sync/download/route.ts` | `faces=1` 확장 |
| `src/app/api/facecheck/route.ts` | 미신청 문구 |
| `src/app/facecheck/page.tsx` | 페이싱·옵션 A·성능 표시·강등·로컬 모드·색상/사운드 |
| `src/app/check/page.tsx` | 색상 매핑·공용 사운드로 교체(그 외 무변경) |
| `CLAUDE.md`, `.claude/PROJECT_MAP.md` | 라우트·라이브러리 설명 갱신 |
