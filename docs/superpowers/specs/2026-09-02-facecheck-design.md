# 안면인식 체크인 (facecheck) 설계 스펙

- 작성일: 2026-09-02
- 브랜치: `feat/facecheck`
- 상태: 사용자 설계 승인 완료 (구현 계획 수립 전)

## 1. 목표

QR 코드 체크인을 보완하는 안면인식 체크인을 추가한다. 사용자(학생·교사)가 얼굴을
등록하면, 식당 입구 태블릿의 인식 페이지에서 카메라만으로 본인을 식별(1:N)하여
체크인한다. QR 체크인은 기존 그대로 유지되며, 안면인식은 등록자에 한해 동작하는
추가 수단이다.

## 2. 확정된 결정사항

| 항목 | 결정 |
|------|------|
| 인증 방식 | 1:N 자동 식별 (카메라 앞에 서면 등록 얼굴 전체에서 식별). QR은 폴백 유지 |
| 대상 | 학생·교사 모두. 학생=즉시 체크인, 교사=근무/개인/취소 선택 |
| 등록 | 본인 셀프 등록 (`/student`·`/teacher` 개인정보 탭) |
| 동의 | 앱 내 본인 동의만 (만 14세 이상 본인 동의). 동의 일시·동의문 버전 DB 기록 |
| 저장 | 임베딩(수치 벡터)만 저장. 원본 얼굴 사진은 서버 전송·저장하지 않음 |
| 페이지 | 별도 `/facecheck` 공개 페이지 신설. 기존 `/check`(712줄)는 무변경 |
| 연산 위치 | 브라우저(태블릿·폰)에서 추론, 서버는 코사인 매칭만 (ML 런타임 서버 불필요) |
| 라이브러리 | `@vladmandic/human` 버전 고정, 모델 파일 self-host (`public/models/`) |
| 태블릿 | 중저가 Android 기준 보수적 설계 (경량 모델, 프레임 스로틀) |

## 3. 범위

### 포함
- 얼굴 등록/재등록/삭제 (동의 절차 포함) — 학생·교사 공용 컴포넌트
- `/facecheck` 인식 페이지 (태블릿용, 공개)
- 서버 1:N 매칭 + 기존 체크인 로직 재사용 (`source: FACE`)
- 교사 인식 시 근무/개인/취소 선택 UI (10초 미선택 시 자동 "개인")

### 제외 (1단계)
- 오프라인(로컬) 모드에서의 안면인식 — 매칭이 서버에서 일어나므로 온라인 전용.
  오프라인 운영 시에는 기존 `/check` 사용
- `/check` 페이지와의 통합 (안정화 후 별도 검토)
- 관리자용 등록 현황 화면 (필요해지면 추가)

## 4. 기술 선정

### 채택: @vladmandic/human (MIT)

- 검출(BlazeFace) → 정렬(FaceMesh) → 1024차원 임베딩(FaceRes) → 1:N 매칭까지
  단일 API로 제공하는 완제품 파이프라인
- 안티스푸핑(antispoof + liveness) 내장 — 조사한 오픈소스 중 유일. "1차 체크"
  강도이므로 감독자(배식 교직원)가 근처에 있는 급식 환경 전제
- 전 연산이 브라우저 실행 → Railway 단일 Node 컨테이너에 ML 의존성 없음
- 얼굴 파이프라인 모델 합계 약 10MB, WebGL로 중저가 태블릿에서 실시간 가능
- 리스크: 릴리스 둔화(연 1회 수준) + TensorFlow.js 유지보수 모드
  → 버전 고정(pin)으로 대응. 기능이 완결된 안정 라이브러리

### 기각 사유
- **onnxruntime-web + InsightFace(SCRFD+ArcFace)**: 정확도 최상이나 사전학습
  모델이 "non-commercial **research** purposes only" — 학교 운영 사용은
  비상업이지만 '연구'가 아니어서 라이선스 범위 밖. 정렬·NMS 직접 구현 공수도
  1~2주. (Human에 문제가 생길 경우의 차선책으로만 유지)
- **face-api.js**: 2020년 이후 유지보수 중단
- **MediaPipe**: 인식용 임베딩 미지원 (검출·랜드마크 전용)
- **CompreFace / DeepFace**: 별도 Python/Docker 컨테이너 필요 — 단일 컨테이너
  운영 조건 위배

### 모델 배포
- `@vladmandic/human-models`에서 얼굴 파이프라인에 필요한 모델만
  `public/models/`에 복사해 커밋 (버전 고정, 외부 CDN 미사용)
- `modelBasePath: "/models/"`, face 모듈만 활성화 (body/hand/emotion/gesture off)
- Human은 dynamic import로 클라이언트 전용 로드 (qr-scanner와 동일 패턴)

## 5. 아키텍처

