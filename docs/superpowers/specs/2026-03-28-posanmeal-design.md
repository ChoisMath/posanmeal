# Posanmeal - 포산고등학교 석식 관리 웹앱 설계

## 1. 개요

### 1.1 목적
포산고등학교 학생과 교사의 석식 신청 및 QR 체크인을 관리하는 웹 애플리케이션.

### 1.2 핵심 요구사항
- 학생/교사가 Google 로그인으로 접속하여 QR 코드를 통해 석식 체크인
- 관리자는 별도 아이디/비밀번호로 로그인하여 사용자 및 석식 데이터 관리
- 식당 입구 태블릿에서 QR 스캔으로 빠른 체크인 처리
- 모든 시간 표시는 Asia/Seoul(KST) 기준
- 다크모드/라이트모드 전환 지원

### 1.3 사용자 역할
| 역할 | 인증 방식 | 주요 기능 |
|------|-----------|-----------|
| 학생 | Google OAuth | QR 표시, 개인정보 확인, 체크인 이력 조회 |
| 교사 (비담임) | Google OAuth | 개인석식/근무 QR 표시, 개인정보 수정, 체크인 이력 조회 |
| 교사 (담임) | Google OAuth | 위 + 학급 학생 석식 관리 |
| 관리자 | username/password | 사용자 CRUD, Spreadsheet 가져오기, 대시보드, Excel 다운로드 |

---

## 2. 기술 스택

| 항목 | 기술 |
|------|------|
| 프레임워크 | Next.js 14+ (App Router) |
| 언어 | TypeScript |
| DB | PostgreSQL (Railway) + Prisma ORM |
| 인증 | NextAuth.js (Google OAuth + Admin credentials) |
| QR 생성 | `qrcode` 라이브러리 (JWT 토큰 인코딩) |
| QR 스캔 | `html5-qrcode` (카메라 기반 브라우저 스캔) |
| 파일 저장 | Railway Volume (`/app/uploads`) |
| 엑셀 다운로드 | `exceljs` |
| 스타일링 | Tailwind CSS + shadcn/ui |
| 테마 | `next-themes` (다크/라이트 모드) |
| 이미지 처리 | `sharp` (리사이즈, WebP 변환) |
| 배포 | Railway (단일 서비스) |

---

## 3. 데이터 모델

### 3.1 Prisma Schema

```prisma
enum Role {
  STUDENT
  TEACHER
}

enum CheckInType {
  STUDENT
  WORK
  PERSONAL
}

model Admin {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  role      Role
  // 학생 전용
  grade     Int?          // 학년
  classNum  Int?          // 반
  number    Int?          // 번호
  // 교사 전용
  subject   String?       // 교과명
  homeroom  String?       // 담임 (예: "2-6", 비어있으면 담임 아님)
  position  String?       // 직책
  // 공통
  photoUrl  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  mealPeriod MealPeriod?
  checkIns   CheckIn[]
}

model MealPeriod {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique
  startDate DateTime @db.Date
  endDate   DateTime @db.Date
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model CheckIn {
  id        Int         @id @default(autoincrement())
  userId    Int
  date      DateTime    @db.Date
  checkedAt DateTime    @default(now())
  type      CheckInType

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, date])
}
```

### 3.2 핵심 제약조건
- `User.email`: unique — Google 로그인 및 Spreadsheet 가져오기 시 이메일 기준 upsert
- `CheckIn(userId, date)`: unique — 하루에 한 번만 체크인 가능
- `MealPeriod.userId`: unique — 학생당 단일 석식 신청 기간 (변경 시 기존 레코드 업데이트)

---

## 4. 인증

### 4.1 Google OAuth (학생/교사)
- NextAuth.js Google Provider 사용
- 로그인 시 email로 User 테이블 조회
- 등록된 email → role에 따라 `/student` 또는 `/teacher`로 리다이렉트
- 미등록 email → "등록되지 않은 사용자입니다" 안내

### 4.2 관리자 인증
- NextAuth.js Credentials Provider 사용
- username/password 로그인 → Admin 테이블 조회 → bcrypt 비밀번호 검증
- 환경변수 `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`로 초기 관리자 설정

---

## 5. 라우팅

### 5.1 페이지

| 경로 | 접근 권한 | 설명 |
|------|-----------|------|
| `/` | 공개 | 랜딩 페이지 (Google 로그인 버튼) |
| `/student` | 학생 | 학생 메인 (QR, 개인정보, 확인 탭) |
| `/teacher` | 교사 | 교사 메인 (개인석식, 근무, [학생관리], 개인정보 탭) |
| `/check` | 공개 | QR 스캔 페이지 (식당 태블릿) |
| `/admin/login` | 공개 | 관리자 로그인 |
| `/admin` | 관리자 | 관리자 대시보드 |

### 5.2 API Routes

