# Project Map — PosanMeal

> 학년도 명부 최신 구조: 2026-09-20, Task 5~14와 Task 15 회귀 보완. 운영 반영·실제 복원은 미실행이며 `docs/operations/academic-year-validation-report.md`와 실행안을 참조한다.

> 2026-09-18 `.claude/PROJECT_MAP.md`에서 이관. §11 배포 설명은 과거 기록이며 9월 테스트 서비스 기록과 충돌한다. 현재 연결은 배포 작업 시 확인하고 `.codex/rules/railway-stack.md`를 따른다.

> Last full regeneration: 2026-05-02 (revised 2026-06-11: 식사별(MealKind) 공고/신청 구조 대개편 — LUNCH 추가, Meal/MealDate 하위 테이블 4종)
>
> 마지막 업데이트: 2026-09-19 (학년도별 명부 Release A — 커밋 `1d9a15e..81a4a81`. 마이그레이션 `20260919000001_add_academic_year_roster`로 User 4컬럼·`MealApplication.academicYear`·새 모델 13개 추가, `src/lib/academic-year/`(행위자 재검증 `requireActor`/`assertActor`, 계정 API, 호환 쓰기 `withCompatUserWrite`, 초기 이전), JWT `sessionVersion`·매 요청 DB 재검증, `/api/admin/users/[id]/{email,access,permissions}`, `/api/users/me` PUT 삭제, 사용자 DELETE 409, 전용 통합 테스트 DB(`tests/integration/`, `scripts/academic-year/`). 설계 `docs/superpowers/specs/2026-09-19-academic-year-roster-design.md`, 계획 `docs/superpowers/plans/2026-09-19-academic-year-roster.md`)
>
> 이전 업데이트: 2026-09-19 (독립 `demo-video/` 제작 환경과 학생 안내 `StudentGuide` 16장면·46문장. 인트로·얼굴 인식 베타 소개·도움말 아웃트로, 자막·챕터·썸네일·스틸 제작 경로는 §14 참조. 앱 `/help`는 미구현)
>
> 이전 업데이트: 2026-09-19 (`/check`·`/facecheck` 공용 `KioskViewport` 추가: 실제 가시 높이와 화면 복귀·회전 대응, 확대 중 재배치 방지. `globals.css`의 `.kiosk-*`로 결과·하단 조작부를 축소하고 로컬 동기화 상세를 별도 행에 배치)
>
> 이전 업데이트: 2026-09-19 (`/facecheck` 학생·교사 확인 후 저장: geometry 품질 검사·동일 대상 연속 3회 매칭, 10초 무응답 취소. 온라인·로컬 `confirmation` 대상/날짜/식사 재검증. Human 로드·추론 전역 직렬화와 모드 전환 시 세션·요청 정리. 모델·임계값·사운드 유지)
>
> 이전 업데이트: 2026-09-18 (키오스크 `/check`·`/facecheck`를 `100dvh` 단일 화면으로 재구성: 중앙 `object-contain` 영상, 하단 1행 결과, 성공/중복/미신청/오류의 두꺼운 4색 테두리. `QRScanner`는 실제 스캔 윤곽을 외부 overlay에 렌더하고 React StrictMode에서 이전 스트림이 새 스트림을 끄지 않도록 시작을 지연. `FaceEnroll`은 전면 카메라를 미러링하고, 등록 전 얼굴 크기·프레임 경계·라디안 yaw/pitch/roll 자세를 검사하는 `face-quality.ts`를 적용. 기존 모델·DB·매칭·사운드 흐름은 유지)
>
> 이전 업데이트: 2026-09-06 (관리자 설정 탭 안면인식 임계값 카드 `face-match-validation.ts`; 미등록 얼굴 거부 카드·오류음 `unmatched-tracker.ts`, `/api/facecheck`·로컬 결과 `errorCode: UNMATCHED`; 기본 threshold 0.45→0.55: 부자 간 0.48 오인식 관측; 2026-09-05 안면인식 식별 모델 교체 — FaceRes(1024)→insightface-mobilenet-emore(256), `FACE_MODEL_VERSION` 상승·현재 버전 프로필만 후보, `rankCandidates/decideMatch/scoreSummary`, `/api/facecheck`·로컬 결과에 `similarity/runnerUp`, `/facecheck` 상태바 유사도 표시, `FaceEnroll` 재등록 안내)
>
> 이전 업데이트: 2026-09-05 (안면인식 2단계 — `/facecheck` WebGPU 우선 로딩·적응형 페이싱·성능 표시·결과 중 스캔 재개, 로컬 모드(브라우저 매칭 `facecheck-local.ts` + `kiosk-sync.ts` + IDB v5 `faceProfiles`, `GET /api/sync/download?faces=1`), `/check`·`/facecheck` 결과 4색(`checkin-result-style.ts`)·4사운드(`checkin-sounds.ts` 공용화). 설계 `docs/superpowers/specs/2026-09-05-facecheck-perf-local-design.md`)
>
> 이전 업데이트: 2026-09-02 (안면인식 체크인(facecheck) 1단계 구현 완료 — `@vladmandic/human` 클라이언트 로더(`human-client.ts`) + 모델 self-host(`public/models/`), 학생·교사 개인정보 탭 얼굴 등록 UI(`FaceEnroll`), 공개 페이지 `/facecheck`(교사 근무/개인/취소·10초 자동, QR 폴백), `src/proxy.ts` 공개 경로 등록, `next.config.ts` serverExternalPackages 대응)

## §1 개요

포산고등학교 학생/교사 급식(조식·중식·석식) 신청·QR 체크인 관리 웹앱.
- 학생/교사: Google OAuth 로그인, QR 체크인, 석식 신청·취소, 월별 이력 확인
- 관리자: 사용자 관리, 신청 공고 CRUD, 체크인 수동 토글, 엑셀 내보내기/일괄 가져오기
- 오프라인(로컬) 모드: IndexedDB + Service Worker, 온라인 복귀 시 서버 업로드

기술 스택: Next.js 16.2 (App Router) / TypeScript / React 19 / Tailwind CSS v4 / Prisma 7 + @prisma/adapter-pg + PostgreSQL / Auth.js v5 / Railway 배포

## §2 의존성 (주요 런타임)

| 패키지 | 버전 | 용도 |
|--------|------|------|
| next | 16.2.1 | 프레임워크 |
| next-auth | ^5.0.0-beta.30 | Auth.js v5 (Google OAuth + credentials) |
| @prisma/client + prisma | ^7.6.0 | ORM |
| @prisma/adapter-pg + pg | ^7.6.0 / ^8.20.0 | 커넥션 풀 어댑터 |
| qr-scanner | ^1.4.2 | nimiq QR 스캐너 |
| qrcode | ^1.5.4 | QR 이미지 생성 |
| exceljs | ^4.4.0 | 엑셀 내보내기/가져오기 |
| sharp | ^0.34.5 | 사진 WebP 변환 |
| sonner | ^2.0.7 | Toast (shadcn/ui 대체) |
| swr | ^2.4.1 | 클라이언트 데이터 페칭 |
| bcryptjs | ^3.0.3 | 관리자 패스워드 해시 |
| jsonwebtoken | ^9.0.3 | QR JWT 토큰 |
| @base-ui/react | ^1.3.0 | 헤드리스 UI 프리미티브 |
| @vladmandic/human | 3.3.6 (정확 고정) | 브라우저 얼굴 검출·임베딩·안티스푸핑/라이브니스 (facecheck) |
| @vladmandic/human-models | 3.0.4 (devDep, 정확 고정) | Human 모델 파일 원본 — `public/models/`로 복사해 self-host |
| vitest | ^4.1.5 | 단위 테스트 (devDep) |
| embedded-postgres | ^16.14.0-beta.17 (devDep) | 학년도 명부 통합 테스트용 실제 PostgreSQL — Docker가 없을 때의 폴백(`scripts/academic-year/pg-daemon.ts`) |

## §3 폴더 구조

```
src/
├── app/
│   ├── layout.tsx               # Root layout (SwUpdater, AuthProvider)
│   ├── page.tsx                 # 랜딩 (Google 로그인)
│   ├── check/page.tsx           # QR 키오스크 (공개) — KioskViewport 가시 높이·중앙 contain 영상·하단 1행 4색 결과, 모드 해석 kiosk-sync.ts·로컬 판정 qr-checkin-local.ts
│   ├── facecheck/page.tsx       # 얼굴 키오스크 (공개, 온라인·로컬) — KioskViewport 가시 높이·중앙 contain 영상·하단 1행 4색 결과 + 페이지 내 QR 모드
│   ├── student/page.tsx         # 학생 기본 4탭 (식단, QR, 개인정보, 확인), 공고가 있으면 신청 추가
│   ├── teacher/page.tsx         # 교사 탭 (담임: 6탭, 비담임: 4탭)
│   ├── admin/
│   │   ├── login/page.tsx       # 관리자 로그인
│   │   ├── page.tsx             # 관리자 대시보드
│   │   └── applications/        # 공고 작성/수정/통계 전용 페이지
│   │       ├── new/page.tsx
│   │       └── [id]/{edit,stats}/page.tsx
│   └── api/                     # Route Handlers (§5 참조)
├── components/                  # (§7 참조)
│   └── meal/                    # 식사별 공고·신청 UI (meal-ui.ts 테마 포함)
├── lib/                         # (§8 참조)
│   ├── academic-year/           # 학년도 명부 도메인: 행위자 재검증·계정 서비스·호환 쓰기·초기 이전 (§8)
│   ├── public-paths.ts          # proxy 공개 경로 판정 isPublicPath (§9)
│   └── session-recovery.ts      # 401 세션 만료 시 로그아웃·로그인 화면 이동 (§8)
├── providers/
│   └── AuthProvider.tsx
├── hooks/                       # SWR 훅 등
├── types/
├── auth.ts                      # Auth.js 설정
└── proxy.ts                     # 라우트 보호 (middleware.ts 아님, §9 참조)
prisma/
├── schema.prisma
└── migrations/
scripts/
└── academic-year/               # 통합 테스트 DB wrapper·초기 이전/검증 CLI (§8)
tests/
└── integration/                 # 실제 PG 통합 테스트 academic-*.test.ts (npm run test:academic, §12)
    ├── support/                 # db.ts, academic-fixture.ts, legacy-fixture.ts
    ├── sql/identity.sql         # academic_meta 스키마의 테스트 DB 식별 marker
    └── prisma.config.ts         # ACADEMIC_TEST_DATABASE_URL 전용 (dotenv 미사용)
compose.academic-year-test.yml   # postgres:16-alpine, 127.0.0.1:55439, tmpfs
vitest.integration.config.ts     # tests/integration/**/*.test.ts, fileParallelism 끔
public/
├── sw.js                        # Service Worker (posanmeal-v7) — /check·/facecheck 네트워크 우선(5s)→캐시→오프라인 HTML, /_next/static·/models 캐시 우선 (§12)
└── models/                      # @vladmandic/human 모델 self-host (blazeface/facemesh/antispoof/liveness + insightface-mobilenet-emore .json+.bin; faceres는 미사용 잔존. 출처·해시: public/models/README.md)
```

## §4 페이지 라우트