```
[등록 — 본인 기기]                      [인식 — 태블릿 /facecheck]
브라우저: Human 로드                     브라우저: Human 로드
  → 동의 → 촬영 3~5장                     → 프레임 검출(300ms 스로틀)
  → 임베딩 추출                            → 안티스푸핑 통과 → 임베딩 추출
  → POST /api/users/me/face               → POST /api/facecheck {embedding}
     {embeddings, consentVersion}              ↓
        ↓                                서버: 인메모리 캐시(60s TTL)의
서버: FaceProfile upsert                   전체 임베딩과 코사인 1:N 매칭
                                           → 임계값+마진 통과 시
                                             기존 체크인 로직 실행 (source: FACE)
```

- 얼굴 이미지는 어떤 단계에서도 서버로 전송되지 않는다 (임베딩만).
- 서버 매칭 비용: 700명 × 5개 × 1024차원 Float32 ≈ 14MB 캐시, 매칭 수 ms.
  pgvector 불필요.

## 6. DB 스키마 (additive만)

```prisma
model FaceProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  embeddings     Json     // number[][] — 3~5개 임베딩, 각 1024차원
  modelVersion   String   // 예: "human@3.3.6" — 모델 교체 시 재등록 판별
  consentAt      DateTime
  consentVersion String   // 예: "2026-09-v1"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- `CheckInSource` enum에 `FACE` 추가 (PostgreSQL enum 값 추가 = additive, 안전)
- 별도 테이블인 이유: 생체정보 격리 — 철회·졸업 처리 시 row 하나 삭제로 완결,
  User 모델 비대화 방지. User 삭제 시 cascade로 함께 삭제
- 교사 관련 스키마 조정 불필요: `FaceProfile`은 role 무관, `CheckIn.type`이
  이미 WORK/PERSONAL 지원, unique 제약도 type 무관

## 7. API 설계

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/users/me/face` | GET | 학생/교사 | 등록 여부·등록일·modelVersion 조회 |
| `/api/users/me/face` | POST | 학생/교사 | 등록/재등록 — `{embeddings, consentVersion}` upsert |
| `/api/users/me/face` | DELETE | 학생/교사 | 즉시 삭제 (동의 철회) |
| `/api/facecheck` | POST | 공개 | 1:N 매칭 → 체크인 (아래 2단계 흐름) |

### `/api/facecheck` 2단계 무상태 흐름

1. `{embedding}` 수신 → 매칭
   - 매칭 실패(임계값/마진 미달) → `{matched: false}` (체크인 없음)
   - **학생** 매칭 → 즉시 체크인(type=STUDENT) → 기존 `/api/checkin`과 동일한
     응답 형태 (success/duplicate/자격 오류 + user, mealKind, checkedAt)
   - **교사** 매칭 → 중복 먼저 확인: 이미 체크인이면 중복 응답(선택 UI 생략),
     아니면 체크인하지 않고 `{needType: true, user, mealKind}` 반환
2. 교사 선택 후 `{embedding, type: "WORK" | "PERSONAL"}` 재호출
   - 서버가 동일 임베딩을 재매칭해 본인 확인 후 해당 type으로 체크인
   - 공개 엔드포인트에서 `{userId, type}`를 받으면 위조 가능하므로 임베딩
     재전송 방식 채택 (클라이언트가 1단계 임베딩을 메모리에 보관·재사용).
     토큰 인프라 없이 무상태로 해결, 재매칭 비용 수 ms

### 체크인 로직 재사용
- `resolveMealKind`(현재 식사 시간) / `isStudentEligibleToday`(학생 자격) /
  unique 제약 중복 방지 / 에러 메시지를 기존 `/api/checkin`과 동일하게 사용
- `CheckIn.source = "FACE"` 로 기록
- 입력 검증: zod — embedding 차원(1024)·개수(등록 3~5개) 검증

### 임베딩 캐시
- FaceProfile 전체를 Float32Array로 인메모리 캐시, TTL 60초
  (`settings-cache` 패턴). 신규 등록은 최대 60초 후 인식에 반영

## 8. 매칭 정책

- 사용자별 유사도 = 그 사용자의 임베딩들 중 최대 코사인 유사도
- 체크인 조건: `top1 ≥ threshold` **AND** `(top1 − top2) ≥ margin`
  (등록자가 1명뿐이면 마진 조건 생략)
- 초기값(코드 기본): threshold 0.55, margin 0.05 — 시범 운영으로 튜닝
- `SystemSetting`에 `face_match_threshold`, `face_match_margin` 키로 운영 중
  조정 가능 (30초 캐시 기존 패턴)
- 오인식 방어: 결과 화면에 이름+프로필 사진을 2초 표시해 현장에서 즉시 발견
  가능하게 함 (기존 QR 결과 UI와 동일)

## 9. 등록 UI — `FaceEnroll` 컴포넌트

`/student` 개인정보 탭과 `/teacher` 개인정보 탭 양쪽에 연결 (공용).

1. **미등록**: [얼굴 등록하기] 버튼
2. **동의 모달**: 동의문 전문 표시 → 체크박스 → [동의하고 계속]
3. **촬영**: 전면 카메라. 얼굴 1개 검출 + 크기 충분 + 안티스푸핑 통과 시
   자동으로 3~5장 캡처(각도 다양화 안내) → 임베딩 추출 → 서버 전송
4. **등록됨**: 등록일 표시 + [재등록] [삭제] 버튼. 삭제는 확인 후 즉시 반영

