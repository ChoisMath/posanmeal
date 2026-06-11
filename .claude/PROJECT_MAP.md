# Project Map — PosanMeal

> Last full regeneration: 2026-05-02 (revised 2026-06-11: 식사별(MealKind) 공고/신청 구조 대개편 — LUNCH 추가, Meal/MealDate 하위 테이블 4종)

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
| next-themes | ^0.4.6 | 다크/라이트 테마 |
| bcryptjs | ^3.0.3 | 관리자 패스워드 해시 |
| jsonwebtoken | ^9.0.3 | QR JWT 토큰 |
| @base-ui/react | ^1.3.0 | 헤드리스 UI 프리미티브 |
| vitest | ^4.1.5 | 단위 테스트 (devDep) |

## §3 폴더 구조

```
src/
├── app/
│   ├── layout.tsx               # Root layout (SwUpdater, ThemeProvider, AuthProvider)
│   ├── page.tsx                 # 랜딩 (Google 로그인)
│   ├── check/page.tsx           # QR 스캐너 (공개, 태블릿용)
│   ├── student/page.tsx         # 학생 4탭 (QR, 신청, 개인정보, 확인)
│   ├── teacher/page.tsx         # 교사 탭 (담임: 5탭, 비담임: 4탭)
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
├── providers/
│   ├── ThemeProvider.tsx
│   └── AuthProvider.tsx
├── hooks/                       # SWR 훅 등
├── types/
├── auth.ts                      # Auth.js 설정
└── middleware.ts                # 라우트 보호 (runtime=nodejs)
prisma/
├── schema.prisma
└── migrations/
```

## §4 페이지 라우트

| 경로 | 파일 | 접근 | 설명 |
|------|------|------|------|
| `/` | `src/app/page.tsx` | 공개 | 랜딩, Google 로그인 버튼 |
| `/check` | `src/app/check/page.tsx` | 공개 | QR 스캐너, 식당 태블릿용 |
| `/student` | `src/app/student/page.tsx` | 학생 | 4탭: QR, 신청, 개인정보, 확인 |
| `/teacher` | `src/app/teacher/page.tsx` | 교사 | 담임 5탭 / 비담임 4탭 |
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
| `/api/qr/token` | GET | 학생/교사 | QR JWT 토큰 발급 (3분 만료) |
| `/api/checkin` | POST | 공개 | QR 체크인 (JWT 토큰 검증) |
| `/api/checkins` | GET | 학생/교사 | 본인 월별 체크인 이력 |
| `/api/users/me` | GET/PUT | 학생/교사 | 본인 프로필 조회/수정 — GET이 `todayMeals`(오늘 자격 식사 목록) 반환, 구 `registrations` 필드 제거됨 |
| `/api/users/me/photo` | POST/DELETE | 학생/교사 | 사진 업로드/삭제 |
| `/api/uploads/[filename]` | GET | 공개 | Volume에서 사진 파일 서빙 |
| `/api/meals` | GET | 공개 | NEIS API 급식 메뉴 조회 (?date=YYYYMMDD) |
| `/api/applications` | GET | 로그인 | 신청 가능한 공고 목록 (현재 OPEN, 기간 내) |
| `/api/applications/my` | GET | 로그인 | 본인 신청 이력 전체 (식사별 meals 포함) |
| `/api/applications/[id]` | GET | 학생 | 공고 상세 (식사별 가격/방식/학년별 개설일 — StudentApplicationView용) |
| `/api/applications/[id]/register` | POST | 학생 | 식사별 신청 `{meals}` (studentRegisterSchema, 취소된 row 재활성화 포함) |
| `/api/applications/[id]/register` | DELETE | 학생 | 신청 취소 |

