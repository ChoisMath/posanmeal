# 조식 날짜별 신청 시스템 설계

- **작성일**: 2026-05-02
- **대상 브랜치**: feat/posanmeal-mvp → main
- **선행 스펙**:
  - [docs/superpowers/specs/2026-04-12-meal-application-design.md](../specs/2026-04-12-meal-application-design.md) (현행 신청 모델)
  - [docs/superpowers/specs/2026-04-12-offline-local-mode-design.md](../specs/2026-04-12-offline-local-mode-design.md) (로컬 모드)
  - [docs/superpowers/specs/2026-04-30-meal-reapplication-design.md](../specs/2026-04-30-meal-reapplication-design.md) (취소→재신청 동작)

---

## 1. 한 줄 요약

조식(`BREAKFAST`)을 **날짜별 신청·체크인**으로 분해한다. 관리자는 캘린더에서 운영 날짜를 자유롭게 선택해 공고를 만들고(평일·주말 제한 없음), 학생은 그 안에서 먹을 날짜를 골라 신청한다. 같은 학생이 같은 날 조식과 석식을 둘 다 체크인할 수 있도록 `CheckIn` 모델을 식사 종류 단위로 확장한다. 석식(`DINNER`)·기타(`OTHER`) 동작은 보존한다.

## 2. 동기

- 조식은 매일 운영되지 않음. 특정 요일 또는 특정 날짜에만 운영되며, 학생도 그 중 일부만 선택해서 먹는 패턴이 현실.
- 현재는 석식과 같은 모델(연속 기간)이라 학생이 한 번 신청하면 모든 날 QR 이 활성화 — 식수 예측·식자재 발주에 부적합.
- 같은 날 조식+석식이 별개 식사로 동시에 운영될 수 있어야 함.

## 3. 결정사항 (Q&A 결과)

| # | 결정 |
|---|---|
| Q1 | 관리자 조식 공고 생성 시 **캘린더에서 개별 날짜 다중 선택**. 평일·주말 제한 없음. |
| Q2 | 학생 신청은 **체크박스 리스트** UI. 서명 1회만 받음. |
| Q3 | 신청기간 내 자유 수정. **수정 시 재서명 필수.** |
| Q4 | 신청기간 종료 후 **관리자만** 부분 취소 가능. 학생은 신청기간 내에만 자유 수정. |
| Q5 | 기존 BREAKFAST 데이터는 **자동 백필**해서 단일 동작으로 통합. 코드 분기 없음. |
| Q6 | 같은 학생이 같은 날 조식 + 석식 **둘 다** 체크인 가능. `CheckIn` unique 키 변경. |
| Q7 | 식사 종류는 **시간대 자동 분기**. 시스템 설정에 임계값 4개. |
| Q8 | Excel import/export **모두 매트릭스 형태**(학생 행 × 날짜 열). |
| Q9 | 시간대 임계값은 `SystemSetting` 테이블, 관리자 페이지에서 수정. |
| 데이터 모델 | **별도 테이블 정규화** (`MealApplicationDate`, `MealRegistrationDate`). |
| 관리자 데이터 확인 | "석식 확인" 표에 **동적 sub-column** — 조식 운영일은 (조\|석), 비운영일은 (석)만. 엑셀 다운로드도 동일 매트릭스. |

## 4. 비-목표

- 석식(`DINNER`) 동작 변경 — 기존 `mealStart~mealEnd` 연속 기간 그대로.
- 기타(`OTHER`) 동작 변경 — 명단 수합용 그대로.
- 조식의 "연속 기간" 모드 — 항상 날짜선택. 분기 두지 않음.
- 인원 제한 / 마감 인원 / 알림 — 별도 작업.

## 5. 데이터 모델

### 5.1 Prisma 스키마 변경