| 경로 | 파일 | 접근 | 설명 |
|------|------|------|------|
| `/` | `src/app/page.tsx` | 공개 | 랜딩, Google 로그인 버튼 |
| `/check` | `src/app/check/page.tsx` | 공개 | QR 키오스크 — 모드 해석은 `kiosk-sync.ts`의 `fetchKioskSettings`(5s 타임아웃; 실패 시 `loadSavedKioskSettings` IDB 폴백, 결정 전까지 "모드 확인 중"). `posanmeal:` QR이거나 로컬 모드면 `runLocalQrCheckIn`(IDB, `qr-checkin-local.ts`), 그 외 `/api/checkin` JWT(`postCheckInWithRetry`). `KioskViewport` 화면의 중앙에는 `object-contain` 영상과 실제 QR 윤곽 overlay를, 하단에는 한 줄 결과를 둔다. 결과는 성공/중복/미신청/오류별 두꺼운 초록/파랑/빨강/주황 테두리. 하단 왼쪽은 로컬 동기화 그룹, 오른쪽 [얼굴로 체크인]은 SW 오프라인 응답을 위한 의도적 전체 이동 `<a href="/facecheck">` |
| `/facecheck` | `src/app/facecheck/page.tsx` | 공개(키오스크 키 필요; 로컬 모드 동기화는 관리자 로그인) | 안면인식 키오스크 — `KioskViewport` 내 중앙 `object-contain` 영상과 하단 1행 4색 결과를 쓰며, 얼굴 크기·경계·자세 검사와 동일 사용자·날짜·식사의 연속 3회 유효 매칭(`face-stability.ts`) 후 확인창을 연다. 학생은 학번·이름 확인/취소, 교사는 근무/개인/취소를 선택하며 모두 10초 무응답 시 취소한다. 확인 전 매칭은 읽기 전용이고 명시적 확인 후에만 저장한다. 최초 `/facecheck?key=<키>`로 접속하면 localStorage에 저장되어 이후 자동 전송. 백엔드는 `resolveFaceBackends`로 webgpu→webgl 순차 시도(`?backend=webgl\|webgpu\|auto`로 고정, localStorage `facecheck.backend`), 검출 간격은 `nextDetectDelay`(직전 검출ms/3, 30~200ms), 상태바에 `백엔드 · 검출ms` 표시. 결과가 떠 있는 동안에도 스캔은 즉시 재개(같은 사람은 10초 억제 맵). 루프 반복 실패 시 webgpu→webgl 재시도 후 QR 모드. 운영 모드 `local`이면 `runLocalFaceCheckIn`으로 브라우저 매칭·확인 후 IDB 저장. 얼굴↔QR 전환·언마운트 시 세션 세대, busy, 확인 대기, 재개/결과 타이머를 정리하고 요청·감지 호출을 AbortSignal로 취소한다. **QR 모드는 온라인·로컬 모두 페이지 안에서 동작**(`/check`로 이동하지 않음): 하단 바 오른쪽 버튼이 [QR로 체크인]↔[얼굴로 체크인]을 전환하며 `giveUpFace`도 페이지 내 QR 모드로 전환. QR 모드에서 `posanmeal:` QR이거나 로컬 모드면 `runLocalQrCheckIn`, 그 외는 `/api/checkin` JWT(`postCheckInWithRetry`) |
| `/student` | `src/app/student/page.tsx` | 학생 | 기본 식단/QR/개인정보/확인 4탭, 신청 가능한 공고가 있으면 식단 다음에 신청 탭 추가. 기본 선택은 식단 |
| `/teacher` | `src/app/teacher/page.tsx` | 교사 | 담임 6탭(식단/QR/확인/학생관리/신청현황/개인정보) / 비담임 4탭. 개인정보 탭은 읽기 전용(이름·교과·담임·직책 본인 수정 폼 제거 — 명부 소유) |
| `/admin/login` | `src/app/admin/login/page.tsx` | 공개 | 관리자 credentials 로그인 |
| `/admin` | `src/app/admin/page.tsx` | 관리자 | 사용자관리·신청관리·체크인·당일현황 |
| `/admin/applications/new` | `src/app/admin/applications/new/page.tsx` | 관리자 | 신청 공고 작성 (ApplicationForm) |
| `/admin/applications/[id]/edit` | `src/app/admin/applications/[id]/edit/page.tsx` | 관리자 | 신청 공고 수정 |
| `/admin/applications/[id]/stats` | `src/app/admin/applications/[id]/stats/page.tsx` | 관리자 | 공고 통계·신청 명단 (ApplicationStats) |

## §5 API Routes

### 인증

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/auth/[...nextauth]` | * | — | Auth.js 핸들러 |

### 학생/교사 공용

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/qr/token` | GET | 학생/교사 (`requireActor("SIGNED_IN")`+`selfUserId`) | QR JWT 토큰 발급 (3분 만료) |
| `/api/checkin` | POST | 공개 | QR 체크인 (JWT 토큰 검증) |
| `/api/checkins` | GET | 학생/교사 (`requireActor("SIGNED_IN")`+`selfUserId`) | 본인 월별 체크인 이력 |
| `/api/users/me` | GET | 학생/교사 (`requireActor("SIGNED_IN")`+`selfUserId`) | 본인 프로필 조회 — `todayMeals`(오늘 자격 식사 목록) 반환, 구 `registrations` 필드 제거됨. **PUT은 삭제됨**(명부 필드는 관리자 소유, 교사 본인 수정 UI도 제거) |
| `/api/users/me/photo` | POST/DELETE | 학생/교사 (`requireActor("SIGNED_IN")`+`selfUserId`) | 사진 업로드/삭제 — POST 저장 경로 `UPLOAD_DIR`(Railway Volume) 우선, photoUrl `/api/uploads/{id}.webp?t=...` 발급 |
| `/api/users/me/face` | GET/POST/DELETE | 학생/교사 (`requireActor("SIGNED_IN")`+`selfUserId`) | 안면인식 등록 관리 — GET 등록 여부/모델버전/동의일시, POST `faceEnrollSchema`(embeddings 3~5개, consentVersion) upsert, DELETE 완전 삭제. 모두 `invalidateFaceCache()` 호출 |
| `/api/facecheck` | POST | 공개(키오스크 키) | 얼굴 임베딩 1:N 매칭 체크인 — `faceCheckSchema`({embedding,type?,confirmation?}), `confirmation={userId,mealKind,date}`. `rankCandidates`+`decideMatch`로 사용자 특정 후 확인 전에는 `needConfirmation:true`와 대상·식사·KST 날짜를 반환(저장 없음). 확인 요청은 임베딩 재매칭 후 동일 대상/현재 날짜/식사를 검증하며 불일치 시 `CONFIRMATION_CHANGED`. 확인 후 중복·학생 자격 검증과 체크인. 매칭 결과에 `similarity/runnerUp`(1·2위 유사도). 헤더 `x-kiosk-key`가 `FACECHECK_KIOSK_KEY`와 일치해야 함(불일치 401, 미설정 503), IP당 분당 120회 레이트리밋(429). 교사는 type 없으면 `needConfirmation:true,needType:true` 응답(2단계 무상태), 학생은 `isStudentEligibleToday` 자격 검증, source="FACE" |
| `/api/uploads/[filename]` | GET | 공개 | `runtime=nodejs`, `UPLOAD_DIR`에서 readFile 스트리밍 (없으면 `/uploads/` 정적 폴백) |
| `/api/meals` | GET | 공개 | NEIS API 급식 메뉴 조회 (?date=YYYYMMDD) |
| `/api/applications` | GET | 로그인 | 신청 가능한 공고 목록 (현재 OPEN, 기간 내) |
| `/api/applications/my` | GET | 로그인 | 본인 신청 이력 전체 (식사별 meals 포함) |
| `/api/applications/[id]` | GET | 학생 | 공고 상세 (식사별 가격/방식/학년별 개설일 — StudentApplicationView용); myRegistration에 `addedBy`/`updatedAt` 포함 |
| `/api/applications/[id]/register` | POST | 학생 | 식사별 신청 `{meals}` (studentRegisterSchema, 취소된 row 재활성화 포함) |
| `/api/applications/[id]/register` | DELETE | 학생 | 신청 취소 |

### 교사

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/teacher/students` | GET | TEACHER | 운영 학년도 담당 학급만 조회. year/month도 3월~다음 해 2월 범위 밖이면 403. 기본 월은 KST 오늘을 운영 학년도 범위로 제한. 응답 academicYear/year/month·학생·식사 컬럼·인쇄 QR |
| `/api/teacher/applications` | GET | 교사 | 담임용 전체 공고 목록(OPEN/CLOSED) `{id,title,status,startYear/Month,monthCount,applyStart/End,meals}` |
| `/api/teacher/applications/[id]/registrations` | GET | 교사 | 공고별 우리 반(grade,classNum) APPROVED 신청자만 `{user(number,name),createdAt,signature,meals(applied/exempt/dayCount)}` (role=TEACHER + homeroom 검증) |

### 관리자

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/admin/users` | GET/POST/PUT/DELETE | 관리자 | 사용자 관리 — GET `requireActor("READ_ADMIN")`(응답에 `gender` 포함), POST/PUT/DELETE `requireActor("WRITE_ADMIN")`. POST/PUT은 학생 gender 필수 + role/gender 형식 검증 후 `withCompatUserWrite`로 저장해 ACTIVE 학년도 기록·명부에 미러(호환 쓰기). **DELETE는 항상 409**(`reason`: 삭제 불가, 이용 중단으로 처리) |
| `/api/admin/users/[id]/email` | PUT | `requireActor("WRITE_ADMIN")` | 이메일 교체 `{requestId, expectedRowVersion, email}` → `changeEmail`(emailKey 갱신, sessionVersion 증가, 연결 RosterEntry 키 이동). 응답 `{receipt}` |
| `/api/admin/users/[id]/access` | PUT | `requireActor("WRITE_ADMIN")` (재개는 MAIN만 — `changeAccess`가 트랜잭션 안에서 재판정) | 이용 상태 `{requestId, expectedRowVersion, state: ACTIVE\|INACTIVE, reason, confirmPrivileges?}`. 중단 시 sessionVersion 증가·FaceProfile 삭제·얼굴 캐시 무효화, `UserAccessEvent` 기록 |
| `/api/admin/users/[id]/permissions` | PUT | `requireActor("MAIN")` | 관리자 등급 `{requestId, expectedRowVersion, level: NONE\|SUBADMIN\|ADMIN}` → `changePermissions`(sessionVersion 증가) |
| `/api/admin/import` | POST | WRITE_ADMIN | 학년도별 Excel로 대체됨. 인증 후 410, DB 쓰기 없음. 기존 Sheet/code.gs 자료는 보존 |
| `/api/admin/checkins` | GET | 관리자 | 월별 체크인 + `mealColumns`(승인된 BREAKFAST 신청일에만 조 컬럼 삽입) (category: teacher/1/2/3) |
| `/api/admin/checkins/toggle` | POST | 관리자 | 체크인 수동 토글 (body.mealKind 필수, 학생: on/off, 교사: cycle WORK→PERSONAL→삭제) |
| `/api/admin/dashboard` | GET | 관리자 | 당일 현황 + `hasBreakfast`/`hasLunch`/`breakfastStudentCount`/`lunchStudentCount`/`dinnerStudentCount` |
| `/api/admin/export` | GET | 관리자 | 월별/일별 Excel 다운로드 (mealKind 표시: 월별 셀 "O+조"/"근+조", 일별 "식사" 컬럼) |
| `/api/admin/applications` | GET/POST | 관리자 | 신청 공고 목록 조회 / 신규 생성 (adminApplicationSchema, 식사별 meals+mealDates — `lib/meal-plan-server.ts:saveApplication`) |
| `/api/admin/applications/[id]` | GET/PUT/DELETE | 관리자 | 신청 공고 상세/수정/삭제 (수정 시 resyncRegistrations로 기존 신청 확정일 재계산) |
| `/api/admin/applications/[id]/close` | POST | 관리자 | 신청 공고 강제 마감 |
| `/api/admin/applications/[id]/registrations` | GET/POST | 관리자 | 공고별 신청자 목록 (식사별 meals) / 관리자 직접 추가 |
| `/api/admin/applications/[id]/registrations/[regId]` | GET/PATCH/DELETE | 관리자 | GET: 신청 상세(meals+selectedDates+weekdaysByMonth, canReadAdmin) / PATCH `{meals}` 또는 `{status}` / DELETE 완전 삭제 |
| `/api/admin/applications/[id]/export` | GET | 관리자 | 기본: 통계 워크북 4시트(전체신청내역·요일별·에듀파인·학년별-성별, 수식 포함 — `lib/meal-stats-excel.ts`) / `?template=true`: `meal-template-columns.ts` 기반 날짜/요일별 컬럼+프리필 양식 |
| `/api/admin/applications/[id]/import` | POST | 관리자 | `meal-template-columns.ts` 헤더 파싱 기반 일괄 신청 등록; 응답에 `ignoredMarks` 포함, MAX_FILE_SIZE_MB 가드, `resolveRegistrationSelections`에 ResolveContext 옵션(N+1 제거) |

