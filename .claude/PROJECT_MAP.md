# Project Map — PosanMeal

> Last full regeneration: 2026-05-02

## §1 개요

포산고등학교 학생/교사 석식(및 조식) 신청·QR 체크인 관리 웹앱.
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
│   │   └── page.tsx             # 관리자 대시보드
│   └── api/                     # Route Handlers (§5 참조)
├── components/                  # (§7 참조)
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
| `/api/users/me` | GET/PUT | 학생/교사 | 본인 프로필 조회/수정 |
| `/api/users/me/photo` | POST/DELETE | 학생/교사 | 사진 업로드/삭제 |
| `/api/uploads/[filename]` | GET | 공개 | Volume에서 사진 파일 서빙 |
| `/api/meals` | GET | 공개 | NEIS API 급식 메뉴 조회 (?date=YYYYMMDD) |
| `/api/applications` | GET | 로그인 | 신청 가능한 공고 목록 (현재 OPEN, 기간 내) |
| `/api/applications/my` | GET | 로그인 | 본인 신청 이력 전체 |
| `/api/applications/[id]/register` | POST | 학생 | 석식/조식 신청 (취소된 row 재활성화 포함) |
| `/api/applications/[id]/register` | DELETE | 학생 | 신청 취소 |

### 교사

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/teacher/students` | GET | 교사 | 담임 학급 학생 목록 |

### 관리자

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/admin/users` | CRUD | 관리자 | 사용자 관리 |
| `/api/admin/import` | POST | 관리자 | Spreadsheet CSV 사용자 가져오기 |
| `/api/admin/checkins` | GET | 관리자 | 월별 체크인 (category: teacher/1/2/3) |
| `/api/admin/checkins/toggle` | POST | 관리자 | 체크인 수동 토글 (학생: on/off, 교사: cycle WORK→PERSONAL→삭제) |
| `/api/admin/dashboard` | GET | 관리자 | 당일 석식 현황 |
| `/api/admin/export` | GET | 관리자 | 월별 Excel 다운로드 |
| `/api/admin/applications` | GET/POST | 관리자 | 신청 공고 목록 조회 / 신규 생성 |
| `/api/admin/applications/[id]` | PUT/DELETE | 관리자 | 신청 공고 수정/삭제 |
| `/api/admin/applications/[id]/close` | POST | 관리자 | 신청 공고 강제 마감 |
| `/api/admin/applications/[id]/registrations` | GET/POST | 관리자 | 공고별 신청자 목록 조회 / 관리자 직접 추가 |
| `/api/admin/applications/[id]/registrations/[regId]` | PATCH | 관리자 | 신청 상태 변경 (APPROVED/CANCELLED) |
| `/api/admin/applications/[id]/export` | GET | 관리자 | 신청 공고 신청명단 / 일괄신청 양식 엑셀 다운로드 |
| `/api/admin/applications/[id]/import` | POST | 관리자 | 엑셀 양식으로 일괄 신청 등록 |

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
| `User` | id, email, name, role(STUDENT/TEACHER), grade?, classNum?, number?, subject?, homeroom?, position?, photoUrl?, adminLevel(NONE/SUBADMIN/ADMIN) | checkIns, registrations | @@index([role,grade,classNum,number]), @@index([role,adminLevel]) |
| `MealApplication` | id, title, description?, type(DINNER/BREAKFAST/OTHER), applyStart/End(@db.Date), mealStart/End?(@db.Date), status(OPEN/CLOSED) | registrations | @@index([status]), @@index([applyStart,applyEnd]) |
| `MealRegistration` | id, applicationId, userId, signature(Text), status(APPROVED/CANCELLED), cancelledAt?, cancelledBy?, addedBy? | application, user | @@unique([applicationId,userId]) — 취소 후 재신청 시 row 재활성화 |
| `CheckIn` | id, userId, date(@db.Date), checkedAt, type(STUDENT/WORK/PERSONAL), source?(QR/ADMIN_MANUAL/LOCAL_SYNC) | user | @@unique([userId,date]) |
| `SystemSetting` | key(PK), value, updatedAt | — | operationMode(online/local), qrGeneration(정수) |

### Enums
- `Role`: STUDENT, TEACHER
- `CheckInType`: STUDENT, WORK, PERSONAL
- `CheckInSource`: QR, ADMIN_MANUAL, LOCAL_SYNC
- `AdminLevel`: NONE, SUBADMIN, ADMIN

> `MealPeriod` 는 제거됨. 신청 기간은 `MealApplication.applyStart/End` 로 관리.

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

## §13 Project-Map Maintenance

이 파일은 `project-map-keeper` 에이전트가 관리한다.

- **Targeted update**: `.claude/.project-map-pending.log` 의 경로를 읽어 구조적 변경만 surgical Edit 적용
- **Full regeneration**: 전체 트리 Glob 후 이 파일 전체 덮어쓰기
- 비구조적 변경(로직 버그 수정, 스타일 트윅 등)은 맵을 건드리지 않음
- 갱신 후 `.claude/.project-map-pending.log` 를 비움(truncate)