```prisma
enum MealKind {              // ★ 신규
  BREAKFAST
  DINNER
}

model MealApplication {
  id          Int       @id @default(autoincrement())
  title       String
  description String?
  type        String    // "DINNER" | "BREAKFAST" | "OTHER"
  applyStart  DateTime  @db.Date
  applyEnd    DateTime  @db.Date
  mealStart   DateTime? @db.Date  // BREAKFAST: allowedDates 의 min
  mealEnd     DateTime? @db.Date  // BREAKFAST: allowedDates 의 max
  status      String    @default("OPEN")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  registrations MealRegistration[]
  allowedDates  MealApplicationDate[]   // ★ 신규 (BREAKFAST 만 사용)

  @@index([status])
  @@index([applyStart, applyEnd])
}

model MealApplicationDate {              // ★ 신규
  applicationId Int
  date          DateTime @db.Date
  application   MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@id([applicationId, date])
  @@index([date])
}

model MealRegistration {
  id            Int       @id @default(autoincrement())
  applicationId Int
  userId        Int
  signature     String    @db.Text
  status        String    @default("APPROVED")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt    // ★ 신규 — 마지막 재서명 시각
  cancelledAt   DateTime?
  cancelledBy   String?
  addedBy       String?

  application   MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  selectedDates MealRegistrationDate[]   // ★ 신규 (BREAKFAST 만 사용)

  @@unique([applicationId, userId])
  @@index([userId])
  @@index([applicationId, status])
}

model MealRegistrationDate {            // ★ 신규
  registrationId Int
  date           DateTime @db.Date
  createdAt      DateTime @default(now())
  registration   MealRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@id([registrationId, date])
  @@index([date])
}

model CheckIn {
  id        Int            @id @default(autoincrement())
  userId    Int
  date      DateTime       @db.Date
  mealKind  MealKind       // ★ 신규 (Phase 4 후 NOT NULL)
  checkedAt DateTime       @default(now())
  type      CheckInType
  source    CheckInSource?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, date, mealKind])    // ★ 변경 (기존: [userId, date])
  @@index([date])
  @@index([userId])
  @@index([date, mealKind])             // ★ 신규
}
```

### 5.2 SystemSetting 신규 키 (스키마 변경 없음, 데이터만)

| key | 기본값 |
|---|---|
| `breakfast_window_start` | `04:00` |
| `breakfast_window_end` | `10:00` |
| `dinner_window_start` | `15:00` |
| `dinner_window_end` | `21:00` |

### 5.3 type 별 동작 매트릭스

| 동작 | DINNER | BREAKFAST | OTHER |
|---|---|---|---|
| `allowedDates` 사용? | ❌ | ✅ 필수 (≥1) | ❌ |
| `selectedDates` 사용? | ❌ | ✅ 필수 (≥1) | ❌ |
| `mealStart/mealEnd` 의미 | QR 활성 기간 | UI 표시용 (allowedDates min/max) | 없음 |
| QR 활성 판정 | `today ∈ [mealStart,mealEnd]` | `today ∈ selectedDates` | 발급 안 함 |
| 체크인 mealKind | `DINNER` 고정 | `BREAKFAST` 고정 | — |

### 5.4 불변식

- BREAKFAST 공고: `allowedDates.size ≥ 1`. `mealStart = min(allowedDates)`, `mealEnd = max(allowedDates)` 자동 계산.
- BREAKFAST 등록: `selectedDates ⊆ application.allowedDates`. 빈 셋 금지(=취소).
- DINNER 공고: `mealStart, mealEnd` NOT NULL, `mealStart ≤ mealEnd`. `allowedDates` 비어 있어야.
- 같은 날짜에 진행 중인 BREAKFAST 공고는 1개만(겹침 금지).

### 5.5 IndexedDB 스키마 (로컬 모드, v3 → v4)

| 스토어 | 변경 |
|---|---|
| `eligibleUsers` | **삭제** → `eligibleEntries` 로 교체 |
| `eligibleEntries` (★ 신규) | keyPath `[userId, date, mealKind]`. 향후 14일치 신청내역 저장 |
| `checkins` | `mealKind` 필드 추가. unique index `byUserDate` → `byUserDateMealKind` ([userId, date, mealKind]) |
| `settings` | 키 `mealWindows` 추가 (JSON). 그 외 기존 유지 |

v3→v4 onupgradeneeded:
1. `eligibleUsers` 삭제 → `eligibleEntries` 생성.
2. `checkins`: 기존 미동기화 레코드는 `mealKind="DINNER"` 백필 후 인덱스 재생성.
3. `settings.mealWindows` 가 없으면 기본값 사용, sync 시점에 서버값으로 교체.

## 6. API 변경

### 6.1 공고 관리 (관리자)

```
POST   /api/admin/applications
PUT    /api/admin/applications/[id]
GET    /api/admin/applications
DELETE /api/admin/applications/[id]   # 변경 없음
```

Request body (zod discriminatedUnion):