### 시스템 / 동기화

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/system/settings` | GET | 공개 | 운영 모드·QR 생성 번호·faceMatch 조회 (30s 캐시) |
| `/api/system/settings` | PUT | `requireActor("WRITE_ADMIN")` | 운영 모드 변경 / QR 강제 갱신 / `faceMatchThreshold`·`faceMatchMargin` 조정 |
| `/api/sync/download` | GET | WRITE_ADMIN | READY에서는 사용자·자격·연도 프로필·설정·선택 얼굴을 한 RepeatableRead에서 수집하고 snapshot 근거 저장. PREPARING은 기존 응답 유지. ?faces=1만 임베딩 포함 |
| `/api/sync/upload` | POST | WRITE_ADMIN | deviceId/clientId 원본·검토 상태를 원자 선점, snapshot/사건 근거로 ACCEPTED/DUPLICATE/REVIEW/REJECTED 반환. REVIEW는 final=false·원본 보존 |

> **현재 서버 가드**: 보호 API는 `requireActor`로 최신 계정·sessionVersion·권한을 확인한다. 변경 서비스는 transaction 안에서도 재검사한다. 공개 QR/얼굴 체크인은 기존 키오스크 키/JWT 정책을 유지하며 `checkin-account.ts`에서 최신 계정·해당 학년도 자격을 검증한다. proxy/UI의 JWT 권한은 서버 허용 근거가 아니다.

### 학년도 관리자 API

| 경로 (`/api/admin` 기준) | 계약 |
| --- | --- |
| `/academic-years` | READ 목록, WRITE 준비 학년도 생성·운영 명부 복사 |
| `/academic-years/[year]/roster` | READ 목록(includeExcluded/includeEntryless), MAIN 지난 명부 DELETE |
| `/academic-years/[year]/records/[userId]` | WRITE 행 저장·과거 표시정보 정정; requestId와 행 버전 |
| `/academic-years/[year]/template` | READ 표준 학생/교사 XLSX, 기존 자료·현재 학급 병기 옵션 |
| `/academic-years/[year]/imports` | WRITE Excel 미리보기 생성 |
| `/academic-years/[year]/imports/[id]` | WRITE 미리보기 행 선택 PATCH·취소 DELETE |
| `/academic-years/[year]/imports/[id]/commit` | WRITE 원자 확정, 신규·FULL 누락·충돌 확인 |
| `/academic-years/[year]/decisions` | WRITE 누락자 졸업·전출·퇴직·복원 결정 |
| `/academic-years/[year]/review` | WRITE POST 전환 검토 건수·경고·삭제될 초안 후보 수 |
| `/academic-years/[year]/activate` | MAIN 명시 전환, 경고·키오스크 확인 |
| `/checkin-reviews` | READ 상태별 목록·id 상세, 발생 학년도 표시정보 |
| `/checkin-reviews/[id]` | WRITE 승인/거절, 필수 사유·식사 종류·멱등 영수증 |

## §6 데이터 모델 (Prisma)

| 모델 | 주요 필드 | 관계 | 비고 |
|------|----------|------|------|
| `Admin` | id, username, passwordHash | — | 현재 미사용, 환경변수 방식 대체 |
| `User` | id, email, name, role(STUDENT/TEACHER), grade?, classNum?, number?, subject?, homeroom?, position?, photoUrl?, gender?(MALE/FEMALE), adminLevel(NONE/SUBADMIN/ADMIN), **emailKey?(@unique, 정규화 이메일)**, **accessState(String, 기본 ACTIVE; CHECK ACTIVE/INACTIVE)**, **sessionVersion(Int 0)**, **profileVersion(Int 0)** | checkIns, registrations, faceProfile?, academicRecords, rosterEntries, rosterDecisions, accessEvents | @@index([role,grade,classNum,number]), @@index([role,adminLevel]) — gender는 학생 필수(API 검증) / 교사 옵셔널, 컬럼은 nullable |
| `MealApplication` | id, title, description?, **applyStartAt/applyEndAt?(DateTime)**, **startYear/startMonth/monthCount?(Int)**, status(OPEN/CLOSED), **academicYear?(Int → AcademicYear.year, onDelete Restrict)** | registrations, meals, mealDates, year | applyStartAt/EndAt(시각 단위 신청기간) + startYear/Month/monthCount(대상 월 범위) — 구 `type` 컬럼은 Wave 2b(20260611000004)에서 DROP 완료 |
| `MealApplicationMeal` | applicationId, mealKind, price, exemptionSelectable, method(NONE/YN/WEEKDAY/DATE) | application | @@id([applicationId,mealKind]) — 공고가 제공하는 식사별 가격·신청 방식 |
| `MealApplicationMealDate` | applicationId, mealKind, grade, date(@db.Date) | application | @@id([applicationId,mealKind,grade,date]) — 학년별 식사 개설일 |
| `MealRegistration` | id, applicationId, userId, signature(Text), status(APPROVED/CANCELLED), cancelledAt?, cancelledBy?, addedBy? | application, user, meals, mealDates | @@unique([applicationId,userId]) — 취소 후 재신청 시 row 재활성화 |
| `MealRegistrationMeal` | registrationId, mealKind, applied, exempt, weekdaysByMonth?(JSON `{"2026-07":[1,3,5]}`) | registration | @@id([registrationId,mealKind]) — 학생의 식사별 신청 내용 |
| `MealRegistrationMealDate` | registrationId, mealKind, date(@db.Date) | registration | @@id([registrationId,mealKind,date]), @@index([date,mealKind]) — **신청 확정일 단일 진실, 체크인 자격 판정 기준** |
| `CheckIn` | id, userId, date(@db.Date), **mealKind(NOT NULL)**, checkedAt, type(STUDENT/WORK/PERSONAL), source?(QR/ADMIN_MANUAL/LOCAL_SYNC/FACE) | user | @@unique([userId,date,mealKind]), @@index([date,mealKind]) |
| `SystemSetting` | key(PK), value, updatedAt | — | operationMode, qrGeneration, breakfast/lunch/dinner_window_start/end, face_match_threshold/margin |
| `FaceProfile` | id, userId(@unique), embeddings(Json, 임베딩 배열), modelVersion, consentAt, consentVersion, createdAt, updatedAt | user(onDelete Cascade) | 안면인식 등록 프로필. 마이그레이션 `20260902000001_add_face_profile`(수기 SQL) |
| `AcademicYear` | year(Int PK), state(DRAFT/ACTIVE/ARCHIVED), version, reviewedVersion?, reviewedSourceVersion?, activatedAt? | records, entries, files, imports, decisions, applications, snapshots | ACTIVE는 부분 유니크 인덱스 `AcademicYear_one_active`로 1개만(SQL 전용) |
| `RosterControl` | id(PK, CHECK id=1 싱글턴), mode(PREPARING/READY), version | — | 전역 잠금·낙관적 버전 행 (§12 잠금 순서) |
| `UserAcademicRecord` | id, year, userId, role, name, grade?, classNum?, number?, gender?, subject?, homeroom?, position?, memberState(ENROLLED/EMPLOYED/GRADUATED/TRANSFERRED/RETIRED), needsReview, version | academicYear, user | @@unique([year,userId]); role↔memberState CHECK와 학생 좌석 부분 유니크 `AcademicRecord_student_seat`(year,grade,classNum,number WHERE STUDENT·ENROLLED·needsReview=false)는 SQL 전용 |
| `RosterEntry` | id(cuid), year, userId?, emailKey, draftEmail?, draftProfile?(Json), included, baseUserVersion?, version | academicYear, user?(onDelete Restrict) | @@unique([year,emailKey]), @@unique([year,userId]) — 학년도 명부 항목/초안 |
| `RosterFile` | id(cuid), year, version, schemaVersion, manifest(Json), createdAt | academicYear | @@index([createdAt]) — 내보낸 명부 파일 기록 |
| `RosterImport` | id(cuid), year, scope(PARTIAL/FULL), controlVersion, yearVersion, payload?/preview?/summary?(Json), state(PREVIEW/COMMITTED/CANCELLED/EXPIRED) | academicYear | Excel 가져오기 미리보기·확정 |
| `RosterDecision` | year, userId, decision(GRADUATED/TRANSFERRED/RETIRED/RESTORE), sourceVersion | academicYear, user | @@id([year,userId]) |
| `RosterMutation` | requestId(PK), actorUserId?(MAIN은 null, FK 없음), kind, payloadHash, result(Json, 건수·ID만), version, changed | — | 멱등 요청 영수증·감사 기록 |
| `UserAccessEvent` | id, userId, state(ACTIVE/INACTIVE), reason, effectiveAt, requestId? | user | @@index([userId,effectiveAt]) — 이용 중단/재개 이력 |
| `EligibilityEvent` | id, scope(APPLICATION/REGISTRATION/ACCOUNT/ROLLOVER), applicationId?, userId?(둘 다 논리 참조, FK 없음), occurredAt, requestId? | — | @@index([userId,occurredAt]), @@index([applicationId,occurredAt]) |
| `AcademicBackfill` | key(PK), state(PENDING/COPIED/VERIFIED), sourceManifest(Json), completedAt?, verifiedAt? | — | 초기 이전 진행 상태 (key=`"2026"`) |
| `KioskSnapshot` | id(cuid), version, activeYear, lastEligibilityEventId, payload(Json), issuedAt, freshUntil, coversUntil(String) | academicYear(activeYear) | @@index([issuedAt]) |
| `LocalCheckInReview` | id(cuid), clientKey(@unique), payloadHash, payload?, snapshotId?(논리 참조), reason, state(PENDING/ACCEPTED/DUPLICATE/REJECTED, 기본 PENDING), decision?, resolvedAt? | — | 로컬 체크인 검토 대기열 |

> 학년도 명부 모델의 문자열 상태 컬럼 허용 값은 Prisma enum이 아니라 **마이그레이션 SQL의 CHECK가 단일 근거**다. 마이그레이션 `20260919000001_add_academic_year_roster`는 수기 SQL: 첫머리 `SET lock_timeout = '5s'`, 부분 유니크 인덱스 2개(`AcademicYear_one_active`, `AcademicRecord_student_seat`)와 모든 CHECK는 schema.prisma에 없고 SQL에만 있음, 끝에서 `RosterControl(1,'PREPARING',0)`·`AcademicYear(2026,'ACTIVE')` 시드. Release A에서 실제로 쓰는 모델은 AcademicYear·RosterControl·UserAcademicRecord·RosterEntry·RosterMutation·UserAccessEvent·AcademicBackfill이며, 나머지는 후속 릴리스용 테이블만 생성됨.

### Enums
- `Role`: STUDENT, TEACHER
- `CheckInType`: STUDENT, WORK, PERSONAL
- `CheckInSource`: QR, ADMIN_MANUAL, LOCAL_SYNC, FACE
- `AdminLevel`: NONE, SUBADMIN, ADMIN
- `MealKind`: BREAKFAST, **LUNCH**, DINNER
- `Gender`: MALE, FEMALE

- `MealPeriod` 는 제거됨
- `MealApplicationDate`, `MealRegistrationDate`, `MealApplication.type/applyStart/applyEnd/mealStart/mealEnd` — Wave 2(20260611000004)에서 제거 완료

## §7 주요 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|----------|------|------|
| `QRScanner` | `src/components/QRScanner.tsx` | nimiq/qr-scanner 래퍼. 전 화면 `object-contain` 영상과 라이브러리의 실제 스캔 윤곽용 외부 overlay, 카메라 전환·오류 표시. StrictMode 정리와 스트림이 경합하지 않도록 deferred start |
| `QRGenerator` | `src/components/QRGenerator.tsx` | JWT 토큰 → QR 이미지 (STUDENT/WORK/PERSONAL) |
| `MonthlyCalendar` | `src/components/MonthlyCalendar.tsx` | 월별 달력, showType prop으로 근무/개인 구분 |
| `StudentTable` | `src/components/StudentTable.tsx` | 담임 학생관리 표 — 식사별(조/중/석) 컬럼 읽기전용 (미신청=회색 음영/신청=흰색/체크인=식사색 "O") + 첫 열 sticky 체크박스(전체선택 헤더·행별 선택 `Set<number>`)·"N명 선택"/"QR출력" 툴바 → `StudentQRPrintDialog` 연결 |
| `StudentQRCard` | `src/components/StudentQRCard.tsx` | 인쇄용 5×5cm(≈47mm) 단일 학생 QR 카드(로고·식별 한 줄·QR), mm 고정 치수, 화면 미리보기·인쇄 공용 프레젠테이션 |
| `StudentQRPrintDialog` | `src/components/StudentQRPrintDialog.tsx` | 선택 학생 QR 카드 A4 일괄 인쇄 모달 — 미리보기 + `qrcode` 이미지 생성 + body 직속 포털 + `@page A4` 인쇄 격리(4×4=16개/페이지, 페이지 분할). `PrintStudent` 타입 export |
| `TeacherApplications` | `src/components/TeacherApplications.tsx` | 담임 신청현황 탭 — 공고 목록↔우리 반 신청자 마스터-디테일, 서명 이미지 썸네일+확대 모달 |
| `AdminMealTable` | `src/components/AdminMealTable.tsx` | 당시 학급 기준 월별 조회·체크인 토글. 교사/1~3학년/확인 필요 탭, 현재 학급 병기와 Excel 옵션. 확인 필요는 읽기 전용 |
| `PhotoUpload` | `src/components/PhotoUpload.tsx` | 프로필 사진 업로드/삭제 |
| `SignaturePad` | `src/components/SignaturePad.tsx` | 석식 신청 시 서명 입력 |
| `MealMenu` | `src/components/MealMenu.tsx` | NEIS API 급식 메뉴 표시 |
| `SwUpdater` | `src/components/SwUpdater.tsx` | Service Worker 등록·갱신 (SKIP_WAITING 트리거) — SW 본체는 `public/sw.js`(`posanmeal-v7`, 캐시 전략은 §12) |
| `ResetOnQuery` | `src/components/ResetOnQuery.tsx` | ?reset=1 쿼리 시 브라우저 캐시·IDB·SW 전체 초기화 |
| `KioskViewport` | `src/components/KioskViewport.tsx` | `/check`·`/facecheck` 공용 화면: `innerHeight`·`visualViewport.height`의 유효 최솟값을 `--kiosk-height`에 반영(기본 `100dvh`). resize·pageshow·orientationchange·visibilitychange 시 재측정하며 확대 중에는 높이를 유지. `globals.css`의 `.kiosk-*`가 safe-area, 축소된 1행 결과, 44px 조작 영역과 별도 동기화 상세 행을 담당 |
| `BrandMark` | `src/components/BrandMark.tsx` | 로고/브랜드 마크 |
| `PageSkeleton` | `src/components/PageSkeleton.tsx` | 로딩 스켈레톤 |
| `LocalCheckInsTable` | `src/components/LocalCheckInsTable.tsx` | 미전송·검토 대기·종결 거절을 표시. 저장 당시 displayProfile 우선, 원본 시각·자료를 Excel/CSV로 내보냄 |
| `EditableCell` | `src/components/EditableCell.tsx` | 관리자 표 inline 편집 셀 — `EditableTextCell` / `EditableSelectCell` named export, `SaveResult` 타입; blur·Enter 저장, Escape 취소, committingRef 이중 fire 방지, role="button"+tabIndex 접근성 |
| `FaceEnroll` | `src/components/FaceEnroll.tsx` | 학생·교사 개인정보 탭의 얼굴 등록/재등록/삭제 — 동의 모달 → 3장 자동 캡처. 전면 카메라는 미러링하며 기본 품질 필터와 얼굴 크기·경계·자세(`face-quality.ts`)를 통과한 임베딩만 POST `/api/users/me/face`. `/student`·`/teacher` 개인정보 탭에 연결됨 |
| `DateCheckboxList` / `MealKindBadge` | `src/components/DateCheckboxList.tsx`, `src/components/MealKindBadge.tsx` | 현재 어디서도 import 되지 않는 잔존 컴포넌트(2026-09-19 확인). 재사용 전 최신 meal/ UI와 중복 여부 확인 |

### 식사별 공고·신청 UI (`src/components/meal/`)

| 컴포넌트 | 파일 | 설명 |
|----------|------|------|
| `meal-ui` | `src/components/meal/meal-ui.ts` | `MEAL_THEME` — 식사(조/중/석)별 색상·라벨 테마 상수 |
| `AdminMealCalendar` | `src/components/meal/AdminMealCalendar.tsx` | 공고 작성용 학년×식사별 개설일 달력 선택 |
| `ApplicationForm` | `src/components/meal/ApplicationForm.tsx` | 공고 작성/수정 폼 (new·edit 페이지 공용) |
| `StudentMealCalendar` | `src/components/meal/StudentMealCalendar.tsx` | 학생 DATE 방식 신청일 선택 달력 |
| `ApplicationApplyForm` | `src/components/meal/ApplicationApplyForm.tsx` | 식사별 신청 폼 공용 컴포넌트 (학생 화면·관리자 모달 공유, footer render-prop) |
| `AdminApplyDialog` | `src/components/meal/AdminApplyDialog.tsx` | 관리자 대리 신청 모달 — 행 클릭=수정/신청 추가=학생 선택 후 신규, 신청기간 무시 |
| `StudentApplicationView` | `src/components/meal/StudentApplicationView.tsx` | 학생 공고 상세·식사별 신청 UI — 폼 로직이 ApplicationApplyForm으로 추출되어 래퍼화 |
| `ApplicationStats` | `src/components/meal/ApplicationStats.tsx` | 공고 통계·신청 명단 (stats 페이지) — AddDialog 제거, AdminApplyDialog 통합, 행 클릭/수정 버튼/관리자 배지 |

> `DateMultiPicker`, `BreakfastMatrixTable` 은 삭제됨 (meal/ 컴포넌트로 대체).

### 학년도 관리 화면과 클라이언트

- `src/components/admin-roster/`: `RosterManager`·`RosterToolbar`·`RosterTable`, `RosterAccountDialogs`, `RosterImportDialog`·`ImportPreviewPanel`, `CreateDraftDialog`·`RolloverDialog`, `ArchivedRosterDialog`, `CheckInReviewPanel`.
- `src/lib/admin-roster/`: 멱등 변경·request ID, import/archive/rollover/review controller, 누락자·프로필 편집·표시 유틸. 409 자동 덮어쓰기 금지, 응답 불명 재시도의 원래 본문 보존.
- `src/hooks/useAcademicRoster.ts`: 연도별 SWR 조회. `useTeacherStudents.ts`: 운영 학년도 기본 월 또는 선택 월 조회.
- `ApplicationForm`은 READY의 ACTIVE/DRAFT 선택·신청 이력 존재 시 연도 잠금, PREPARING은 기존 공고 저장을 유지한다. `ApplicationStats`·`StudentApplicationView`는 공고 학년도 프로필을 사용한다.
- `ForceResetDialog`는 내보내기·확인 문구 후 변경 여부를 다시 검사한다. `/check`·`/facecheck`는 오래된 근거·재동기화·검토 상태를 표시한다.

## §8 주요 lib 파일

| 파일 | 설명 |
|------|------|
| `src/lib/prisma.ts` | Prisma 단일 인스턴스 (adapter-pg, Pool max:20) |
| `src/lib/qr-token.ts` | QR JWT 발급·검증 (QR_JWT_SECRET, 3분 만료) |
| `src/lib/timezone.ts` | KST 날짜/시간 유틸 (nowKST, todayKST, formatKST 등) |
| `src/lib/checkin-source.ts` | CheckInSource enum → 한국어 라벨 변환 |
| `src/lib/permissions.ts` | canWriteAdmin / canReadAdmin (AdminLevel 기반) — 토큰 값만 보는 UI 표시·화면 이동용. 서버 쓰기 허용 근거로 쓰지 말 것(`academic-year/access.ts`의 `assertActor` 담당) |
| `src/lib/settings-cache.ts` | SystemSetting 30s 인메모리 캐시 (operationMode/qrGeneration/mealWindows + `faceMatch{threshold,margin}` — SystemSetting 키 face_match_threshold/margin, 기본값은 face-constants.ts) |
| `src/lib/neis-meal.ts` | NEIS 급식 API 호출 + 1시간 캐시 |
| `src/lib/local-db.ts` | IndexedDB v6. v4/v5 원본과 미전송 보존, snapshot header/members/profiles 및 기기 ID, 검토 상태·종결 거절 30일 관리. 강제 초기화는 내보낸 기록 범위를 같은 IDB transaction에서 확인 |
| `src/lib/clearClientState.ts` | 로그아웃 시 미전송이 있으면 키오스크 DB 전체 보존. 0건도 원자 재검사 뒤 데이터 clear, kiosk DB deleteDatabase는 사용하지 않음. SW·Cache 등 정리 후 signOut |
| `src/lib/fetcher.ts` | SWR 전용 fetch 래퍼 — `fetchWithSessionRecovery` 경유, 실패 시 `status`/`info`를 단 Error throw (테스트 `__tests__/fetcher.test.ts`) |
| `src/lib/session-recovery.ts` | 세션 만료 복구: `sessionRecoveryAction(status, body, pathname)` → `NONE`/`SIGN_OUT_HOME`/`SIGN_OUT_ADMIN`(보호 API의 401 코드 기준, 공개 키오스크 경로는 제외), `recoverSession`(첫 판정만 화면 이동), `fetchWithSessionRecovery(input, init?)` — 로그인 화면의 fetch 공용 (테스트 `__tests__/session-recovery.test.ts`) |
| `src/lib/public-paths.ts` | `isPublicPath(pathname)` — proxy 공개 경로 판정. 접두사는 경로 경계(`=== prefix` 또는 `prefix + "/"`)에서만 인정 (§9) |
| `src/lib/utils.ts` | 공통 유틸 (clsx/tailwind-merge 등) |
| `src/lib/meal-kind.ts` | 서버 헬퍼: 3윈도우(조/중/석) `resolveMealKind` + `isStudentEligibleToday`(MealRegistrationMealDate 단일 조회로 자격 판정) |
| `src/lib/meal-kind-local.ts` | 클라이언트 헬퍼 (오프라인 모드 태블릿용 mealKind 결정) |
| `src/lib/meal-windows-validation.ts` | 클라이언트 검증 + 서버 에러 한국어 매핑 (관리자 설정 UI 전용) |
| `src/lib/local-checkins-export.ts` | 로컬 기록 Excel·CSV 백업. 해당 연도 표시정보, 원 ISO 시각·원본 JSON, 수식 주입 방지. 강제 초기화와 관리자 목록에서 공용 사용 |
| `src/lib/checkin-client.ts` | `/check`·`/facecheck` QR 모드의 `/api/checkin` POST 재시도 클라이언트 `postCheckInWithRetry`(네트워크/5xx 3회) + 결과 타입 `CheckInResult`(`mealKind?: MealKind` = BREAKFAST/LUNCH/DINNER — `runLocalQrCheckIn` 반환 타입으로도 공용) |
| `src/lib/meal-columns.ts` | `MealKind`/`MealColumn` 타입 + `buildMonthlyMealColumns(year, month, activeDates)` — activeDates 객체 인자(식사별 운영일)로 컬럼 삽입 (관리자 표·엑셀 헤더 생성용) |
| `src/lib/meal-plan.ts` | 식사별 공고 공용 유틸: `MEAL_LABEL`/`METHOD_LABEL`/`monthsOf`/`expandWeekdays`/`calcMealFee`/`buildAppTitle`/`studentNumberOf` (서버·클라이언트 공용) |
| `src/lib/meal-plan-server.ts` | 서버 전용: `saveApplication`(공고 생성/수정 트랜잭션)/`resyncRegistrations`(공고 수정 시 확정일 재계산)/`resolveRegistrationSelections`/`writeRegistration` |
| `src/lib/meal-stats-excel.ts` | `buildStatsWorkbook` — 공고 export 4시트(전체신청내역·요일별·에듀파인·학년별-성별) 생성, 수식 포함. `buildSheet4`는 제공 식사(MEAL_KINDS 순)별 학년×성별 신청자수 표를 세로 스택(미지정 열/학년미상 행 조건부) |
| `src/lib/schemas/meal-plan.ts` | zod 스키마: `adminApplicationSchema`(공고 CRUD) / `studentRegisterSchema`(학생 register) |
| `src/lib/date-range.ts` | 날짜 범위 유틸: `buildMonthDateRange(year, month)`, `dateKeyToUtcDate(dateKey)`, `formatMonthDateKey`, `getDaysInMonthUtc` — API 라우트 공통 사용 |
| `src/lib/gender.ts` | `normalizeGender` / `genderLabel` / `GENDER_LABEL` — 시트 임포트 입력 정규화 + UI 표시용 라벨, 서버·클라이언트 공용 (테스트 `__tests__/gender.test.ts`) |
| `src/lib/meal-template-columns.ts` | 일괄신청 양식 컬럼 단일 진실 — `TemplateColumn` 타입(YN/DATE/WEEKDAY), `buildTemplateColumns`, `columnHeader`("중식-7월 5일"/"조식-월요일"), `parseColumnHeader`(months 기반 연도 복원). export/import 라우트 공유 (테스트 `__tests__/meal-template-columns.test.ts`) |
| `src/lib/qr-card.ts` | 담임 QR 카드 출력용: `buildCardQrString(studentId, generation)`(고정 로컬 QR `posanmeal:{id}:{generation}:STUDENT` 생성) + `chunk<T>(items, size)` 페이지 분할 유틸 (테스트 `__tests__/qr-card.test.ts`) |
| `src/lib/face-constants.ts` | 안면인식 상수: `FACE_EMBEDDING_DIM`(256), `FACE_MIN/MAX_EMBEDDINGS`(3~5), `FACE_MODEL_VERSION`(insightface-mobilenet-emore@human3.3.6), `FACE_MODEL_PATH`, `DEFAULT_FACE_MATCH_THRESHOLD/MARGIN`(0.55/0.05) |
| `src/lib/face-quality.ts` | 등록·키오스크 인식 전 얼굴 geometry 판정 순수 함수: 프레임 내 경계, 짧은 변의 절대/상대 최소 크기, 라디안 yaw/pitch/roll 허용치를 검사해 `clipped`/`tooSmall`/`turned` 반환 (테스트 `__tests__/face-quality.test.ts`) |
| `src/lib/face-stability.ts` | `FaceStabilityTracker`: 동일 사용자·날짜/식사 문맥의 유효 매칭 3회(최소 간격 200ms)를 모아 확인창 진입을 결정. 대상/문맥 변경·3초 초과 공백·시간 역행·명시적 reset 시 초기화 (테스트 `__tests__/face-stability.test.ts`) |
| `src/lib/face-match.ts` | 순수 함수: `cosineSimilarity(a,b)`, `rankCandidates(embedding, candidates)`(사용자별 최고 유사도 내림차순, 차원이 다른 구 모델 임베딩 제외), `decideMatch(ranked,{threshold,margin})`, `findBestMatch`(둘의 합성), `scoreSummary(ranked)`(1·2위 소수 3자리 `MatchScore`) (테스트 `__tests__/face-match.test.ts`) |
| `src/lib/unmatched-tracker.ts` | `UnmatchedTracker.observe(embedding, now)` → `pending`/`confirm`/`suppressed`. 미등록 얼굴은 같은 얼굴(cos≥0.6)이 3초 안에 두 번 보여야 확정(주황 카드+오류음), 확정 후 10초 억제. `/facecheck` `applyResult`가 `errorCode: "UNMATCHED"`일 때 사용 |
| `src/lib/face-match-validation.ts` | 관리자 설정 탭 "안면인식 임계값" 폼 검증: `parseFaceMatchForm`(threshold 0.30~0.90, margin 0~0.30, 소수 둘째 자리 반올림) / `toFaceMatchForm` |
| `src/lib/schemas/face.ts` | zod 스키마: `faceEnrollSchema`(embeddings 3~5개×256차원, consentVersion) / `faceCheckSchema`(embedding, type?, confirmation?) / `faceConfirmationSchema`·`FaceConfirmation`(userId, mealKind, date) (테스트 `__tests__/face-schema.test.ts`) |
| `src/lib/face-consent.ts` | `FACE_CONSENT_VERSION` + `FACE_CONSENT_TEXT`(안면인식정보 수집·이용 동의문 전문) |
| `src/lib/face-embedding-cache.ts` | `FaceProfile` 60s 인메모리 캐시: `getFaceCandidates()`(`modelVersion = FACE_MODEL_VERSION`인 프로필만, Json embeddings → Float32Array 변환), `invalidateFaceCache()` (테스트 `__tests__/face-embedding-cache.test.ts`) |
| `src/lib/human-client.ts` | 클라이언트 전용 Human 로더(`import "client-only"`) — `loadHuman(candidates: FaceBackend[] = ["webgl"])`: 후보를 순서대로 새 Human 인스턴스로 load+warmup(`warmup:"face"`)까지 시도해 첫 성공을 채택(실제 백엔드는 `human.tf.getBackend()`로 확인, `getActiveFaceBackend()`). 임베딩에 영향 주는 단계(detector/mesh/rotation/equalization/cacheSensitivity 0)는 백엔드와 무관하게 고정(`modelBasePath: "/models/"`, load/warmup 90s 타임아웃 + `human.models.loaded()`로 필수 모델(blazeface/facemesh/insightface/antispoof/liveness) 검증; `description`(faceres)은 끄고 `insightface.modelPath = FACE_MODEL_PATH`). `detectFaces(human, video, signal?)`는 5s 타임아웃과 none/multiple/face 판별에 더해 frame·box·라디안 pose geometry를 반환. 로드·warmup·추론은 인스턴스 간 전역 직렬화하며 호출자 타임아웃/취소 후에도 원본 연산 종료까지 잠금을 유지한다. AbortSignal로 대기 중 감지를 제거하고 영상 준비 상태는 실행 시 재검사. `qualityIssue(face)`/`FACE_QUALITY`/`withTimeout()` 제공 (테스트 `__tests__/human-client.test.ts`) |
| `src/lib/checkin-sounds.ts` | 체크인 사운드 4종 + 클릭(`playSuccess` 상승 2음 / `playDuplicate` 하강 2음 사각파 / `playDenied` 저음 버저 / `playError` 고음 3연타 / `playLockClick`), 어택·릴리즈 램프로 최대 음량 — `/check`·`/facecheck` 공용 |
| `src/lib/checkin-result-style.ts` | 결과 분류 `resultCategory(r)`(success/duplicate/notApplicant/error)와 배경·문구·두꺼운 테두리 색 매핑 `RESULT_BG_CLASS`/`RESULT_TEXT_CLASS`/`RESULT_BORDER_CLASS`(초록/파랑/빨강/주황) — `/check`·`/facecheck` 공용 (테스트 `__tests__/checkin-result-style.test.ts`) |
| `src/lib/face-pacing.ts` | 순수 함수: `resolveFaceBackends(override, hasWebGpu)`(webgpu→webgl 후보 순서), `nextDetectDelay(lastDetectMs)`(직전 검출/3, 30~200ms 클램프) (테스트 `__tests__/face-pacing.test.ts`) |
| `src/lib/facecheck-local.ts` | 로컬 모드 판정 엔진 `runLocalFaceCheckIn(input, repo)` — `/api/facecheck`와 같은 순서(KST 식사시간→`rankCandidates`/`decideMatch`→IDB 사용자·역할→confirmation 대상/날짜/식사 검증→미확인 응답→중복→학생 자격→`addCheckIn(synced:0)`)로 `FaceCheckResult` 반환. 미확인 요청은 읽기 전용이며 교사는 type도 필수(저장소 주입으로 테스트 가능). `toFaceCandidates`, `localDateKey`, `FaceCheckResult`/`FaceCheckUser` 타입 (테스트 `__tests__/facecheck-local.test.ts`) |
| `src/lib/qr-checkin-local.ts` | 인쇄 카드·로컬 QR(`posanmeal:{id}:{gen}:{type}[:{mealKind}]`) 판정 엔진 — `isLocalQR(data)`(접두어만 검사), `parseLocalQR(data)`(4·5-part), `runLocalQrCheckIn({data,now,mealWindows}, repo)`: 형식→세대(IDB `qrGeneration`과 비교, 저장값 없으면 생략)→명단→역할·유형→식사 시간(QR에 실린 mealKind 우선)→학생 자격→중복→`addCheckIn(synced:0)` 순으로 `CheckInResult`(`checkin-client.ts`) 반환. 저장소 주입 `LocalQrRepo{getSetting,getUser,isEligible,getCheckIn,addCheckIn}`. 원래 `/check` 안에 있던 로직을 분리해 `/check`·`/facecheck` QR 모드 공용 (테스트 `__tests__/qr-checkin-local.test.ts`) |
| `src/lib/kiosk-sync.ts` | `/check`·`/facecheck` 키오스크 설정·로컬 모드 동기화: `fetchKioskSettings()`(`/api/system/settings`를 `AbortSignal.timeout(5000)`으로 조회→IDB settings 저장; 오프라인·타임아웃·비2xx면 null — Wi-Fi는 잡히지만 서버에 닿지 않는 키오스크가 "모드 확인 중"에 갇히지 않도록; 서버 모드 online이면 `clearFaceProfiles`), `loadSavedKioskSettings()`, `performKioskSync()`(미전송 업로드 `/api/sync/upload` → `/api/sync/download?faces=1` → users/eligibleEntries/faceProfiles/settings/lastSyncAt 갱신; 401/403이면 관리자 로그인 안내) |

### 학년도 명부 (`src/lib/academic-year/`)

설계 `docs/superpowers/specs/2026-09-19-academic-year-roster-design.md`, 계획 `docs/superpowers/plans/2026-09-19-academic-year-roster.md`.

| 파일 | 설명 |
|------|------|
| `contracts.ts` | 공용 타입: `YearState`/`ImportScope`/`MemberState`, `Actor`(`MAIN` \| `USER{userId,sessionVersion}`), `Profile`/`AcademicProfile`/`RosterRow`/`RowIssue`/`RowChange`/`ImportPreview`, `MutationReceipt`/`RowMutationInput`/`MutationInput`/`MutationSummary`, `DomainErrorCode` 12종 |
| `calendar.ts` | `academicYearOfDate(dateKey)`(학년도는 3월 1일 시작, 1~2월은 직전 학년도), `academicYearBounds(year)`, `nextKstMidnight(now)`(절대시각 기준 — `nowKST()`의 재해석 Date 사용 금지) (테스트 `__tests__/academic-year-calendar.test.ts`) |
| `errors.ts` | `DomainError(code, message)` + `isDomainError` |
| `db.ts` | 타입 `Db`(PrismaClient \| TransactionClient), `Tx` |
| `mutation.ts` | 멱등 변경 wrapper. `withAcademicMutation`(전환·Excel 확정 등 전역 변경: RosterControl `FOR UPDATE` + control version 낙관 충돌), `withUserMutation`(사용자 한 행: RosterControl `FOR SHARE` → User 행 `FOR UPDATE`, `profileVersion`으로 충돌 판정·증가), `withRosterRowMutation`은 User→Record 잠금. 행 잠금 대기 뒤 receipt 재조회. `RosterMutation`에 requestId 영수증 저장, 같은 actor·kind·payloadHash만 재전송으로 인정(아니면 REQUEST_REUSED). 트랜잭션 옵션 `ROSTER_TX`(timeout 60s)/`USER_TX`(15s) |
| `backfill.ts` | 초기 이전: `INITIAL_ACADEMIC_YEAR`(2026), `runPreflight`(읽기 전용 충돌 보고), `copyAcademicRecords`, `backfill2026`(RosterControl `FOR UPDATE`, 점검·복사·상태 기록 한 트랜잭션, COPIED 이후 재복사 안 함, 기존 행 미덮어쓰기), `inspectBackfill`(READ ONLY), `verifyBackfill`(명시 확정; 실패 시 COPIED/verifiedAt 취소), 최신 미러·미귀속 공고 검사 |
| `readiness.ts` | `requireAcademicReady(db)` — 새 학년도 기능 API 전용 가드(PREPARING이면 NOT_READY 503), `enableAcademicMode(db, actor)` — MAIN만 PREPARING→READY, v2 VERIFIED·현재 미러·충돌·미귀속 공고 재검사, `inspectAcademicMode` 읽기 전용 |
| `roster-sql.ts` | 백필·호환 쓰기 공용 SQL 조각: `CONFLICT_GROUPS_CTE`, `MIRROR_CONFLICT_GROUPS_CTE`, `NEEDS_REVIEW_EXPR`(필수값 누락·좌석 중복·정규화 이메일 중복) |
| `access.ts` | `assertActor(tx, actor, required)` — 모든 보호 경로의 최종 근거. 토큰이 아닌 현재 DB 행으로 accessState·sessionVersion·role·adminLevel 재판정. `AccessRequirement` = SIGNED_IN/STUDENT/TEACHER/READ_ADMIN/WRITE_ADMIN/MAIN. `auth`를 import하지 않아 트랜잭션 안에서도 사용 (테스트 `__tests__/academic-access.test.ts`) |
| `request-actor.ts` | `requireActor(required, db?)` — Route Handler 첫 단계이자 **이 디렉터리에서 `auth()`를 부르는 유일한 자리**. credentials 관리자(`role=ADMIN`, `dbUserId=0`)는 MAIN 행위자. `selfUserId(actor)`는 본인 전용 API용 좁힘(MAIN이면 FORBIDDEN) |
| `account-service.ts` | `changeEmail`/`changeAccess`/`changePermissions`(모두 `withUserMutation` 경유, sessionVersion 증가로 기존 세션 무효화; 이용 상태·권한은 자기 자신 대상 변경 차단) + 트랜잭션 전용 집합 연산 `deactivateUsers(tx, userIds, …)`(INACTIVE·sessionVersion 증가·FaceProfile 삭제; 얼굴 캐시 무효화는 커밋 후 호출자 몫) (테스트 `__tests__/account-admin-routes.test.ts`) |
| `api.ts` | DomainError→HTTP 변환의 유일한 자리: `domainErrorStatus`, `errorResponse`(예상 밖 오류는 로그만 남기고 500 일반 메시지), `routeResponse(handler)`, `payloadHash(value)`(서버가 재계산), `parseIdParam` |
| `profile-schema.ts` | `normalizeEmail(email)` — `emailKey` 산출 규칙 |
| `compat-write.ts` | `withCompatUserWrite(db, write)` — `User` 명부 필드를 쓰는 기존 경로의 유일한 통로(첫 문장 RosterControl `FOR SHARE`, 반환 id를 같은 트랜잭션에서 미러). `mirrorUsersToActiveYear(tx, userIds)` — ACTIVE 학년도의 UserAcademicRecord·RosterEntry·`emailKey`를 `User` 현재값에 맞추고 needsReview 재계산, 값이 바뀐 사용자만 `profileVersion` 증가. 집합 기반 고정 문장만 사용 |
| `test-target.ts` | 통합 테스트 DB 고정 대상 상수(`ACADEMIC_TEST_HOST` 127.0.0.1, `ACADEMIC_TEST_PORT` 55439, DB·compose 프로젝트·Docker 라벨·identity marker) + `parseAcademicTestTarget(raw)` 검증 (테스트 `__tests__/academic-year-test-target.test.ts`) |

### 학년도 Release B 서비스

- `roster-service.ts`·`profile-service.ts`·`roster-write-sql.ts`: 학년도별 최종 소속·준비 명부, 계정 ID·학생/교사 역할 보존, ACTIVE 미러·행 버전. entry/year/user 연결 재검사.
- `workbook.ts`·`workbook-parser.ts`·`export-service.ts`: 학생/교사 XLSX·숨긴 대응표, 빈 행 뒤 데이터까지 검증.
- `import-service.ts`·`import-diff.ts`: RepeatableRead 미리보기·행별 충돌 선택·신규/FULL 누락 확인·원자 확정/취소. 시트 이동을 통한 계정 역할 변경 금지.
- `rollover-service.ts`·`rollover-sql.ts`: 누락 결정·경고 3종·권한 보존·이용 중단과 얼굴 삭제·명시 전환.
- `archive-service.ts`: 지난 명부 항목 삭제와 과거 표시정보 정정 분리. User·신청·체크인·연도 프로필 보존.
- `registration-context.ts`·`eligibility-mutation.ts`: 공고 행 잠금, 공고 학년도 기반 신청 의도·자격 검증과 EligibilityEvent.
- `report-profile.ts`·`teacher-scope.ts`: 당시 학급 기본·현재 병기, READY 결측 확인 필요, 담임 운영 학년도만 허용.
- `kiosk-snapshot.ts`·`upload-review.ts`: 14일 근거 발급·지연 업로드 검증·원본 검토/종결. `local-snapshot.ts`는 브라우저용 학년도·신선도·표시정보 판단.
- `retention.ts`: 확정/취소 payload 즉시, 미확정 24시간, 대응표·근거 30일 정리 및 지난 명부 삭제 연계.

### 학년도 명부 스크립트 (`scripts/academic-year/`)

| 파일 | 설명 |
|------|------|
| `test-db.ts` | 통합 테스트 DB wrapper — `up`/`migrate`/`down`만 허용(`npm run academic:test-db -- <명령>`). URL은 프로세스 내부에서만 구성·미출력, 운영 `DATABASE_URL`로 fallback하지 않음 |
| `pg-daemon.ts` | `up`이 detached로 띄우는 embedded-postgres 프로세스(Docker 없을 때). `down`이 SIGINT로 종료 |
| `fingerprint.ts` / `legacy-columns.json` | version 2 JSON 경계 인코딩으로 기존 컬럼·PK 지문 생성. NULL·제어문자·개행 구분, UTC 마이크로초 보존. 구형 증거 거절 |
| `backfill.ts` | 초기 이전 CLI — 기본 읽기 전용 inspect, 쓰기는 승인된 대상 설정·보호된 출력 경로 명시 필요. 출력은 차이 종류·건수만(개인정보·URL 미출력) |
| `verify.ts` | 기본 inspect는 READ ONLY, 명시 apply만 검증 stamp 확정. `--before` v2 manifest 비교 |
| `enable.ts` | 기본 inspect, 명시 apply만 MAIN READY 전환. 별도 CLI 뒤 웹 앱 캐시는 재시작/최대 30초 TTL 확인 |
| `report.ts` | apply 전 before를 보호 bundle(0700)/파일(0600)로 영속 저장. public·symlink·덮어쓰기 거절 |
| `db-target.ts` | CLI가 닿을 DB를 좁히는 관문 — 운영 `.env`/`DATABASE_URL` fallback 없음, 승인된 대상 설정 파일과 전부 일치할 때만 연결 |

## §9 인증 / 미들웨어

- `src/auth.ts`: Auth.js v5, 전략=JWT, Google OAuth + credentials(관리자)
  - signIn 콜백: 정규화 emailKey와 이전 전 null 키 후보를 함께 대조 (중복·키/원문 불일치·미등록·이용 중단 거부, User.email 원문 유지), role·adminLevel·`sessionVersion` 토큰 주입
  - JWT `sessionVersion`은 **로그인 시점에만** 기록(재검증 때 덮어쓰면 끊어 둔 토큰이 되살아남). 이메일·이용 상태·권한 변경이 DB `User.sessionVersion`을 올리면 기존 토큰은 무효. 타입은 `src/types/next-auth.d.ts`
  - **매 요청 최신 DB 재검증**: `requireActor`→`assertActor`가 accessState·sessionVersion·role·adminLevel을 DB에서 다시 읽음. 토큰에 sessionVersion이 없거나(기능 이전 발급) 불일치하면 `STALE_SESSION` 401, 중단 계정은 `ACCOUNT_INACTIVE` 403. 클라이언트는 `session-recovery.ts`가 로그아웃 후 로그인 화면으로 보냄
  - **MAIN = credentials 관리자**(`role=ADMIN`, `dbUserId=0`, DB 행 없음): SIGNED_IN/READ_ADMIN/WRITE_ADMIN/MAIN 요구만 통과, STUDENT/TEACHER·본인 전용(`selfUserId`)은 FORBIDDEN. DB 사용자는 adminLevel이 ADMIN이어도 MAIN 요구를 통과하지 못함
  - 관리자: ADMIN_USERNAME / ADMIN_PASSWORD_HASH (bcryptjs) 환경변수 비교
- `src/proxy.ts` (실제 파일명 — `src/middleware.ts` 아님. Next.js가 `proxy.ts`를 미들웨어로 인식): allowlist 방식 — 판정은 `src/lib/public-paths.ts`의 `isPublicPath`(`PUBLIC_EXACT`/`PUBLIC_PREFIXES`), 그 외 경로는 role 검증 후 리다이렉트/403. proxy 판정은 화면 이동용 선제 검사일 뿐이며 실제 허용은 각 Route Handler의 `requireActor`가 정함
  - `publicExact`: `/`, `/check`, `/facecheck`, `/admin/login`
  - `publicPrefixes`: `/api/auth`, `/api/checkin`, `/api/facecheck`, `/api/uploads`, `/api/system/settings`, `/api/sync`, `/api/meals`, `/_next`, `/uploads` — **경로 경계 매칭**(정확히 일치하거나 `prefix/`로 시작). 예전 bare `startsWith`는 `/api/checkins`를 `/api/checkin` 접두사로 공개 처리했으나 이제 보호됨
  - 보호 경로: `/student`(STUDENT), `/teacher`(TEACHER), `/admin`(canReadAdmin) — role별 리다이렉트. `/api/users/me/face`는 allowlist에 없어 로그인 필수
  - matcher: `_next/`와 확장자 포함 경로 제외 전체

## §10 환경변수 (.env.example 기준)

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 (Railway 내부) |
| `AUTH_SECRET` | NextAuth 시크릿 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth |
| `NEXT_PUBLIC_SITE_URL` | 절대 URL (`https://meal.posan.kr`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | 관리자 계정 (bcryptjs 해시) |
| `QR_JWT_SECRET` | QR 토큰 서명 키 |
| `QR_TOKEN_EXPIRY_SECONDS` | QR 만료 시간 (기본 180) |
| `FACECHECK_KIOSK_KEY` | `/api/facecheck` 헤더 `x-kiosk-key` 검증용 공유 키. 미설정 시 503 |
| `UPLOAD_DIR` | 사진 저장 경로 (Railway: `/app/uploads`) |
| `MAX_FILE_SIZE_MB` | 사진 최대 크기 (기본 5) |
| `TZ` | 타임존 (Asia/Seoul) |