| API | 메서드 | 설명 |
|-----|--------|------|
| `/api/auth/[...nextauth]` | — | NextAuth 핸들러 |
| `/api/checkin` | POST | QR 체크인 처리 |
| `/api/qr/token` | GET | QR 토큰 생성 (JWT, 3분 만료) |
| `/api/admin/import` | POST | Google Spreadsheet CSV 가져오기 |
| `/api/admin/users` | GET/POST/PUT/DELETE | 사용자 CRUD |
| `/api/admin/meal-periods` | GET/POST/PUT | 석식 신청 기간 관리 |
| `/api/admin/dashboard` | GET | 석식 현황 통계 |
| `/api/admin/export` | GET | 엑셀 다운로드 |
| `/api/users/me` | GET/PUT | 본인 정보 조회/수정 |
| `/api/users/me/photo` | POST/DELETE | 사진 업로드/삭제 |
| `/api/checkins` | GET | 본인 체크인 이력 (월별 조회) |
| `/api/teacher/students` | GET | 담임 학급 학생 목록 + 체크인 현황 |

---

## 6. 핵심 기능 상세

### 6.1 QR 토큰 및 체크인

**QR 토큰 구조 (JWT):**
```json
{
  "userId": 123,
  "role": "STUDENT",
  "type": "STUDENT",
  "iat": 1774686000,
  "exp": 1774686180
}
```

- 교사는 "개인석식" 탭에서 `type: "PERSONAL"`, "근무" 탭에서 `type: "WORK"` QR 생성
- JWT 만료: 생성 시점 + 3분 (180초)
- QR 탭 화면에 남은 유효 시간 카운트다운 표시
- 만료 30초 전에 자동으로 새 토큰 요청 → QR 갱신 (끊김 없이)

**체크인 흐름 (POST /api/checkin):**
1. JWT 토큰 검증 (서명 + 만료)
2. 만료된 토큰 → "QR이 만료되었습니다. 새로고침 해주세요"
3. 날짜 확인 (KST 기준 오늘)
4. 중복 체크 (userId + date unique 제약조건)
5. 학생인 경우: 석식 신청 기간(MealPeriod) 내인지 확인
6. DB INSERT → 성공/중복/미신청 결과 반환
7. 목표 응답 시간: 50ms 이내

**체크인 페이지 (/check) UI 동작:**
- 성공: 초록 배경 + 사진, 이름, 반/번호, "석식 체크인 되었습니다" → 2초 후 초기화
- 중복: 빨간 배경 + "이미 Checkin 되었습니다. 확인해 주세요" → 2초 후 초기화
- 교사: "03월 28일 17:32시 {개인/근무}로 석식 체크인 되었습니다"

### 6.2 Google Spreadsheet CSV 가져오기

**동작 방식:**
1. 관리자가 공개 Spreadsheet URL 입력
2. 서버에서 URL → CSV 내보내기 URL 변환 (gid 추출, `/export?format=csv&gid=N`)
3. 시트별 CSV 파싱:
   - 학생 시트: email, 학년, 반, 번호, 이름, 석식시작일, 석식종료일
   - 교사 시트: email, 교과명, 담임(예: "2-6"), 직책, 이름
4. 데이터 검증 후 DB upsert (email 기준)
5. 결과 표시: "학생 45명, 교사 12명 등록 완료"

**전제 조건:** Spreadsheet는 "링크가 있는 모든 사용자에게 공개"로 설정

### 6.3 사진 업로드

- 학생: 사진만 수정 가능 (다른 개인정보 수정 불가)
- 교사: Google 계정 email 제외 모든 정보 수정 가능
- 업로드: FormData로 전송, 최대 5MB
- 서버 처리: `sharp`로 300x300 리사이즈, WebP 변환
- 저장: Railway Volume `/app/uploads/{userId}.webp`

### 6.4 월별 체크인 이력 조회

- 학생 "확인" 탭 / 교사 체크인 이력 페이지
- 캘린더 형태로 월별 표시
- 체크인한 날짜에 마크 표시 + 체크인 시각
- 이전/다음 월 이동 가능
- 과거 기록 모두 보존 (석식 신청 기간 변경과 무관)

### 6.5 담임교사 학생관리

- 담임 교사(homeroom 필드가 비어있지 않은 교사)만 "학생관리" 탭 노출
- homeroom 값(예: "2-6")으로 해당 학년/반 학생 필터링
- 학생별: 사진, 이름, 번호, 석식 신청 여부, 당월 체크인 현황

---

## 7. 화면 구성

### 7.1 학생 페이지 (/student) — 3탭
- **QR 탭**: 석식 신청 기간 내 → QR 코드 + 카운트다운 표시 / 기간 외 → "현재 석식 신청 기간이 아닙니다"
- **개인정보 탭**: 학년, 반, 번호, 이름, 사진 표시. 사진만 수정 가능
- **확인 탭**: 월별 캘린더로 체크인 이력 조회