```ts
const dinnerSchema = z.object({
  type: z.literal("DINNER"),
  title: z.string().min(1),
  description: z.string().optional(),
  applyStart: z.string(), applyEnd: z.string(),
  mealStart: z.string(), mealEnd: z.string(),
});
const breakfastSchema = z.object({
  type: z.literal("BREAKFAST"),
  title: z.string().min(1),
  description: z.string().optional(),
  applyStart: z.string(), applyEnd: z.string(),
  allowedDates: z.array(z.string()).min(1),
});
const otherSchema = z.object({
  type: z.literal("OTHER"),
  title: z.string().min(1),
  description: z.string().optional(),
  applyStart: z.string(), applyEnd: z.string(),
});
const schema = z.discriminatedUnion("type", [dinnerSchema, breakfastSchema, otherSchema]);
```

처리:
- BREAKFAST: `mealStart=min(allowedDates)`, `mealEnd=max(allowedDates)` 자동 산출. 트랜잭션으로 부모+자식 동시 생성.
- 수정 시 `allowedDates` 가 줄면 영향받은 `MealRegistrationDate` 도 같은 트랜잭션에서 제거. 응답에 `affectedRegistrations: number` 포함.
- 같은 날짜에 다른 진행중 BREAKFAST 공고와 겹치면 `409 OVERLAPPING_DATES`.

GET 응답: `allowedDatesCount`, `dailyCounts: { [date]: number }` 사전 집계 포함.

### 6.2 학생 신청

```
GET    /api/applications
POST   /api/applications/[id]/register     # 신청 또는 수정
DELETE /api/applications/[id]/register     # 학생 취소 (신청기간 내)
GET    /api/applications/my
```

`POST /api/applications/[id]/register` body:
- DINNER: `{ signature }`
- BREAKFAST: `{ signature, selectedDates: string[] }`

처리 (BREAKFAST):
1. `selectedDates ⊆ allowedDates` 검증. 위반 시 400 `INVALID_DATES`.
2. `selectedDates.length === 0` → 400 `INVALID_DATES`.
3. 트랜잭션:
   - `MealRegistration` upsert (signature 갱신, status=APPROVED, cancelledAt=null)
   - `MealRegistrationDate` deleteMany → createMany (delete-then-insert)
4. 응답: `{ registration }`, status `200` (수정) / `201` (신규).

### 6.3 QR / 체크인

```
GET  /api/qr/token
POST /api/checkin
```

`/api/qr/token` 변경:
1. 시간대 자동 분기로 `mealKind` 결정 (`resolveMealKind(now, mealWindows)`). null 이면 400 `NO_MEAL_WINDOW`.
2. 학생이면 `isStudentEligibleToday(userId, mealKind, today)` 검증. 실패 시 400 `NO_MEAL_PERIOD`.
3. 토큰 payload 에 `mealKind` 포함.
4. 로컬 모드 QR 형식: `posanmeal:{userId}:{gen}:{type}:{mealKind}` (5필드).

`/api/checkin` 변경:
1. 토큰 검증 → mealKind 결정 (토큰 우선, 없으면 시간대 자동).
2. 학생이면 `isStudentEligibleToday(userId, mealKind, today)` 검증.
3. CheckIn unique `(userId, date, mealKind)` 위반 시 duplicate.
4. 응답에 `mealKind` 포함.

### 6.4 동기화 API (로컬 모드)

`/api/sync/download` 응답 추가 필드:

```jsonc
{
  "operationMode": "local",
  "qrGeneration": 1,
  "users": [...],
  "eligibleUserIds": [...],   // 레거시 호환
  "eligibleEntries": [        // ★ 신규 (today ~ today+13)
    { "userId": 1, "date": "2026-05-05", "mealKind": "BREAKFAST" }
  ],
  "mealWindows": {
    "breakfast": { "start": "04:00", "end": "10:00" },
    "dinner":    { "start": "15:00", "end": "21:00" }
  },
  "serverTime": "..."
}
```

`/api/sync/upload` payload 에 `mealKind` 필수. 누락 시 `DINNER` 로 fallback (옛 태블릿 호환).

### 6.5 관리자 명단/통계/엑셀

```
GET    /api/admin/applications/[id]/registrations
POST   /api/admin/applications/[id]/registrations
DELETE /api/admin/applications/[id]/registrations/[regId]
PATCH  /api/admin/applications/[id]/registrations/[regId]   # ★ 신규 (BREAKFAST 부분 추가/제거)
GET    /api/admin/applications/[id]/export
POST   /api/admin/applications/[id]/import
GET    /api/admin/checkins                                  # 응답에 breakfastDates + 행별 mealKind 분리
GET    /api/admin/dashboard                                 # breakfast/dinner 카운트 분리
GET    /api/admin/export                                    # 동적 매트릭스 엑셀
POST   /api/admin/checkins/toggle                           # body 에 mealKind 필수
```