> `AUTH_URL`, `DATABASE_PUBLIC_URL`, `RAILWAY_VOLUME_MOUNT_PATH` 는 Railway 서비스 환경에서 추가 설정.

## §11 브랜치 / 배포 (2026-06-16 단일 서비스)

| 브랜치 | 환경 | 도메인 | Railway 서비스 |
|--------|------|--------|----------------|
| `main` | production | `meal.posan.kr` (+ `dinner-posan.up.railway.app`) | `dinner` (watch=main) |

- **단일 환경(production) + 단일 서비스(`dinner`)** 만 존재. test/staging 서비스·`posanmeal.up.railway.app` 도메인 **없음** (옛 2-서비스 정책 폐기).
- 검증은 **로컬**(`npm run build` + `npm test`)에서. `main` push가 유일한 배포 트리거. `feat/*` push는 배포 안 됨.
- 워크플로: feature 브랜치 작업 → 로컬 검증 → `main` 머지/push → `meal.posan.kr` 배포.
- DB(PostgreSQL) + Volume(`posanmeal-volumn` → `/app/uploads`, `UPLOAD_DIR` 일치)은 이 서비스 단일 귀속. 마이그레이션은 additive 우선(운영 단일 DB 즉시 반영).
- 빌드: `npx prisma generate && npm run build`
- 시작: `npx prisma migrate deploy && next start`