### 동의문 (`src/lib/face-consent.ts`)
- 수집 항목: 얼굴 특징정보(수치화된 임베딩). 원본 사진은 저장하지 않음
- 목적: 급식 체크인 시 본인 확인
- 보관 기간: 졸업·전출 또는 본인 삭제 요청 시까지
- 철회: 개인정보 탭에서 언제든 즉시 삭제 가능
- `FACE_CONSENT_VERSION = "2026-09-v1"` 상수로 버전 관리, DB에 버전 기록
- 학교 개인정보처리방침 문서 반영은 별도 행정 절차 (앱 범위 밖)

## 10. 인식 페이지 — `/facecheck`

- 공개 페이지, 태블릿 가로 좌우 분할 레이아웃·결과 표시(이름/사진/식사)·
  사운드 피드백(승인/중복/오류)은 기존 `/check` 패턴을 따름
- 프레임 처리 300ms 간격 스로틀 (중저가 태블릿 배려)
- 흐름: 얼굴 검출 → 안티스푸핑/라이브니스 통과 → 임베딩 안정화 →
  `POST /api/facecheck` → 결과 2초 표시 → 초기화 (2초 쿨다운)

### 학생
- 매칭 즉시 체크인·결과 표시 (대상자만 식당에 오므로 확인 단계 없음)

### 교사
- 매칭 시 스캔 일시 정지 → 교사 이름·사진과 함께 **[근무] [개인] [취소]**
  3버튼 표시 (터치 타겟 44px 이상, `whitespace-nowrap`)
- [근무]/[개인] → 해당 type으로 2단계 호출 → 결과 표시
- [취소] → 체크인 없이 즉시 초기화 (서버 호출 없음)
- **10초 미선택 시 자동으로 "개인"(PERSONAL) 체크인** — 남은 시간
  카운트다운을 [개인] 버튼에 표시
- 이미 체크인한 교사는 1단계에서 중복 응답 → 선택 UI 없이 중복 안내

### QR 폴백
- 하단 [QR로 체크인] 버튼 → 기존 `QRScanner` 컴포넌트로 전환 (동시 구동
  아님, 전환식). 미등록자·인식 실패·모델 로드 실패 기기 대응
- 얼굴 모드로 복귀 버튼 제공

## 11. 에러 처리

| 상황 | 처리 |
|------|------|
| 얼굴 없음 / 여러 명 | 클라이언트 안내 문구, 서버 호출 없음 |
| 스푸핑 의심 (antispoof/liveness 미달) | "실제 얼굴로 인식해 주세요" 안내 |
| 매칭 실패·모호 | "인식되지 않았습니다. 다시 서 주세요 (또는 QR 이용)" |
| 식사 시간 아님 / 자격 없음 / 중복 | 기존 `/api/checkin` 메시지 그대로 |
| 모델 로드 실패 (저사양·미지원) | 안내 + QR 모드 전환 유도 |
| 카메라 권한 거부 | 안내 문구 (기존 /check 패턴) |

## 12. 테스트 / 검증

- Vitest 단위 테스트 (`src/lib/__tests__/`, 기존 메모리 mock 패턴):
  - `face-match.ts`: 코사인 유사도, 임계값·마진 판정, 다중 임베딩 최대값,
    등록자 1명 마진 생략
  - facecheck 라우트: zod 검증, 학생/교사 분기, needType, 중복, type 재호출
- 로컬 게이트: `npm run build` + `npm test`
- 실기기 수동 검증: 학생 폰(등록), 태블릿(인식) — 시범 인원으로 임계값 튜닝
- main 머지 전 `prisma-migration-guardian` 검수 (additive 확인)

## 13. 구현 파일 목록

| 파일 | 작업 |
|------|------|
| `prisma/schema.prisma` | FaceProfile 모델 + CheckInSource.FACE (마이그레이션 2건 또는 1건) |
| `public/models/*` | Human 얼굴 파이프라인 모델 (버전 고정 커밋, 약 10MB) |
| `src/lib/human-client.ts` | Human 로더·설정 (dynamic import, face 전용 config) — 등록/인식 공용 |
| `src/lib/face-match.ts` | 코사인 유사도·1:N 매칭 판정 (서버) |
| `src/lib/face-embedding-cache.ts` | FaceProfile 인메모리 캐시 (60s TTL) |
| `src/lib/face-consent.ts` | 동의문 전문 + `FACE_CONSENT_VERSION` |
| `src/app/api/users/me/face/route.ts` | GET/POST/DELETE |
| `src/app/api/facecheck/route.ts` | POST (2단계 매칭·체크인) |
| `src/app/facecheck/page.tsx` | 인식 페이지 |
| `src/components/FaceEnroll.tsx` | 등록 컴포넌트 (동의 모달 포함) |
| `src/app/student/page.tsx` | 개인정보 탭에 FaceEnroll 연결 |
| `src/app/teacher/page.tsx` | 개인정보 탭에 FaceEnroll 연결 |

- `middleware.ts` 변경 불필요 (`/facecheck`는 보호 경로 아님)
- `/check`, `/api/checkin` 변경 없음