`PATCH /api/admin/applications/[id]/registrations/[regId]` (★ 신규):
- BREAKFAST 전용. body `{ addDates?: string[], removeDates?: string[] }`.
- 검증: `addDates ⊆ allowedDates`, `removeDates ⊆ 현재 selectedDates`.
- 트랜잭션 내에서 자식 insert/delete + 부모 `updatedAt` 갱신.
- 신청기간 내·외 무관 (관리자는 항상 가능).

`GET /api/admin/checkins` 응답:

```jsonc
{
  "month": "2026-05",
  "breakfastDates": ["2026-05-05","2026-05-07", ...],
  "rows": [{
    "userId": 1, "name": "홍길동",
    "checkins": {
      "2026-05-05": { "BREAKFAST": true, "DINNER": true },
      "2026-05-06": { "DINNER": true }
    },
    "totals": { "BREAKFAST": 5, "DINNER": 18 }
  }]
}
```

`/api/admin/applications/[id]/export` & `import` (BREAKFAST):
- 매트릭스 시트. 헤더 `학년 | 반 | 번호 | 이름 | 5/5 | 5/7 | ... | 합계`. 셀 `O` / 빈칸. 합계 행 추가.
- import: 헤더에서 날짜 컬럼 추출 → 학생 행에서 `O` 인 컬럼들의 날짜 리스트로 selectedDates 구성.

`/api/admin/export` (월별): 시트별 분리 대신 **하나의 시트에 동적 매트릭스** — 조식 운영일은 (조\|석) sub-col, 비운영일은 (석)만. 화면과 동일.

### 6.6 시스템 설정

`/api/system/settings` GET/PUT 응답·요청에 `mealWindows` 추가. 검증: `HH:MM` 포맷, `start < end`, 조식·석식 윈도우 미겹침.

### 6.7 신규 헬퍼

```ts
// src/lib/meal-kind.ts (서버)
export type MealKind = "BREAKFAST" | "DINNER";
export function resolveMealKind(now: Date, windows): MealKind | null;
export async function isStudentEligibleToday(userId, mealKind, date): Promise<boolean>;

// src/lib/meal-kind-local.ts (클라이언트, 태블릿)
export function resolveMealKindLocal(now, mealWindows): MealKind | null;
export async function isEligibleLocal(userId, date, mealKind): Promise<boolean>;
```

### 6.8 에러 코드 사전

| code | HTTP | 의미 |
|---|---|---|
| `NO_MEAL_WINDOW` | 400 | 시간대 외 |
| `NO_MEAL_PERIOD` | 400 | 학생 신청 없음 |
| `MEAL_KIND_MISMATCH` | 400 | 토큰 mealKind ≠ 시간대 (토큰 만료(3분) 후만 의미) |
| `INVALID_DATES` | 400 | selectedDates ⊄ allowedDates 또는 빈 셋 |
| `RESIGN_REQUIRED` | 400 | BREAKFAST 등록인데 서명 누락 |
| `OUT_OF_APPLY_WINDOW` | 400 | 학생이 신청기간 외 |
| `OVERLAPPING_DATES` | 409 | 다른 진행중 BREAKFAST 공고와 날짜 겹침 |
| `CLOCK_DRIFT_TOO_LARGE` | 400 | 태블릿 시계 60분 이상 차이 (client-side) |

응답 형식:
```jsonc
{ "error": "사용자에게 보일 한국어 메시지", "errorCode": "INVALID_DATES" }
```

## 7. UI 변경

### 7.1 학생 페이지 (`/student`)

**신청 다이얼로그 (BREAKFAST 분기)**:
- 체크박스 리스트로 운영 날짜 표시 (요일 함께). 전체선택/해제 버튼.
- 수정 시 기존 selectedDates 프리체크 + 서명란은 비어있는 상태로 시작 (재서명 강제).
- 카드에 "선택 N일" 표시.

**QR 탭**:
- `resolveMealKindClient` 결과로 분기.
  - `BREAKFAST` 윈도우 + 오늘 조식 등록자 → 조식 QR.
  - `DINNER` 윈도우 + 오늘 석식 등록자 → 석식 QR (기존 동작).
  - 윈도우 외 → "현재 식사 시간이 아닙니다" + 다음 식사 안내.
  - 윈도우 안인데 신청 없음 → "오늘 [조식|석식] 신청 내역이 없습니다."