## §12 주의사항 / 특이 패턴

- Prisma 7: `datasource.url` 은 schema.prisma 에 없음 → `prisma.config.ts` 에서 설정. 클라이언트 경로: `src/generated/prisma`
- Tailwind v4: CSS 기반 설정 (`globals.css`), `tailwind.config.ts` 없음
- `MealRegistration` upsert 패턴: 취소된 row가 있으면 UPDATE(재활성화), 없으면 INSERT. 200/201 분리 반환
- `AdminLevel` 도입: User.adminLevel(NONE/SUBADMIN/ADMIN)로 서브관리자 지원. `canWriteAdmin` = ADMIN만, `canReadAdmin` = ADMIN+SUBADMIN
- 오프라인(로컬) 모드: `SystemSetting.operationMode=local` 시 키오스크 페이지(`/check`·`/facecheck`)가 IndexedDB에 체크인 저장 → `/api/sync/upload` 로 업로드
- `CheckInSource` 필드: QR(스캔), ADMIN_MANUAL(관리자 토글), LOCAL_SYNC(오프라인 업로드) 구분
- `SwUpdater` + `ResetOnQuery`: PWA 업데이트 시 SW SKIP_WAITING → controllerchange → 페이지 리로드; ?reset=1 시 브라우저 상태 전체 초기화
- **Service Worker 캐시 전략 (`public/sw.js`, `CACHE_VERSION=posanmeal-v7`)**: install 시 `/check`·`/facecheck`만 프리캐시(인증 페이지는 익명 접속 시 리다이렉트라 오프라인 사본이 될 수 없음). 키오스크 페이지 내비게이션은 **네트워크 우선(5s 타임아웃) → 캐시 폴백 → 503 오프라인 HTML**(캐시 키는 쿼리 없는 pathname, `ignoreVary`) — 온라인이면 배포가 즉시 반영되고 오프라인에서도 페이지가 열림. v6까지의 `/check` 캐시 우선은 배포 후에도 옛 HTML을 영구 서빙해 hydration이 안 되고 "모드 확인 중" 스피너에 갇히는 원인이었음. `/_next/static/`·`/models/`(얼굴 모델 ~10MB, 오프라인 재로딩 후 안면인식에 필요)·아이콘/manifest/`meal.png`는 캐시 우선이며 `response.ok` 응답만 저장. 비키오스크 내비게이션과 `/api/`는 SW가 관여하지 않음. 메시지 `SKIP_WAITING`/`CLEAR_ALL` 지원
- `NEIS` 급식 API: 오피스코드 D10, 학교코드 7240189, 1시간 캐시
- 사진: `UPLOAD_DIR`(Railway Volume `/app/uploads`) 저장 → `/api/uploads/[filename]` 스트리밍 서빙, 파일 없으면 `/uploads/` 정적 폴백. 서명은 DB(`MealRegistration.signature` base64)에 보관
- **CheckIn unique 마이그레이션 (`20260502120000`)**: `mealKind` NOT NULL + `@@unique([userId,date,mealKind])`. SQL은 반드시 `DROP INDEX IF EXISTS "CheckIn_userId_date_key"` + `CREATE UNIQUE INDEX ...` 형태로 작성 — `DROP CONSTRAINT` 는 init 마이그레이션이 `CREATE UNIQUE INDEX` 로 만든 unique를 인식하지 못해 E42704 로 실패함
- **mealKind 시간 분기**: `lib/meal-kind.ts:resolveMealKind(now, windows)` 가 KST 시각으로 BREAKFAST/LUNCH/DINNER/null 결정 (SystemSetting `lunch_window_start/end` 추가로 3윈도우). 시간대 검증은 3윈도우 **쌍별 겹침** 검사. QR 토큰 발급 시점에 mealKind를 페이로드에 박고 (3분 만료), 체크인은 `payload.mealKind ?? resolveMealKind(...)` 로 토큰 우선
- **체크인 자격 판정**: `MealRegistrationMealDate`(오늘 날짜 + 해당 mealKind) 존재 + registration status=APPROVED. 이 테이블이 신청 확정일의 단일 진실 — 공고(MealApplicationMealDate)는 개설일일 뿐 자격 기준 아님
- **조식/중식 컬럼 노출 조건**: 관리자 석식확인·당일현황 모두 확정일(`MealRegistrationMealDate`, APPROVED) 기준으로만 BREAKFAST/LUNCH 컬럼·카드 부제 표시
- **CANCELLED 필터 필수**: CANCELLED 신청의 MealRegistrationMealDate 행은 보존됨(재신청 재활성화 대비) → 모든 집계·자격 조회에 `status=APPROVED` + `applied=true` 필터를 빼먹지 말 것
- **식사별 구조 마이그레이션**: `20260611000001`(MealKind에 LUNCH 추가, enum) + `20260611000002`(Meal/MealDate 테이블 4종 생성 + 구 데이터 백필, 멱등 `ON CONFLICT`). 구 컬럼(type, applyStart/End 등)·구 테이블(MealApplicationDate/MealRegistrationDate) 정리는 `20260611000003`(nullable 완화) + `20260611000004`(DROP) 두 단계로 완료
- **라이트모드 전용 운영**: `globals.css` 의 `@custom-variant dark` 는 `dark:` 유틸리티가 `prefers-color-scheme` 미디어쿼리로 fallback 하지 않도록 의도적으로 유지 (`.dark` 클래스는 어디서도 부여되지 않음). 다크모드 재도입 금지.
- **테스트**: `vitest`. `npm test` 로 실행. `src/lib/__tests__/` 에 메모리 mock 기반 단위 테스트. 학년도 명부 통합 테스트는 별도(아래 항목)
- **Excel 명부**: 학생 성별은 표준 학생 열에서 검증한다. 옛 Sheet import API는 인증 후 410이며 사용자관리 UI에서 제거했다. Sheet/code.gs 원본은 변경하지 않는다.
- **관리자 대리 신청 표시**: `MealRegistration.addedBy="ADMIN"` + `updatedAt` 이 관리자 대리 신청의 근거. 관리자가 학생 신청을 생성/수정하면 `addedBy`가 ADMIN으로 기록됨(의도된 동작). `AdminApplyDialog`는 신청기간(`applyStartAt/EndAt`) 검사를 우회한다
- **관리자 명부**: `RosterManager`의 학년도별 표와 공용 EditableCell을 사용한다. 이메일·이용 중단·권한은 별도 다이얼로그, 준비 명부·전환·삭제·과거 정정은 독립 흐름이다. 이전 요청 실패 재시도는 같은 requestId, 409는 다시 조회한다.
- **출력 카드 QR**: 담임이 출력하는 학생 QR 카드는 `posanmeal:{id}:{qrGeneration}:STUDENT` 형식의 고정 로컬 QR(만료 없음·식사 무관)이며 `qr-checkin-local.ts`의 `parseLocalQR`/`runLocalQrCheckIn`(4-part 로컬 경로, `/check`·`/facecheck` QR 모드 공용)으로 체크인된다. `/api/checkin`은 비변경. 관리자 QR 강제 갱신(`PUT /api/system/settings`로 `qrGeneration` 증가)으로 출력된 카드를 일괄 무효화할 수 있음
- **`next.config.ts` `serverExternalPackages: ["sharp", "@vladmandic/human"]` 제거 금지**: Turbopack의 Client-SSR 레이어가 이 설정 없이는 `@vladmandic/human`의 node export(`human.node.js` → `tfjs-node` 미설치로 빌드 실패)를 해석하려 시도함. 필수 설정
- **Human 모델 캐싱**: `@vladmandic/human`은 모델을 IndexedDB에 파일명 키로 캐시함. `public/models/`의 모델 파일을 교체할 때는 경로를 버전화(예: `/models/v2/`)해야 클라이언트가 구 캐시를 계속 쓰는 문제를 피할 수 있음
- **얼굴 원본 미저장**: 카메라로 촬영한 얼굴 이미지는 어디에도 저장·전송되지 않음 — 브라우저에서 Human으로 임베딩만 추출해 `FaceProfile.embeddings`(숫자 배열)만 서버에 저장/전송
- **임베딩 모델·입력 단계 고정**: insightface-mobilenet-emore(256차원)와 그 앞단(detector/mesh/rotation/equalization, `cacheSensitivity:0`)은 등록·인식 일관성 때문에 기기·백엔드와 무관하게 동일해야 함. 속도 튜닝은 백엔드(webgpu/webgl)와 검출 간격(`face-pacing.ts`)에서만. 모델을 바꾸면 `FACE_MODEL_VERSION` 상승 → 서버 캐시·`sync/download`가 구 버전 프로필을 자동 제외하고 `FaceEnroll`이 "재등록 필요"를 표시(전원 재등록). 이전 FaceRes(1024차원)는 나이·성별 헤드와 특징을 공유해 타인 간 코사인이 0.5~0.7까지 올라 아무나 매칭되는 문제로 폐기(2026-09-05, 측정: 선명한 타인 간 FaceRes 0.45~0.68 vs insightface ≤0.26)
- **로컬 모드 임베딩 보관 정책**: 서버 운영 모드가 `local`일 때 동기화로 등록자 전원의 임베딩이 키오스크 IndexedDB `faceProfiles`에 내려감. 서버 모드가 `online`으로 확인되면(`fetchKioskSettings`/`performKioskSync`) 자동 삭제, `/check` [초기화](`clearAllData`)로도 삭제. 로컬 저장 체크인은 업로드 시 `source: LOCAL_SYNC`(얼굴/QR 구분 없음)
- **`CheckInSource` 확장 시 3곳 동시 갱신 필요** (수동 유니온, 자동 동기화 없음): `src/lib/checkin-source.ts`(`sourceLabel`) · `src/app/api/admin/export/route.ts`(Row.source 타입) · `src/app/admin/page.tsx`(배지 색상 분기)
- **얼굴 매칭 임계값**: `SystemSetting` 키 `face_match_threshold`/`face_match_margin` (기본 0.55/0.05, `face-constants.ts` DEFAULT_* 참조; DB 행이 있으면 그 값이 우선. 2026-09-06 부자 간 0.48이 0.45를 넘어 오인식돼 0.55로 상향). `/facecheck` 상태바에 직전 판정의 `유사도 1위/2위`가 표시되고 `/api/facecheck`·로컬 결과에 `similarity/runnerUp`이 실려 현장 튜닝 근거로 사용, `settings-cache.ts`가 30s 캐시. 임계값/마진은 관리자 `/admin` 설정 탭 "안면인식 임계값" 카드(`face-match-validation.ts`, 0.30~0.90 / 0~0.30)에서 저장 → `PUT /api/system/settings` `{faceMatchThreshold, faceMatchMargin}`(서버 허용: threshold 0<x≤1, margin 0≤x≤0.5). 키오스크는 페이지 로드 시 `fetchKioskSettings`로 다시 받으므로 새로고침만으로 적용
- **학년도 명부 잠금 순서**: 항상 `RosterControl`(id=1) 행 먼저, 그다음 `User` 행. 전환·Excel 확정(`withAcademicMutation`)과 백필(`backfill2026`)은 `FOR UPDATE`, 셀/계정 변경(`withUserMutation`)과 호환 쓰기(`withCompatUserWrite`)는 `FOR SHARE` 후 필요한 User 행을 `FOR UPDATE`. 체크인·신청 경로는 이 행을 잠그지 않는다
- **`needsReview`는 Release A 동안 파생값**: 백필과 미러(`mirrorUsersToActiveYear`)만 기록하고 공용 식은 `roster-sql.ts`의 `NEEDS_REVIEW_EXPR`(필수값 누락·좌석 중복·정규화 이메일 중복). 매번 전체 재계산해도 사람 판단을 지우지 않는다는 전제이므로, 수동 검토 도구(사람이 세우는 플래그)를 도입할 때 이 전제를 먼저 재검토
- **이용 중단 시 FaceProfile 삭제**: `deactivateUsers`/`changeAccess(INACTIVE)`가 얼굴 등록을 지우고 캐시를 무효화한다. 재개해도 되살리지 않으며 본인이 다시 동의·등록해야 함. 사용자 삭제(`DELETE /api/admin/users`)는 409로 막혀 있고 이용 중단이 대체 수단
- **기존 호환 `User` 쓰기는 `withCompatUserWrite` 경유**: 이름·학년/반/번호·성별·교과·담임·직책·이메일·역할을 쓰는 새 경로를 만들면 이 wrapper 안에서 쓰고 변경된 id를 돌려줘 ACTIVE 학년도 기록·명부에 미러되게 할 것(현재 사용처: PREPARING `/api/admin/users` POST/PUT. READY는 명부/계정 서비스, 옛 `/api/admin/import`는 410)
- **학년도 명부 통합 테스트**: `npm run academic:test-db -- up|migrate|down` 으로 전용 PG를 켜고(`compose.academic-year-test.yml`의 Docker, 없으면 embedded-postgres 폴백) `npm run test:academic`(`vitest.integration.config.ts`, `tests/integration/`) 실행. 대상은 `127.0.0.1:55439` 전용이며 identity marker는 `academic_meta` 스키마에 둔다(public이 비어 있어야 `migrate deploy`가 P3005 없이 동작). 운영 `DATABASE_URL`로 fallback하지 않음
- **`RosterControl.mode=PREPARING`**: 새 학년도 기능 API(명부·Excel·전환·검토 — `requireAcademicReady`)만 막는다. 기존 사용자 관리·신청·체크인 쓰기는 영향 없음. READY 전환은 MAIN만, 백필 VERIFIED + 잔여 충돌 0일 때(`enableAcademicMode`)
- **기존 schema drift(이 작업과 무관)**: `MealRegistration.updatedAt`은 마이그레이션 `20260502090000`이 `DEFAULT CURRENT_TIMESTAMP`로 만들었지만 schema는 `@updatedAt`(기본값 없음)이라 `migrate diff`에 `DROP DEFAULT`가 나타난다. 학년도 명부 마이그레이션에 섞지 말 것