### 교사

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/teacher/students` | GET | 교사 | 담임 학급 학생 목록 |

### 관리자

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/admin/users` | CRUD | 관리자 | 사용자 관리 (GET은 `canReadAdmin` 가드, 응답에 `gender` 포함; POST/PUT은 학생 gender 필수 + role/gender 형식 검증) |
| `/api/admin/import` | POST | 관리자 | Spreadsheet CSV 사용자 가져오기 (학생 시트 6번째 열 `gender` 필수 파싱·검증, create/update upsert에 반영) |
| `/api/admin/checkins` | GET | 관리자 | 월별 체크인 + `mealColumns`(승인된 BREAKFAST 신청일에만 조 컬럼 삽입) (category: teacher/1/2/3) |
| `/api/admin/checkins/toggle` | POST | 관리자 | 체크인 수동 토글 (body.mealKind 필수, 학생: on/off, 교사: cycle WORK→PERSONAL→삭제) |
| `/api/admin/dashboard` | GET | 관리자 | 당일 현황 + `hasBreakfast`/`hasLunch`/`breakfastStudentCount`/`lunchStudentCount`/`dinnerStudentCount` |
| `/api/admin/export` | GET | 관리자 | 월별/일별 Excel 다운로드 (mealKind 표시: 월별 셀 "O+조"/"근+조", 일별 "식사" 컬럼) |
| `/api/admin/applications` | GET/POST | 관리자 | 신청 공고 목록 조회 / 신규 생성 (adminApplicationSchema, 식사별 meals+mealDates — `lib/meal-plan-server.ts:saveApplication`) |
| `/api/admin/applications/[id]` | GET/PUT/DELETE | 관리자 | 신청 공고 상세/수정/삭제 (수정 시 resyncRegistrations로 기존 신청 확정일 재계산) |
| `/api/admin/applications/[id]/close` | POST | 관리자 | 신청 공고 강제 마감 |
| `/api/admin/applications/[id]/registrations` | GET/POST | 관리자 | 공고별 신청자 목록 (식사별 meals) / 관리자 직접 추가 |
| `/api/admin/applications/[id]/registrations/[regId]` | PATCH/DELETE | 관리자 | PATCH `{meals}`(식사별 신청 내용 수정) 또는 `{status}`(APPROVED/CANCELLED) / DELETE 신청 완전 삭제 |
| `/api/admin/applications/[id]/export` | GET | 관리자 | 기본: 통계 워크북 3시트(전체신청내역·요일별·에듀파인, 수식 포함 — `lib/meal-stats-excel.ts`) / `?template=true`: 일괄신청 양식(조·중·석 O 표기) |
| `/api/admin/applications/[id]/import` | POST | 관리자 | 엑셀 양식 일괄 신청 등록 (식사별 O 표기 파싱) |