- QR 라벨에 mealKind 명시: "조식 QR · 1학년 2반 3번 홍길동".
- `mealWindows` 는 페이지 진입 시 `/api/system/settings` 한 번 fetch.

`pendingCount` 뱃지: 1개라도 신청한 공고는 완료로 카운트 (현재 패턴 유지).

**확인 탭** (`MonthlyCalendar`): 셀에 조식·석식 두 점(•)으로 분리 표시. props `showMealKind: boolean`.

### 7.2 관리자 페이지 (`/admin`)

**공고 생성/수정 다이얼로그**:
- 유형이 "조식"이면 `mealStart/mealEnd` 입력 영역이 캘린더 다중선택(`DateMultiPicker`)으로 교체.
- 수정 시 `allowedDates` 줄어들면 confirm: "기존에 5/7 을 선택한 학생 N명의 신청에서 5/7 이 자동 제거됩니다. 진행하시겠습니까?"

**신청자 관리 다이얼로그 (BREAKFAST)**:
- 매트릭스 뷰. 헤더 sticky, 좌측 학년/반/번호/이름 sticky, 외부 wrapper `overflow-x-auto`.
- 셀 `O` / 빈칸. 합계 행/열.
- 학생별 "수정" 버튼 → 미니 다이얼로그에서 그 학생의 selectedDates 토글 → PATCH 호출.
- "취소" 버튼: 전체 등록 cancel.
- 엑셀 업/다운로드 다이얼로그 재사용 (양식 안내 텍스트만 변경).

**시스템 설정 탭** — 시간대 4필드 추가:
```
식사 시간 임계값
  조식 [04:00] ~ [10:00]
  석식 [15:00] ~ [21:00]
  [저장]
```

**당일 현황** — 학생 카운트를 조식·석식 분리. 상세 테이블 `식사` 컬럼 추가, 필터 추가.

**"석식 확인" 탭 (실제 데이터 확인 표)**:
- 단일 표 + **동적 sub-column**.
- 해당 월의 BREAKFAST 공고들에서 운영된 날짜 집합을 미리 계산 → 그 날짜만 (조\|석) 두 sub-col, 그 외 (석)만 1 sub-col.
- 합계: 식사별 분리. 학생 합계 셀은 `조 N · 석 M` 형식.

### 7.3 태블릿 페이지 (`/check`)

**상단 상태바**: `[현재 식사: 조식 04:00–10:00]`. 시간대 외이면 `[시간외]` 회색.

**시간대 외**: 본문에 큰 글씨 안내 + 스캐너 비활성.

**결과 영역**: "✓ 조식 체크인 되었습니다." 식사 종류 명시. duplicate 시 "이미 조식 체크인 되었습니다 (07:23)".

mealKind 결정은 클라이언트에서 (시계 + IndexedDB `mealWindows`).

### 7.4 신규 컴포넌트

| 컴포넌트 | 위치 | 책임 |
|---|---|---|
| `DateMultiPicker` | `src/components/DateMultiPicker.tsx` | 캘린더 그리드. 월 이동. 클릭 토글. props in/out 으로 `Set<string>`. |
| `DateCheckboxList` | `src/components/DateCheckboxList.tsx` | 체크박스 리스트(요일 표시). 전체선택/해제. |
| `BreakfastMatrixTable` | `src/components/BreakfastMatrixTable.tsx` | 학생 × 날짜 매트릭스. sticky header/index. 합계 행/열. 셀 클릭 콜백. |
| `MealKindBadge` | `src/components/MealKindBadge.tsx` | 조식/석식 작은 배지. 보라/앰버. |

### 7.5 변경되는 기존 컴포넌트

| 컴포넌트 | 변경 |
|---|---|
| `QRGenerator` | props 에 `mealKind` 추가. |
| `MonthlyCalendar` | 셀에 조식·석식 두 점 분리 표시. |
| `AdminMealTable` | 단일 표 + 동적 sub-column. 합계 분리. 학생 합계 `조 N · 석 M`. |

### 7.6 반응형·접근성 체크

- 매트릭스 테이블: `whitespace-nowrap` 셀, sticky header(z=2)/index(z=3)/교차(z=4), 외부 wrapper `overflow-x-auto`. 배경색 명시.
- 체크박스 리스트: 모바일 한 줄 한 항목, 터치 타겟 ≥44px (`min-h-11`).
- 캘린더: 그리드 셀 ≥44×44. 모바일 `grid-cols-7 gap-1 text-xs sm:text-sm`.
- 시간대 외 안내문: 굵게, 가운데, 단어 중간 끊지 말 것.

