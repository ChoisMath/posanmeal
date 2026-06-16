# 담임교사 학생관리·신청현황 개편 + 사진 저장 경로 수정

> 작성일 2026-06-16 · 대상 브랜치 `feat/posanmeal-mvp`(test 먼저) → `main`

## 배경 / 문제

2026-06-11 식사별(조/중/석, `MealKind`) 신청 구조 대개편 이후, 담임교사 `/teacher` 의 **"학생관리" 탭**(`StudentTable`)이 옛 구조에 머물러 있다.

- `StudentTable` 은 체크인을 `getDate()` 로만 묶어 하루 1칸에 "O" 를 찍고 `mealKind` 를 완전히 무시한다 → 조/중/석 구분이 화면에 반영되지 않는다.
- 교사 API(`/api/teacher/students`)는 관리자 API(`/api/admin/checkins`)와 달리 `mealColumns` 를 만들지 않고 신청 정보도 내려주지 않는다.

추가로 담임교사에게 (a) 학생별 식사 신청 여부를 한눈에 보는 음영 표시, (b) 관리자가 만든 급식신청공고별 우리 반 신청 현황(신청시간·서명) 조회 기능이 필요하다. 마지막으로 프로필 사진 저장 경로의 영속성을 점검한다.

## 목표

1. 담임 "학생관리" 탭을 관리자 "급식확인"과 동일한 식사별(조/중/석) 표 형태로 재구성한다. (읽기 전용)
2. 각 학생이 해당 식사를 **신청하지 않은 칸은 회색 음영**, **신청한 칸은 흰색 배경**으로 표시한다. 체크인 완료 칸은 식사색 배경 + "O".
3. 담임에게 **"신청현황" 탭**을 추가한다. 관리자가 만든 공고 목록을 보여주고, 제목 클릭 시 **우리 반 승인(APPROVED) 신청자**의 명단·신청시간·서명 이미지를 표시한다.
4. 프로필 사진을 Railway **Volume**에 저장하도록 수정해 재배포 시 유실을 막는다. 서명 이미지 저장 방식을 점검·문서화한다.

## 비목표

- 담임이 체크인을 수정(토글)하는 기능 — 읽기 전용으로 한다. 체크인 수정은 관리자만.
- 신청 음영을 위한 신규 DB 컬럼/마이그레이션 — 기존 테이블 조회만으로 구현한다.
- 서명 이미지를 파일로 옮기는 작업 — 현행 DB(base64) 저장 유지.

## 데이터 모델 (기존 재사용, 변경 없음)

- 신청 확정일의 단일 진실: `MealRegistrationMealDate`(`registration.status="APPROVED"` + `MealRegistrationMeal.applied=true`). 음영·컬럼 생성 모두 이 기준.
- 식사 컬럼 생성: `lib/meal-columns.ts:buildMonthlyMealColumns(year, month, activeDates)` 재사용. 조/중은 `activeDates` 에 든 날짜에만, 석은 매일 컬럼 생성.
- 서명: `MealRegistration.signature String @db.Text` — `SignaturePad` 가 `toDataURL("image/png")` 로 만든 base64 데이터 URL. 관리자 대리 등록은 `(관리자 등록)` 등 텍스트가 들어감.

## 설계

### 1 & 2. 담임 "학생관리" 탭 재구성 + 신청 음영

**API `GET /api/teacher/students` 수정** (`src/app/api/teacher/students/route.ts`)

응답에 다음을 추가한다. 기존 인증(role=TEACHER + homeroom "2-6" 파싱)은 유지.

```jsonc
{
  "grade": 2, "classNum": 6,
  "mealColumns": [ /* MealColumn[] — 우리 반 승인 조/중 신청일 기준 */ ],
  "students": [
    {
      "id": 1, "name": "홍길동", "number": 1, "photoUrl": null,
      "checkIns": [{ "date": "2026-06-02", "mealKind": "DINNER", "checkedAt": "...", "type": "STUDENT" }],
      "appliedDates": [{ "date": "2026-06-02", "mealKind": "DINNER" }]  // APPROVED + applied
    }
  ]
}
```

- `mealColumns`: 우리 반 학생들의 `MealRegistrationMealDate`(APPROVED, mealKind in BREAKFAST/LUNCH, 해당 월) distinct 날짜로 `activeDates` 를 구성해 `buildMonthlyMealColumns` 호출.
- `appliedDates`: 학생별 `MealRegistrationMealDate`(APPROVED, applied, 해당 월) 의 `{date, mealKind}` 집합. CANCELLED·applied=false 는 제외.
- `checkIns`: 기존대로 해당 월, `mealKind`·`type` 포함.

