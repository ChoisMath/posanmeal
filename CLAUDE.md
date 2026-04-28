@AGENTS.md

# Posanmeal — 포산고등학교 석식 관리 웹앱

## 프로젝트 개요

학생/교사가 Google 로그인 후 QR 코드로 석식 체크인하고, 관리자가 사용자 및 석식 데이터를 관리하는 시스템. 대한민국 Seoul 시간대(KST) 기준.

- **설계 스펙**: `docs/superpowers/specs/2026-03-28-posanmeal-design.md`
- **구현 계획**: `docs/superpowers/plans/2026-03-28-posanmeal-implementation.md`

## 기술 스택

| 항목 | 버전/기술 |
|------|-----------|
| 프레임워크 | Next.js 16.2 (App Router, Turbopack) |
| 언어 | TypeScript, React 19 |
| DB | PostgreSQL (Railway) + Prisma 7 (adapter-pg) |
| 인증 | Auth.js v5 (next-auth@beta) — Google OAuth + 관리자 credentials |
| QR 스캔 | nimiq/qr-scanner (Web Worker + BarcodeDetector API 자동 활용) |
| QR 생성 | qrcode (JWT 토큰 → QR 이미지) |
| 스타일링 | Tailwind CSS v4 (CSS 기반 설정, tailwind.config.ts 없음) + shadcn/ui |
| 테마 | next-themes (다크/라이트 모드) |
| 이미지 | sharp (300x300 WebP 변환) |
| 엑셀 | exceljs |
| 배포 | Railway (단일 서비스 + PostgreSQL + Volume) |

## 핵심 아키텍처 결정사항

### Prisma 7 어댑터 패턴
- Prisma 7에서는 `datasource.url`을 schema에 넣지 않음 → `prisma.config.ts`에서 설정
- `@prisma/adapter-pg` + `pg.Pool`로 직접 커넥션 풀 관리 (max: 20)
- 클라이언트 생성 경로: `src/generated/prisma/client`
- Import: `import { PrismaClient } from "@/generated/prisma/client"`

### 인증 구조
- 학생/교사: Google OAuth → email로 User 테이블 조회 → role에 따라 라우팅
- 관리자: 환경변수 `ADMIN_USERNAME` / `ADMIN_PASSWORD`로 직접 비교 (DB 미사용)
- 미등록 email은 로그인 거부

### QR 체크인 흐름
- JWT 토큰 3분 만료, 30초 전 자동 갱신
- `/check` 페이지는 공개 (인증 불필요) — 식당 입구 태블릿용
- nimiq/qr-scanner: Web Worker 기반, BarcodeDetector API 자동 fallback
- 기본 전방카메라(user), 다중카메라 기기에서 전환 버튼 표시
- 상태별 사운드 피드백 (AudioContext): 승인=딩동 차임, 중복=긴 삐, 오류=삐삐
- 체크인 결과 2초 표시 후 자동 초기화, 태블릿에서 카메라/결과 좌우 분할

### 사진 저장
- Railway Volume `/app/uploads`에 저장
- `/api/uploads/[filename]` API Route로 서빙 (Next.js static이 아닌 API 경유)
- photoUrl 형식: `/api/uploads/{userId}.webp?t={timestamp}`

## 브랜치 전략 (2026-04-14 개정)

- **`feat/posanmeal-mvp`** — **개발 + 배포 브랜치** (Railway가 이 브랜치를 watch). 모든 신규 작업은 여기서 직접 commit & push.
- **`main`** — 과거 기준 브랜치. 현재는 사용하지 않으며 `feat/posanmeal-mvp`보다 뒤처진 상태로 남아있을 수 있음.
- 워크플로우: `feat/posanmeal-mvp`에서 직접 작업 → commit → `git push origin feat/posanmeal-mvp` → Railway 자동 배포.
- 별도 테스트 환경 없음 (배포 환경에서 바로 검증).

## 라우팅 구조

| 경로 | 접근 | 설명 |
|------|------|------|
| `/` | 공개 | 랜딩 (Google 로그인) |
| `/student` | 학생 | 3탭: QR, 개인정보, 확인 |
| `/teacher` | 교사 | 담임 5탭(개인석식,근무,확인,학생관리,개인정보) / 비담임 4탭 |
| `/check` | 공개 | QR 스캐너 (태블릿, 좌우 분할 레이아웃) |
| `/admin/login` | 공개 | 관리자 로그인 |
| `/admin` | 관리자 | 3탭: 사용자관리(Sheet연결 모달), 석식확인(교사/학년별), 당일현황 |

## API Routes