## 8. 마이그레이션·배포 전략

DB 가 prod·test 공유. **additive 우선 + test 먼저** 원칙.

### 8.1 5단계 배포

| Phase | 내용 | DB 영향 |
|---|---|---|
| **1: DB-A** | 신규 테이블 / `CheckIn.mealKind` nullable 컬럼 / `MealRegistration.updatedAt` / 인덱스 / `SystemSetting` 시간대 4키 seed | additive 만 |
| **2: 코드-A** | 새 코드 test → main 순서로 배포. INSERT 시 항상 `mealKind` 값 넣음 | — |
| **3: 백필** | 기존 CheckIn → `mealKind="DINNER"` UPDATE. 기존 BREAKFAST 공고 1건 → `MealApplicationDate` 채움. 기존 신청자 1명 → `MealRegistrationDate` 채움 | 데이터만 |
| **4: DB-B** | `CheckIn.mealKind` NOT NULL. unique `(userId, date)` 삭제 → `(userId, date, mealKind)` 추가 | destructive |
| **5: PWA 갱신 + 검증** | 태블릿 SW 강제 새로고침 안내. IndexedDB v3→v4 자연 마이그레이션. 24시간 모니터링 | — |

### 8.2 Phase 1 SQL (요지)

```sql
CREATE TABLE "MealApplicationDate" (
  "applicationId" INT NOT NULL,
  "date" DATE NOT NULL,
  PRIMARY KEY ("applicationId","date"),
  FOREIGN KEY ("applicationId") REFERENCES "MealApplication"("id") ON DELETE CASCADE
);
CREATE INDEX ON "MealApplicationDate"("date");

CREATE TABLE "MealRegistrationDate" (
  "registrationId" INT NOT NULL,
  "date" DATE NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("registrationId","date"),
  FOREIGN KEY ("registrationId") REFERENCES "MealRegistration"("id") ON DELETE CASCADE
);
CREATE INDEX ON "MealRegistrationDate"("date");

CREATE TYPE "MealKind" AS ENUM ('BREAKFAST', 'DINNER');

ALTER TABLE "CheckIn" ADD COLUMN "mealKind" "MealKind";
ALTER TABLE "MealRegistration"
  ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CheckIn_date_mealKind_idx" ON "CheckIn"("date","mealKind");

INSERT INTO "SystemSetting"("key","value","updatedAt") VALUES
  ('breakfast_window_start','04:00', NOW()),
  ('breakfast_window_end',  '10:00', NOW()),
  ('dinner_window_start',   '15:00', NOW()),
  ('dinner_window_end',     '21:00', NOW())
ON CONFLICT ("key") DO NOTHING;
```

### 8.3 Phase 3 백필 SQL

```sql
-- 모든 기존 CheckIn → DINNER (지금까지 모든 체크인은 사실상 석식)
UPDATE "CheckIn" SET "mealKind"='DINNER' WHERE "mealKind" IS NULL;

-- 기존 BREAKFAST 공고 → mealStart..mealEnd 의 모든 날짜 (평일·주말 제한 없음)
INSERT INTO "MealApplicationDate"("applicationId","date")
SELECT a.id, d::date
FROM "MealApplication" a,
     generate_series(a."mealStart", a."mealEnd", interval '1 day') d
WHERE a.type='BREAKFAST'
ON CONFLICT DO NOTHING;

-- 기존 BREAKFAST 신청 → 위 날짜 모두로 selectedDates 백필
INSERT INTO "MealRegistrationDate"("registrationId","date")
SELECT r.id, mad.date
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
JOIN "MealApplicationDate" mad ON mad."applicationId" = a.id
WHERE a.type='BREAKFAST' AND r.status='APPROVED'
ON CONFLICT DO NOTHING;
```

### 8.4 Phase 4 SQL

```sql
ALTER TABLE "CheckIn" ALTER COLUMN "mealKind" SET NOT NULL;
ALTER TABLE "CheckIn" DROP CONSTRAINT "CheckIn_userId_date_key";
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_date_mealKind_key"
  UNIQUE ("userId","date","mealKind");
```

### 8.5 시간 순 시나리오