### 7.2 교사 페이지 (/teacher) — 담임 4탭 / 비담임 3탭
- **개인석식 탭**: type=PERSONAL QR 코드 + 카운트다운
- **근무 탭**: type=WORK QR 코드 + 카운트다운
- **학생관리 탭** (담임만): 학급 학생 석식 신청/체크인 현황
- **개인정보 탭**: 교과명, 담임여부, 직책, 이름, 사진. email 제외 모두 수정 가능

### 7.3 체크인 페이지 (/check)
- 상단: QR 카메라 영역 (항상 활성)
- 하단: 체크인 결과 표시 영역
- 로그인 불필요 (공개 접근)

### 7.4 관리자 페이지 (/admin)
- Spreadsheet URL 입력 + Data 호출 버튼
- 탭: 학생 관리, 교사 관리, 석식 현황
- +추가 버튼 → 오버레이 모달 (학생/교사/석식기간 직접 입력)
- 일자별/월별 석식 현황 대시보드
- Excel 다운로드 버튼

### 7.5 공통 UI
- 다크모드/라이트모드 토글 (헤더에 배치, `next-themes` + `localStorage` 저장)
- 초기값: 시스템 설정(`prefers-color-scheme`) 따름

---

## 8. 프로젝트 디렉토리 구조

```
posanmeal/
├── prisma/
│   └── schema.prisma
├── public/
│   └── uploads/                   # Railway Volume 마운트
├── src/
│   ├── app/
│   │   ├── layout.tsx             # 루트 레이아웃 (테마 프로바이더)
│   │   ├── page.tsx               # 랜딩 (Google 로그인)
│   │   ├── student/page.tsx
│   │   ├── teacher/page.tsx
│   │   ├── check/page.tsx
│   │   ├── admin/
│   │   │   ├── login/page.tsx
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── checkin/route.ts
│   │       ├── qr/token/route.ts
│   │       ├── users/me/route.ts
│   │       ├── users/me/photo/route.ts
│   │       ├── checkins/route.ts
│   │       ├── teacher/students/route.ts
│   │       └── admin/
│   │           ├── import/route.ts
│   │           ├── users/route.ts
│   │           ├── meal-periods/route.ts
│   │           ├── dashboard/route.ts
│   │           └── export/route.ts
│   ├── components/
│   │   ├── ui/                    # shadcn/ui
│   │   ├── ThemeToggle.tsx
│   │   ├── QRGenerator.tsx
│   │   ├── QRScanner.tsx
│   │   ├── MonthlyCalendar.tsx
│   │   ├── StudentTable.tsx
│   │   └── PhotoUpload.tsx
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── auth.ts
│   │   ├── jwt.ts
│   │   └── timezone.ts
│   └── providers/
│       ├── AuthProvider.tsx
│       └── ThemeProvider.tsx
├── .env
├── .gitignore
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 9. 환경변수

```env
DATABASE_URL="postgresql://user:pass@host:port/db"
NEXTAUTH_URL="https://posanmeal.up.railway.app"
NEXTAUTH_SECRET="random-secret-key"
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="xxx"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD_HASH="bcrypt-hashed-password"
QR_JWT_SECRET="separate-secret-for-qr"
QR_TOKEN_EXPIRY_SECONDS=180
UPLOAD_DIR="/app/uploads"
MAX_FILE_SIZE_MB=5
TZ="Asia/Seoul"
```

---

## 10. Railway 배포

| 항목 | 설정 |
|------|------|
| 서비스 | Next.js (단일 서비스) |
| PostgreSQL | Railway 내장 PostgreSQL 플러그인 |
| Volume | `/app/uploads`에 마운트 |
| 빌드 명령 | `npx prisma generate && npm run build` |
| 시작 명령 | `npx prisma migrate deploy && npm start` |
| Node 버전 | 20.x |

---

## 11. 검증 방법

### 11.1 로컬 테스트
1. `docker compose up -d` (PostgreSQL)
2. `npx prisma migrate dev`
3. `npm run dev`
4. Google OAuth는 로컬에서 `http://localhost:3000` 콜백 설정

### 11.2 기능별 검증
- **Google 로그인**: 등록된/미등록된 이메일로 로그인 시도
- **QR 생성/갱신**: QR 탭 진입 → 3분 카운트다운 → 자동 갱신 확인
- **QR 체크인**: `/check` 페이지에서 QR 스캔 → 성공/중복/만료 시나리오
- **Spreadsheet 가져오기**: 공개 Spreadsheet URL로 학생/교사 데이터 import
- **사진 업로드**: 5MB 이하 이미지 업로드 → WebP 변환 확인
- **월별 이력**: 체크인 기록 후 월 이동하며 이력 조회
- **담임 학생관리**: 담임 교사 로그인 → 학급 학생 체크인 현황 확인
- **관리자 CRUD**: 학생/교사 추가, 수정, 삭제, 석식 기간 변경
- **Excel 다운로드**: 월별/일자별 석식 현황 다운로드
- **다크/라이트 모드**: 토글 → 새로고침 후에도 유지 확인