**`StudentTable.tsx` 재작성** (읽기 전용) — 관리자 `MealGrid`(`AdminMealTable.tsx`) 골격을 학생 단일 카테고리로 이식:

- 레이아웃: 좌측 "번호 이름" 고정 컬럼, 식사별 컬럼(헤더: 일자 + 조/중/석 단축 라벨, 주말 적색, 식사색 틴트), sticky 헤더, 우측 "합계" 고정 컬럼, 하단 일자별 합계행. 래퍼 `overflow-auto`, 셀 `whitespace-nowrap`.
- 셀 키: `getDateDayKey(date) + ":" + mealKind` 로 `MealColumn.key` 와 매칭.
- **셀 배경 규칙** (우선순위 순):
  1. 체크인 있음 → 식사색 배경 + 굵은 "O" (조=sky, 중=orange, 석=green). `colHoverStyle`·title(체크 시각)은 관리자와 동일 패턴.
  2. 신청함(appliedDates 에 존재) · 체크인 없음 → 흰색/기본 배경, 빈 칸.
  3. 신청 안 함 → **회색 음영**(`bg-muted` 계열), 빈 칸.
  - 주말은 헤더에만 적색 틴트. 본문 셀은 위 규칙(미신청이면 자연히 회색)을 따른다.
- 합계행: **식사 컬럼별** 체크인 인원 합계(관리자 `MealGrid` 의 `dailyTotals` 와 동일하게 `mealColumns` 단위) + 학생별 우측 합계(체크인 수). 
- 셀 클릭/토글 없음.

`useTeacherStudents` 훅(`src/hooks/useTeacherStudents.ts`) 의 타입을 새 응답(`mealColumns`, `appliedDates`, `mealKind`/`type` 포함, LUNCH 포함)에 맞춰 갱신.

### 3. "신청현황" 탭 신규

**신규 API 2개** — 인증: `session.user.role === "TEACHER"` + 본인 `homeroom` 존재. 반환 학생은 반드시 담임 학급(grade,classNum)으로 한정(권한 경계).

- `GET /api/teacher/applications` → 전체 공고 목록(상태 무관, `id desc`).
  ```jsonc
  { "applications": [ { "id", "title", "status", "startYear", "startMonth", "monthCount", "applyStartAt", "applyEndAt", "meals": [{ "mealKind", "method" }] } ] }
  ```
- `GET /api/teacher/applications/[id]/registrations` → 우리 반 **APPROVED** 신청자만.
  ```jsonc
  {
    "application": { "id", "title", "meals": [{ "mealKind", "method", "exemptionSelectable" }] },
    "registrations": [
      { "id", "createdAt", "addedBy",
        "user": { "number", "name" },
        "signature": "data:image/png;base64,...",   // 또는 "(관리자 등록)" 텍스트
        "meals": [{ "mealKind", "applied", "exempt", "dayCount" }] }
    ]
  }
  ```
  - `dayCount` 는 `mealRegistrationMealDate.groupBy` 로 집계(관리자 registrations 라우트와 동일 패턴).
  - 정렬: `user.number asc`.

**`TeacherApplications.tsx` 신규** (`src/components/`) — 마스터-디테일(탭 내부 상태 전환):

- 목록 뷰: 공고 카드 리스트(제목 / 대상월·신청기간 / 상태 배지). 제목(또는 카드) 클릭 → `selectedAppId` 설정.
- 상세 뷰: 상단 "← 목록" 버튼 + 공고 제목. 우리 반 신청자 표:
  - 컬럼: 번호 · 이름 · 신청시간(`formatDateTimeKST(createdAt)`) · 식사별 신청(조/중/석 일수, `MEAL_THEME` 색) · **서명**.
  - 서명 칸: `signature` 가 `data:image` 로 시작하면 `<img>` 썸네일(흰 배경, 높이 ~40px), 클릭 시 확대 모달. 아니면 "관리자" 배지(대리 등록).
  - 표 규칙: 래퍼 `overflow-auto`, sticky 헤더, 셀 `whitespace-nowrap`.
- 데이터: `useSWR` + `fetcher`.

**`teacher/page.tsx`**: homeroom 일 때 `TabsList` 를 `grid-cols-5`→`grid-cols-6`, "학생관리" 다음에 "신청현황" `TabsTrigger`/`TabsContent` 추가. 라벨 `whitespace-nowrap`, `text-xs sm:text-sm` 유지(6열 모바일 폭 점검).