```
T0     | Phase 1 마이그레이션 (test → prod 자동)
T0+15m | Phase 1 prod 적용 확인
T1     | Phase 2 새 코드 (test → main)
T1+30m | test 도메인 검증 (조식 공고 생성 / 신청 / QR / 체크인)
T1+1h  | prod 배포 확인
T2     | Phase 3 백필 스크립트 (수동 1회)
T2+5m  | 백필 검증 (CheckIn.mealKind NULL=0, 기존 1건 신청자 selectedDates 채움)
T3     | Phase 4 마이그레이션 (test → prod)
T3+1h  | Phase 5 PWA 갱신 안내
T3+24h | 모니터링 종료
```

### 8.6 롤백 가능성

| Phase | 롤백 |
|---|---|
| 1 | 가능 (DROP TABLE — 데이터 없음) |
| 2 | 가능 (코드 revert. DB 그대로) |
| 3 | 어려움 (UPDATE 롤백 가능하나 BREAKFAST 백필 row 삭제 필요) |
| 4 | 거의 불가 (NOT NULL + unique 키 교체 후 옛 코드 INSERT 모두 실패) |
| 5 | 가능 |

핵심 안전장치: Phase 4 와 1~3 사이 **24시간 이상 두기** — 양쪽 서비스 안정 후 적용.

### 8.7 사전 점검

- [x] BREAKFAST 공고 = 1건, 신청자 = 1명 (사용자 확인)
- [ ] CheckIn 총 건수 백필 대상 미리 카운트
- [ ] `prisma-migration-guardian` 에이전트로 SQL 점검
- [ ] test 환경 DB 백업 (Railway snapshot)
- [ ] 야간·주말 적용

### 8.8 운영 가이드 (사용자 액션)

배포 직후 학교 측에 1회 안내:
1. **태블릿 새로고침**: 한 번 페이지 새로고침해 새 SW 활성화.
2. **시간대 임계값 확인**: 관리자 페이지 → 시스템 설정에서 조식·석식 시간 확인/조정.
3. **기존 조식 공고 점검**: 백필 후 매트릭스 정상 표시 확인.

## 9. 에러 처리·엣지 케이스

### 9.1 시간대 경계

- QR 토큰 발급 시 박힌 `mealKind` 우선. 토큰 만료(3분) 가 자연스러운 grace 역할.
- 윈도우 변경 직후 `getCachedSettings` 캐시 TTL 만큼 지연.

### 9.2 시계 신뢰성

- 서버: KST `Asia/Seoul`. 모든 비교 KST 자정 기준.
- 학생 디바이스: 서버에서 토큰 발급이라 학생 시계 영향 없음.
- 태블릿(로컬 모드):
  - sync 시 30분 차이 경고 (현재 동작).
  - 마지막 sync `serverTime` 과 차이 > 60분이면 **체크인 비활성** + `CLOCK_DRIFT_TOO_LARGE`.
  - 첫 sync 안 된 태블릿은 mealKind 결정 불가 → 운영 가이드.

### 9.3 트랜잭션 경계

| 동작 | 트랜잭션 |
|---|---|
| 공고 생성 (BREAKFAST) | 부모 + `MealApplicationDate.createMany` |
| 공고 수정 (allowedDates 축소) | 부모 update + 자식 delete + 영향받은 `MealRegistrationDate` delete |
| 공고 삭제 | Prisma cascade (자동) |
| 학생 신청/수정 | upsert 부모 + `MealRegistrationDate` deleteMany + createMany |
| 관리자 PATCH | 자식 deleteMany + createMany + 부모 updatedAt |

### 9.4 동시성

- 같은 학생 동시 두 디바이스 신청: `applicationId_userId` unique 가 보호 → 두 번째 update 분기.
- 관리자 allowedDates 축소 vs 학생 새 날짜 신청 race: 학생 검증이 새 allowedDates 기준 → `INVALID_DATES`.

### 9.5 정책

| 케이스 | 정책 |
|---|---|
| 학생 재수정 (신청기간 내) | selectedDates 새 셋으로 교체. 재서명 필수. 관리자가 직전 PATCH 했어도 학생 의지 우선. |
| 관리자 PATCH | 항상 가능 (신청기간 내·외 무관). |
| 학생 DELETE (전체 취소) | 신청기간 내만. 후엔 관리자 전용. |
| 같은 날 활성 BREAKFAST 공고 2개 | 금지. 검증 시 `409 OVERLAPPING_DATES`. |
| 빈 selectedDates 등록 | 400 `INVALID_DATES`. |

### 9.6 백필 후