## §13 Project-Map Maintenance

Codex 기준 맵은 `.codex/PROJECT_MAP.md`. `project-map-updater`가 git diff와 untracked 파일을 근거로 필요한 부분만 갱신한다. Claude 훅/pending 로그와 별도로 관리하며 원본 로그는 지우지 않는다.

## §14 Codex 작업 환경

- `AGENTS.md`: 자동 로드할 프로젝트 지침과 명령.
- `.codex/config.toml`: GPT-6-Astra 기본 모델 및 5개 검수/문서 역할 등록.
- `.codex/rules/`: 프로젝트 탐색, 코딩, UI, Prisma, Railway 규칙.
- `.codex/agents/`: 위 역할의 프로젝트 전용 지침.
- `.codex/memory/MEMORY.md`: 인계 색인; legacy 하위는 Claude 메모리의 역사적 사본.
- `.codex/README.md`: 시작 명령과 이관 내역.
- `.agents/skills/`: 프로젝트 안내 제작 스킬. `guide-page`가 전체 흐름을 연결하며 `remotion-best-practices` 등 Remotion 13종과 `mlx-voice-clone`(`mlx-audio==0.5.3`)을 사용한다.
- `.agents/skills/guide-page/assets/demo-video/`: 독립 Remotion 제작 템플릿. `src/guide/`·`src/components/`의 공용 장면/목업, `src/setup-check/` 환경 확인 샘플, `scripts/`의 음성 생성·전사 검수·스틸 추출·환경 점검을 포함한다. 의존성은 미설치이며 루트 타입·린트는 `.agents/**`를 제외한다.
- `.codex/GUIDE_PAGES.md`: PosanMeal 대상 화면, 영상·스틸의 장면 재사용, 로컬 복제 음성, 제작·검증·가이드 연결 기준과 진행 현황.
- `demo-video/`: 템플릿에서 복사·설치한 독립 Remotion 4.0.518 작업 공간. 자체 Node 의존성과 `.venv-tts/`(`mlx-audio==0.5.3`)를 사용한다. 루트 TypeScript·ESLint와 Tailwind 소스 탐색에서 제외한다.
- `demo-video/src/Root.tsx`: 학생 본편 `StudentGuide`, 장면별 `Student-*`, 환경 점검용 `SetupCheck` 컴포지션 등록.
- `demo-video/src/student/`: 학생 안내 16장면·46문장. `scenes/`와 `scenes.ts`는 인트로/주소/로그인/계정 복구/탭/식단/신청/서명/수정·취소/QR/인쇄/얼굴 인식 소개/얼굴 등록/키오스크/기록/마무리 순서다. `Intro.tsx`는 포산밀 학생 사용안내 타이틀·인사, `FaceOption.tsx`는 휴대전화·인쇄 QR 휴대가 어려운 학생에게 얼굴 인식 베타를 선택지로 소개하며 `Print`와 `Enroll` 사이에 배치한다. `Closing.tsx`는 물음표 아이콘으로 학생 안내 페이지를 다시 확인하는 아웃트로를 포함한다. `StudentMockups.tsx`·`data.ts`는 예시 데이터 기반 학생·키오스크 목업, `SceneLayout.tsx`·`style.ts`는 화면 구성과 스타일이다.
- `demo-video/src/student/narration.ts`·`timing.ts`·`narration-durations.json`: 자막 원고·발음 대체문·문장별 실측 길이와 장면 타이밍. 말끝 보존 후 1초 여유와 0.35초 페이드아웃을 적용한다. `scripts/narrate.mjs --guide student`가 생성·전사 검수를 수행하며 생성 음성은 `public/narration/student/`에 둔다.
- `demo-video/scripts/student-deliverables.mjs`: 장면 ID별 제목과 실측 타이밍에서 SRT 자막·챕터 메타데이터/목록·`student-timeline.json`을 생성한다.
- `demo-video/src/stills/student.ts`: 본편과 같은 장면의 스틸 15장 추출 지점·크롭 정의. `scripts/guide-stills.mjs --page student --out out/guide-stills`로 장면을 렌더하거나, `scripts/student-previews.mjs`로 최종 MP4에서 장면별 검토 프레임·첫 장면 썸네일·가이드 스틸을 추출한다. 렌더·검수 산출물은 `demo-video/out/`, 생성 음성·가상환경·산출물은 Git 제외 대상이다.
- `docs/video/student-guide-storyboard.md`: 학생 안내 구성과 실제 UI에 근거한 설명 기준. 최종 음성·영상 검증 상태는 제작 기록으로 별도 확인한다.
- 앱 `/help`와 공용 가이드 UI는 아직 구현하지 않았다. 영상의 물음표 아이콘·학생 안내 페이지 설명은 후속 앱 구현을 전제로 하며, 영상·스틸 제작을 앱 가이드 공개·배포 완료로 간주하지 않는다.