### 4. 사진 저장 경로 수정 (→ Volume)

현행 진단:
- `api/users/me/photo/route.ts:8` 가 `path.join(process.cwd(), "public", "uploads")` 로 **하드코딩**, `process.env.UPLOAD_DIR`(=Railway `/app/uploads` 볼륨) 무시. Railway 컨테이너의 `public/uploads` 는 임시 저장소 → **재배포 시 사진 유실**.
- `api/uploads/[filename]/route.ts` 는 현재 `/uploads/...` 정적 경로로 redirect 만 한다(2026-05-06 빌드경고 정리 때 readFile 제거).

수정:
- `api/users/me/photo/route.ts`: `const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads")` (로컬 폴백). POST 는 이 경로에 `{userId}.webp` 저장, photoUrl 을 `/api/uploads/{userId}.webp?t=${Date.now()}` 로 발급. DELETE 도 같은 경로에서 unlink.
- `api/uploads/[filename]/route.ts`: `export const runtime = "nodejs"`. `UPLOAD_DIR/{safeName}` 을 `readFile` 로 스트리밍(Content-Type webp, 적절한 Cache-Control). 파일이 없으면 기존 `/uploads/{safeName}` 정적 경로로 redirect(구 photoUrl 호환 폴백).
- 구 photoUrl(`/uploads/...`)은 정적 서빙으로 계속 동작하므로 즉시 깨지지 않음. 신규 업로드부터 볼륨 경로로 이행.
- **배포 전제**: Railway test·prod 서비스에 `UPLOAD_DIR` 값과 동일 경로로 Volume 마운트가 되어 있어야 한다. 구현 단계에서 `railway-deploy-advisor` 로 검수.
- **빌드 경고**: 동적 경로 `readFile` 재도입으로 NFT 트레이스 경고가 다시 뜰 수 있음. 기능엔 무해. 필요 시 `next.config.ts` `outputFileTracingIncludes`/주석으로 대응.

서명 이미지: 변경 없음. `MealRegistration.signature`(DB Text, base64) 영구 보존. 볼륨이 아니라 DB 저장이라는 점을 본 문서에 기록.

## 권한 / 보안

- 신규 교사 API 3종 모두 role=TEACHER + homeroom 검증. 반환 데이터는 담임 학급 학생으로 한정(다른 반/학년 신청 데이터 노출 금지).
- `/api/uploads/[filename]` 의 파일명 화이트리스트(`^[A-Za-z0-9._-]+$` + `path.basename`)는 기존 검증을 유지(경로 탈출 방지).

## 에러 처리

- 교사 API: 미인증 401, 비담임 403, 잘못된 공고 id 400/404.
- 사진 스트리밍: 파일 없음 → 정적 폴백 redirect, 그래도 없으면 404.
- 클라이언트: SWR 에러 시 기존 "데이터를 불러올 수 없습니다." 패턴.

## 테스트

- `lib` 순수 함수 변경은 없음(컬럼 생성은 기존 `buildMonthlyMealColumns` 재사용). 신규 순수 유틸이 생기면 `src/lib/__tests__/` 에 vitest 단위 테스트 추가.
- 수동 검증: test 도메인(`posanmeal.up.railway.app`)에서 담임 계정으로 학생관리(음영·식사컬럼)·신청현황(서명 표시), 사진 업로드 후 재배포 유지 확인.

## 영향 파일 요약

| 구분 | 파일 | 작업 |
|------|------|------|
| API | `src/app/api/teacher/students/route.ts` | 수정(mealColumns·appliedDates) |
| API | `src/app/api/teacher/applications/route.ts` | 신규 |
| API | `src/app/api/teacher/applications/[id]/registrations/route.ts` | 신규 |
| API | `src/app/api/users/me/photo/route.ts` | 수정(Volume 저장) |
| API | `src/app/api/uploads/[filename]/route.ts` | 수정(Volume 스트리밍) |
| UI | `src/components/StudentTable.tsx` | 재작성(읽기전용·식사컬럼·음영) |
| UI | `src/components/TeacherApplications.tsx` | 신규 |
| UI | `src/app/teacher/page.tsx` | 수정(신청현황 탭) |
| Hook | `src/hooks/useTeacherStudents.ts` | 수정(타입) |

## 배포 순서 (DB·Volume 공유 안전 규칙)

마이그레이션 없음 → 일반 워크플로우. 항상 `feat/posanmeal-mvp` push → test 검증 → `main` 머지. 사진 경로 변경은 **Railway 양 서비스 Volume 마운트 확인 후** 배포.