| API | 메서드 | 인증 | 설명 |
|-----|--------|------|------|
| `/api/auth/[...nextauth]` | * | — | Auth.js 핸들러 |
| `/api/checkin` | POST | 공개 | QR 체크인 (JWT 토큰 검증) |
| `/api/qr/token` | GET | 학생/교사 | QR JWT 토큰 발급 (3분 만료) |
| `/api/checkins` | GET | 학생/교사 | 본인 월별 체크인 이력 |
| `/api/users/me` | GET/PUT | 학생/교사 | 본인 프로필 조회/수정 |
| `/api/users/me/photo` | POST/DELETE | 학생/교사 | 사진 업로드/삭제 |
| `/api/uploads/[filename]` | GET | 공개 | 사진 파일 서빙 |
| `/api/teacher/students` | GET | 교사 | 담임 학급 학생 목록 |
| `/api/admin/import` | POST | 관리자 | Spreadsheet CSV 가져오기 |
| `/api/admin/users` | CRUD | 관리자 | 사용자 관리 |
| `/api/admin/meal-periods` | PUT | 관리자 | 석식 기간 관리 |
| `/api/admin/checkins` | GET | 관리자 | 월별 체크인 (category: teacher/1/2/3) |
| `/api/admin/dashboard` | GET | 관리자 | 당일 석식 현황 |
| `/api/admin/export` | GET | 관리자 | 월별 Excel 다운로드 |

## DB 스키마 (prisma/schema.prisma)

- `Admin` — 관리자 (현재 미사용, 환경변수 방식으로 대체)
- `User` — 학생/교사 통합 (role: STUDENT/TEACHER)
- `MealPeriod` — 학생 석식 신청 기간 (userId unique, 단일 기간)
- `CheckIn` — 체크인 기록 (userId+date unique, type: STUDENT/WORK/PERSONAL)
- 인덱스: `User(role,grade,classNum,number)`, `CheckIn(date)`, `CheckIn(userId)`

## 환경변수 (.env.example 참조)

```
DATABASE_URL, DATABASE_PUBLIC_URL
AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_URL
ADMIN_USERNAME, ADMIN_PASSWORD
QR_JWT_SECRET, QR_TOKEN_EXPIRY_SECONDS (180)
UPLOAD_DIR (/app/uploads on Railway)
MAX_FILE_SIZE_MB (5)
TZ (Asia/Seoul)
```

## Railway 배포 설정

- 빌드: `npx prisma generate && npm run build`
- 시작: `npx prisma migrate deploy && npm start`
- Volume: `uploads` → `/app/uploads`
- PostgreSQL: Reference variable `${{Postgres.DATABASE_URL}}`
- 도메인: `https://posanmeal.up.railway.app`

## 성능 최적화 (적용 완료)

- DB 인덱스 5개 추가 (role+grade+classNum+number, date, userId)
- pg.Pool 커넥션 풀 (max: 20, 타임아웃 설정)
- Spreadsheet 임포트: `$transaction` 배치 처리 (950쿼리 → 2~3)
- Auth 콜백: signIn에서 count(), jwt에서 select({id, role})
- 체크인 API: Promise.all 병렬 쿼리
- Dashboard: Prisma groupBy SQL 집계
- MonthlyCalendar: Map O(1) 룩업

## 개발 명령어

```bash
docker compose up -d          # 로컬 PostgreSQL 시작
npx prisma migrate dev        # 마이그레이션 적용
npx prisma db seed            # 관리자 시드
npm run dev                   # 개발 서버 (http://localhost:3000)
npm run build                 # 프로덕션 빌드
```

## 디자인 시스템

- **Warm Modern** 테마: 앰버/골드 primary, OKLCH 색상 (라이트/다크)
- `globals.css` 유틸리티 클래스: `glass` (글래스모피즘), `card-elevated` (따뜻한 섀도), `bg-warm-gradient`, `header-gradient`, `bg-warm-subtle`, `page-enter` (진입 애니메이션)
- `text-fit-sm/base/lg`: `clamp()` + `nowrap`으로 모바일 텍스트 스케일링
- 카드: `card-elevated rounded-2xl border-0` 패턴
- 헤더: `header-gradient` 앰버 그라데이션 (학생/교사/관리자 공통)
- 모달: 라운드 Input (`rounded-xl`), 자연스러운 중앙 위치

## 주요 컴포넌트

| 컴포넌트 | 설명 |
|----------|------|
| `QRScanner` | nimiq/qr-scanner 래퍼, 카메라 전환 버튼, 사운드는 check 페이지에서 처리 |
| `QRGenerator` | JWT 토큰 → QR 이미지 (type: STUDENT/WORK/PERSONAL) |
| `MonthlyCalendar` | 월별 달력, `showType` prop으로 근무/개인 구분 표시 |
| `StudentTable` | 담임교사용 학생 석식 테이블 (틀고정, 합계행, 주말 하이라이트) |
| `AdminMealTable` | 관리자 석식 확인 (교사/1~3학년 탭, 월 이동, 합계행) |
| `PhotoUpload` | 프로필 사진 업로드/삭제 |

## 주의사항

- Tailwind v4는 CSS 기반 설정 (`src/app/globals.css`에 `@custom-variant dark`). tailwind.config.ts 없음
- Next.js 16은 middleware 대신 "proxy" 권장하지만 현재 middleware 사용 중 (동작에 문제 없음)
- `src/middleware.ts`에 `export const runtime = "nodejs"` 필수 (Prisma가 Node.js 모듈 사용)
- shadcn/ui의 toast는 sonner로 대체됨 (`src/components/ui/sonner.tsx`)