- 기존 BREAKFAST 신청자 1명 → selectedDates 가 mealStart..mealEnd 모든 날짜로 자동 채워짐.
- 학생이 다이얼로그 안 열면 그대로 OK. 열면 새 셋으로 교체 가능.

### 9.7 엑셀 매트릭스 import

| 케이스 | 처리 |
|---|---|
| `allowedDates` 외 헤더 컬럼 | skip + `skippedColumns` 카운트 |
| 미존재 학번 | `skippedNotFound` |
| 학생 행 중복 | 두 번째 이후 무시 + `skippedDuplicateRow` |
| 셀 값 변형 (`O`/`o`/`O ` 등) | trim + uppercase 후 `O` 비교 |
| 0일 선택 | `MealRegistration` 생성 안 함 |

### 9.8 로컬 모드

| 케이스 | 처리 |
|---|---|
| 옛 4필드 QR → 새 태블릿 | 시간대 자동분기 fallback |
| 새 5필드 QR → 옛 태블릿 (Phase 5 미완료 동안) | 옛 파서가 mealKind 무시. false positive 가능 → 운영 가이드 단축 |
| 학생 sync 안 한 태블릿 앞 신규 신청 | "오늘 신청 내역 없음" 거부 |
| 같은 날 같은 mealKind 두 번 시도 | unique 위반 → duplicate |
| 시간대 외 QR 시도 | 거부 + 사운드 안내 |

## 10. 테스트 전략

### 10.1 단위 테스트 (Vitest 도입)

- `vitest.config.ts` 최소 설정.
- 대상:
  - `resolveMealKind` (윈도우 안/경계/외)
  - `selectedDates ⊆ allowedDates` 검증
  - KST 자정 / today / 시간대 비교 유틸
  - 클라이언트 측 `resolveMealKindLocal`
- `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`

### 10.2 수동 QA 시나리오 (배포 전)

1. 조식 공고 생성·신청 (해피패스).
2. 조식 신청 수정 (재서명 강제).
3. 시간대 자동 분기 (QR 발급).
4. 같은 날 조식 + 석식 둘 다 체크인.
5. 관리자 매트릭스 import/export.
6. 공고 수정으로 allowedDates 축소 → 영향받은 학생 알림.
7. 로컬 모드 (조식·석식 분리).
8. 백필 검증 (운영 환경).

### 10.3 회귀 방지 (석식·기타 동작 보존)

- DINNER 공고 신규 생성/신청/QR/체크인 정상.
- OTHER 공고 명단 수합 동작 변화 없음.
- 학생 본인 월별 확인 탭 — 기존 셀 표시 그대로 (조식 점만 추가).

### 10.4 Phase 5 모니터링

- Railway 로그: 새 에러 코드 빈도.
- SQL 1회 (당일):
  ```sql
  SELECT mealKind, COUNT(*) FROM "CheckIn"
  WHERE date = CURRENT_DATE GROUP BY mealKind;
  ```

### 10.5 안 함

- E2E (Playwright) 자동화.
- 컴포넌트 렌더 테스트.
- 부하 테스트.

## 11. 변경 영향 요약

| 영역 | 파일/라우트 |
|---|---|
| Prisma 스키마 | `prisma/schema.prisma` (+2 모델, +1 enum, +1 컬럼, unique 키 변경) |
| 마이그레이션 | 3개 파일 (additive / backfill / destructive) |
| 서버 헬퍼 | `src/lib/meal-kind.ts` (신규), `src/lib/timezone.ts` (확장) |
| 서버 라우트 | 13개 영향 — `applications/**`, `qr/token`, `checkin`, `sync/**`, `admin/applications/**`, `admin/checkins/**`, `admin/dashboard`, `admin/export`, `system/settings` |
| 학생 페이지 | `src/app/student/page.tsx` |
| 관리자 페이지 | `src/app/admin/page.tsx` |
| 태블릿 페이지 | `src/app/check/page.tsx` |
| 로컬 DB | `src/lib/local-db.ts` (v3 → v4) |
| 클라이언트 헬퍼 | `src/lib/meal-kind-local.ts` (신규) |
| 신규 컴포넌트 | `DateMultiPicker`, `DateCheckboxList`, `BreakfastMatrixTable`, `MealKindBadge` |
| 변경 컴포넌트 | `QRGenerator`, `MonthlyCalendar`, `AdminMealTable` |
| 테스트 | `vitest.config.ts`, `src/lib/__tests__/*.test.ts` |
| 문서 | 본 스펙 |

총 영향 파일 수: 약 25개 (신규 + 수정).