### 시스템 / 동기화

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/system/settings` | GET | 공개 | 운영 모드·QR 생성 번호 조회 (30s 캐시) |
| `/api/system/settings` | PUT | 관리자 | 운영 모드 변경 / QR 강제 갱신 |
| `/api/sync/download` | GET | 관리자 | 오프라인 모드용 초기 데이터 다운로드 (사용자 목록, 신청 자격자) |
| `/api/sync/upload` | POST | 관리자 | 오프라인에서 쌓인 체크인 서버 업로드 |

## §6 데이터 모델 (Prisma)

| 모델 | 주요 필드 | 관계 | 비고 |
|------|----------|------|------|
| `Admin` | id, username, passwordHash | — | 현재 미사용, 환경변수 방식 대체 |
| `User` | id, email, name, role(STUDENT/TEACHER), grade?, classNum?, number?, subject?, homeroom?, position?, photoUrl?, gender?(MALE/FEMALE), adminLevel(NONE/SUBADMIN/ADMIN) | checkIns, registrations | @@index([role,grade,classNum,number]), @@index([role,adminLevel]) — gender는 학생 필수(API 검증) / 교사 옵셔널, 컬럼은 nullable |
| `MealApplication` | id, title, description?, type(String), **applyStartAt/applyEndAt?(DateTime)**, **startYear/startMonth/monthCount?(Int)**, status(OPEN/CLOSED) | registrations, meals, mealDates | 신규 공고는 type="MULTI" 마커 + applyStartAt/EndAt(시각 단위 신청기간) + startYear/Month/monthCount(대상 월 범위) 사용 |
| `MealApplicationMeal` | applicationId, mealKind, price, exemptionSelectable, method(NONE/YN/WEEKDAY/DATE) | application | @@id([applicationId,mealKind]) — 공고가 제공하는 식사별 가격·신청 방식 |
| `MealApplicationMealDate` | applicationId, mealKind, grade, date(@db.Date) | application | @@id([applicationId,mealKind,grade,date]) — 학년별 식사 개설일 |
| `MealRegistration` | id, applicationId, userId, signature(Text), status(APPROVED/CANCELLED), cancelledAt?, cancelledBy?, addedBy? | application, user, meals, mealDates | @@unique([applicationId,userId]) — 취소 후 재신청 시 row 재활성화 |
| `MealRegistrationMeal` | registrationId, mealKind, applied, exempt, weekdaysByMonth?(JSON `{"2026-07":[1,3,5]}`) | registration | @@id([registrationId,mealKind]) — 학생의 식사별 신청 내용 |
| `MealRegistrationMealDate` | registrationId, mealKind, date(@db.Date) | registration | @@id([registrationId,mealKind,date]), @@index([date,mealKind]) — **신청 확정일 단일 진실, 체크인 자격 판정 기준** |
| `CheckIn` | id, userId, date(@db.Date), **mealKind(NOT NULL)**, checkedAt, type(STUDENT/WORK/PERSONAL), source?(QR/ADMIN_MANUAL/LOCAL_SYNC) | user | @@unique([userId,date,mealKind]), @@index([date,mealKind]) |
| `SystemSetting` | key(PK), value, updatedAt | — | operationMode, qrGeneration, breakfast/lunch/dinner_window_start/end |

### Enums
- `Role`: STUDENT, TEACHER
- `CheckInType`: STUDENT, WORK, PERSONAL
- `CheckInSource`: QR, ADMIN_MANUAL, LOCAL_SYNC
- `AdminLevel`: NONE, SUBADMIN, ADMIN
- `MealKind`: BREAKFAST, **LUNCH**, DINNER
- `Gender`: MALE, FEMALE

- `MealPeriod` 는 제거됨
- `MealApplicationDate`, `MealRegistrationDate`, `MealApplication.type/applyStart/applyEnd/mealStart/mealEnd` — Wave 2(20260611000004)에서 제거 완료

## §7 주요 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|----------|------|------|
| `QRScanner` | `src/components/QRScanner.tsx` | nimiq/qr-scanner 래퍼, 카메라 전환 버튼 |
| `QRGenerator` | `src/components/QRGenerator.tsx` | JWT 토큰 → QR 이미지 (STUDENT/WORK/PERSONAL) |
| `MonthlyCalendar` | `src/components/MonthlyCalendar.tsx` | 월별 달력, showType prop으로 근무/개인 구분 |
| `StudentTable` | `src/components/StudentTable.tsx` | 담임교사용 학생 석식 테이블 (틀고정, 합계행) |
| `AdminMealTable` | `src/components/AdminMealTable.tsx` | 관리자 석식 확인 (교사/1~3학년 탭, 체크인 수동 토글) |
| `PhotoUpload` | `src/components/PhotoUpload.tsx` | 프로필 사진 업로드/삭제 |
| `SignaturePad` | `src/components/SignaturePad.tsx` | 석식 신청 시 서명 입력 |
| `MealMenu` | `src/components/MealMenu.tsx` | NEIS API 급식 메뉴 표시 |
| `SwUpdater` | `src/components/SwUpdater.tsx` | Service Worker 등록·갱신 (SKIP_WAITING 트리거) |
| `ResetOnQuery` | `src/components/ResetOnQuery.tsx` | ?reset=1 쿼리 시 브라우저 캐시·IDB·SW 전체 초기화 |
| `ThemeToggle` | `src/components/ThemeToggle.tsx` | 다크/라이트 토글 |
| `BrandMark` | `src/components/BrandMark.tsx` | 로고/브랜드 마크 |
| `PageSkeleton` | `src/components/PageSkeleton.tsx` | 로딩 스켈레톤 |
| `LocalCheckInsTable` | `src/components/LocalCheckInsTable.tsx` | 관리자 설정 탭 모달 안 미동기 IDB 체크인 표 + `buildUserLabel` helper |
| `EditableCell` | `src/components/EditableCell.tsx` | 관리자 표 inline 편집 셀 — `EditableTextCell` / `EditableSelectCell` named export, `SaveResult` 타입; blur·Enter 저장, Escape 취소, committingRef 이중 fire 방지, role="button"+tabIndex 접근성 |

### 식사별 공고·신청 UI (`src/components/meal/`)

| 컴포넌트 | 파일 | 설명 |
|----------|------|------|
| `meal-ui` | `src/components/meal/meal-ui.ts` | `MEAL_THEME` — 식사(조/중/석)별 색상·라벨 테마 상수 |
| `AdminMealCalendar` | `src/components/meal/AdminMealCalendar.tsx` | 공고 작성용 학년×식사별 개설일 달력 선택 |
| `ApplicationForm` | `src/components/meal/ApplicationForm.tsx` | 공고 작성/수정 폼 (new·edit 페이지 공용) |
| `StudentMealCalendar` | `src/components/meal/StudentMealCalendar.tsx` | 학생 DATE 방식 신청일 선택 달력 |
| `StudentApplicationView` | `src/components/meal/StudentApplicationView.tsx` | 학생 공고 상세·식사별 신청 UI |
| `ApplicationStats` | `src/components/meal/ApplicationStats.tsx` | 공고 통계·신청 명단 (stats 페이지) |

> `DateMultiPicker`, `BreakfastMatrixTable` 은 삭제됨 (meal/ 컴포넌트로 대체).

## §8 주요 lib 파일

| 파일 | 설명 |
|------|------|
| `src/lib/prisma.ts` | Prisma 단일 인스턴스 (adapter-pg, Pool max:20) |
| `src/lib/qr-token.ts` | QR JWT 발급·검증 (QR_JWT_SECRET, 3분 만료) |
| `src/lib/timezone.ts` | KST 날짜/시간 유틸 (nowKST, todayKST, formatKST 등) |
| `src/lib/checkin-source.ts` | CheckInSource enum → 한국어 라벨 변환 |
| `src/lib/permissions.ts` | canWriteAdmin / canReadAdmin (AdminLevel 기반) |
| `src/lib/settings-cache.ts` | SystemSetting 30s 인메모리 캐시 |
| `src/lib/neis-meal.ts` | NEIS 급식 API 호출 + 1시간 캐시 |
| `src/lib/local-db.ts` | IndexedDB 스키마 v3 (오프라인 모드용: users, eligibleUsers, checkins) |
| `src/lib/clearClientState.ts` | SW 해제 + Cache API + IndexedDB 전체 삭제 후 signOut |
| `src/lib/fetcher.ts` | SWR 전용 fetch 래퍼 |
| `src/lib/utils.ts` | 공통 유틸 (clsx/tailwind-merge 등) |
| `src/lib/meal-kind.ts` | 서버 헬퍼: 3윈도우(조/중/석) `resolveMealKind` + `isStudentEligibleToday`(MealRegistrationMealDate 단일 조회로 자격 판정) |
| `src/lib/meal-kind-local.ts` | 클라이언트 헬퍼 (오프라인 모드 태블릿용 mealKind 결정) |
| `src/lib/meal-windows-validation.ts` | 클라이언트 검증 + 서버 에러 한국어 매핑 (관리자 설정 UI 전용) |
| `src/lib/local-checkins-export.ts` | 로컬 미동기 체크인 → .xlsx Blob (관리자 설정 모달 전용, exceljs dynamic import) |
| `src/lib/checkin-client.ts` | `/check` 페이지의 `/api/checkin` POST 재시도 클라이언트 (네트워크/5xx 3회) |
| `src/lib/meal-columns.ts` | `MealKind`/`MealColumn` 타입 + `buildMonthlyMealColumns(year, month, activeDates)` — activeDates 객체 인자(식사별 운영일)로 컬럼 삽입 (관리자 표·엑셀 헤더 생성용) |
| `src/lib/meal-plan.ts` | 식사별 공고 공용 유틸: `MEAL_LABEL`/`METHOD_LABEL`/`monthsOf`/`expandWeekdays`/`calcMealFee`/`buildAppTitle`/`studentNumberOf` (서버·클라이언트 공용) |
| `src/lib/meal-plan-server.ts` | 서버 전용: `saveApplication`(공고 생성/수정 트랜잭션)/`resyncRegistrations`(공고 수정 시 확정일 재계산)/`resolveRegistrationSelections`/`writeRegistration` |
| `src/lib/meal-stats-excel.ts` | `buildStatsWorkbook` — 공고 export 3시트(전체신청내역·요일별·에듀파인) 생성, 수식 포함 |
| `src/lib/schemas/meal-plan.ts` | zod 스키마: `adminApplicationSchema`(공고 CRUD) / `studentRegisterSchema`(학생 register) |
| `src/lib/date-range.ts` | 날짜 범위 유틸: `buildMonthDateRange(year, month)`, `dateKeyToUtcDate(dateKey)`, `formatMonthDateKey`, `getDaysInMonthUtc` — API 라우트 공통 사용 |
| `src/lib/gender.ts` | `normalizeGender` / `genderLabel` / `GENDER_LABEL` — 시트 임포트 입력 정규화 + UI 표시용 라벨, 서버·클라이언트 공용 (테스트 `__tests__/gender.test.ts`) |

## §9 인증 / 미들웨어

- `src/auth.ts`: Auth.js v5, 전략=JWT, Google OAuth + credentials(관리자)
  - signIn 콜백: email로 User 조회 (미등록 거부), role·adminLevel 토큰 주입
  - 관리자: ADMIN_USERNAME / ADMIN_PASSWORD_HASH (bcryptjs) 환경변수 비교
- `src/middleware.ts`: `export const runtime = "nodejs"` 필수 (Prisma Node.js 모듈)
  - 보호 경로: `/student`, `/teacher`, `/admin` (role별 리다이렉트)
  - `/check`는 보호 없음

## §10 환경변수 (.env.example 기준)

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 (Railway 내부) |
| `AUTH_SECRET` | NextAuth 시크릿 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth |
| `NEXT_PUBLIC_SITE_URL` | 절대 URL (prod: meal.posan.kr / test: posanmeal.up.railway.app) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | 관리자 계정 (bcryptjs 해시) |
| `QR_JWT_SECRET` | QR 토큰 서명 키 |
| `QR_TOKEN_EXPIRY_SECONDS` | QR 만료 시간 (기본 180) |
| `UPLOAD_DIR` | 사진 저장 경로 (Railway: `/app/uploads`) |
| `MAX_FILE_SIZE_MB` | 사진 최대 크기 (기본 5) |
| `TZ` | 타임존 (Asia/Seoul) |

> `AUTH_URL`, `DATABASE_PUBLIC_URL`, `RAILWAY_VOLUME_MOUNT_PATH` 는 Railway 서비스 환경에서 추가 설정.

## §11 브랜치 / 배포

| 브랜치 | 환경 | 도메인 | Railway 서비스 |
|--------|------|--------|----------------|
| `main` | prod | `meal.posan.kr` | prod (watch=main) |
| `feat/posanmeal-mvp` | test | `posanmeal.up.railway.app` | test (watch=feat/...) |

- DB(PostgreSQL) + Volume 공유. 마이그레이션은 additive 우선.
- 빌드: `npx prisma generate && next build`
- 시작: `npx prisma migrate deploy && next start`

## §12 주의사항 / 특이 패턴

- Prisma 7: `datasource.url` 은 schema.prisma 에 없음 → `prisma.config.ts` 에서 설정. 클라이언트 경로: `src/generated/prisma`
- Tailwind v4: CSS 기반 설정 (`globals.css`), `tailwind.config.ts` 없음
- `MealRegistration` upsert 패턴: 취소된 row가 있으면 UPDATE(재활성화), 없으면 INSERT. 200/201 분리 반환
- `AdminLevel` 도입: User.adminLevel(NONE/SUBADMIN/ADMIN)로 서브관리자 지원. `canWriteAdmin` = ADMIN만, `canReadAdmin` = ADMIN+SUBADMIN
- 오프라인(로컬) 모드: `SystemSetting.operationMode=local` 시 SW가 IndexedDB에 체크인 저장 → `/api/sync/upload` 로 업로드
- `CheckInSource` 필드: QR(스캔), ADMIN_MANUAL(관리자 토글), LOCAL_SYNC(오프라인 업로드) 구분
- `SwUpdater` + `ResetOnQuery`: PWA 업데이트 시 SW SKIP_WAITING → controllerchange → 페이지 리로드; ?reset=1 시 브라우저 상태 전체 초기화
- `NEIS` 급식 API: 오피스코드 D10, 학교코드 7240189, 1시간 캐시
- 사진: Volume `/app/uploads` 저장 → `/api/uploads/[filename]` 서빙
- **CheckIn unique 마이그레이션 (`20260502120000`)**: `mealKind` NOT NULL + `@@unique([userId,date,mealKind])`. SQL은 반드시 `DROP INDEX IF EXISTS "CheckIn_userId_date_key"` + `CREATE UNIQUE INDEX ...` 형태로 작성 — `DROP CONSTRAINT` 는 init 마이그레이션이 `CREATE UNIQUE INDEX` 로 만든 unique를 인식하지 못해 E42704 로 실패함
- **mealKind 시간 분기**: `lib/meal-kind.ts:resolveMealKind(now, windows)` 가 KST 시각으로 BREAKFAST/LUNCH/DINNER/null 결정 (SystemSetting `lunch_window_start/end` 추가로 3윈도우). 시간대 검증은 3윈도우 **쌍별 겹침** 검사. QR 토큰 발급 시점에 mealKind를 페이로드에 박고 (3분 만료), 체크인은 `payload.mealKind ?? resolveMealKind(...)` 로 토큰 우선
- **체크인 자격 판정**: `MealRegistrationMealDate`(오늘 날짜 + 해당 mealKind) 존재 + registration status=APPROVED. 이 테이블이 신청 확정일의 단일 진실 — 공고(MealApplicationMealDate)는 개설일일 뿐 자격 기준 아님
- **조식/중식 컬럼 노출 조건**: 관리자 석식확인·당일현황 모두 확정일(`MealRegistrationMealDate`, APPROVED) 기준으로만 BREAKFAST/LUNCH 컬럼·카드 부제 표시
- **CANCELLED 필터 필수**: CANCELLED 신청의 MealRegistrationMealDate 행은 보존됨(재신청 재활성화 대비) → 모든 집계·자격 조회에 `status=APPROVED` + `applied=true` 필터를 빼먹지 말 것
- **식사별 구조 마이그레이션**: `20260611000001`(MealKind에 LUNCH 추가, enum) + `20260611000002`(Meal/MealDate 테이블 4종 생성 + 구 데이터 백필, 멱등 `ON CONFLICT` — prod 머지 직전 수동 재실행 가능). 구 컬럼(type, applyStart/End)·구 테이블(MealApplicationDate/MealRegistrationDate)은 prod 호환용 유지, 후속 릴리스에서 정리 예정
- **테스트**: `vitest`. `npm test` 로 실행. `src/lib/__tests__/` 에 메모리 mock 기반 단위 테스트
- **User.gender 운영 영향**: 시트 임포트(`/api/admin/import`) 학생 행은 6번째 열 `gender`(남/여 등 `normalizeGender` 허용 값)가 **필수**. 기존 운영용 Google Sheet 학생 시트에 gender 컬럼을 추가해야 재임포트가 실패하지 않음. 교사 시트는 영향 없음(옵셔널)
- **관리자 사용자 관리 inline 편집**: `/admin` 사용자관리 탭은 Edit Dialog 없이 표 셀 클릭 → `EditableTextCell`/`EditableSelectCell` 로 직접 편집(학생 7컬럼, 교사 8컬럼). 부분 PUT은 `/api/admin/users` 가 Prisma `undefined = skip` 동작으로 변경된 필드만 반영하는 것에 의존. 관리 셀은 🗑️ 삭제 버튼만 남음(편집 버튼 제거)

## §13 Project-Map Maintenance

이 파일은 `project-map-keeper` 에이전트가 관리한다.

- **Targeted update**: `.claude/.project-map-pending.log` 의 경로를 읽어 구조적 변경만 surgical Edit 적용
- **Full regeneration**: 전체 트리 Glob 후 이 파일 전체 덮어쓰기
- 비구조적 변경(로직 버그 수정, 스타일 트윅 등)은 맵을 건드리지 않음
- 갱신 후 `.claude/.project-map-pending.log` 를 비움(truncate)
