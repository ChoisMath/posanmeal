# 조식/중식/석식 3분할 + 리로스쿨 방식 급식신청 개편 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 식사를 조/중/석 3종으로 확장하고, 공고 생성·학생 신청·통계·엑셀을 리로스쿨 방식으로 전면 개편한다.

**Architecture:** 정규화 테이블 4개(`MealApplicationMeal`, `MealApplicationMealDate`, `MealRegistrationMeal`, `MealRegistrationMealDate`)를 additive 마이그레이션 + 백필로 추가. 자격 판정·집계는 항상 날짜 테이블 기준. UI는 전용 페이지(`/admin/applications/new|[id]/edit|[id]/stats`)와 식사별 달력 컴포넌트로 구성.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7(adapter-pg), zod 4, SWR, exceljs, Tailwind v4 + shadcn/ui, vitest

**Spec:** `docs/superpowers/specs/2026-06-11-meal-three-way-split-design.md`

**공통 규칙:**
- 모든 작업은 `feat/posanmeal-mvp` 브랜치. 커밋은 태스크 단위.
- 날짜는 `"YYYY-MM-DD"` 문자열 ↔ `dateKeyToUtcDate()`(기존 `src/lib/date-range.ts`)로 UTC Date 변환. 신청기간 시각은 KST 오프셋 포함 ISO(`2026-06-10T17:00:00+09:00`)로 받아 `new Date()` 저장.
- admin API 가드는 기존 패턴 그대로: `const session = await auth(); if (!canWriteAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });`
- zod 검증 실패 응답: `{ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }` status 400.
- 테스트 실행: `npm test` (vitest, `src/lib/__tests__/**/*.test.ts`)

---

## Phase 1 — lib 기반 (3식사 일반화)

### Task 1: `meal-kind.ts` / `meal-kind-local.ts` 3윈도우 확장

**Files:**
- Modify: `src/lib/meal-kind.ts`
- Modify: `src/lib/meal-kind-local.ts`
- Test: `src/lib/__tests__/meal-kind.test.ts`, `src/lib/__tests__/meal-kind-local.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가** — 기존 두 테스트 파일에 LUNCH 케이스 추가:

```ts
// meal-kind.test.ts 에 추가 (기존 makeWindows 헬퍼가 있으면 lunch 포함하도록 수정)
const windows = {
  breakfast: { start: "04:00", end: "10:00" },
  lunch: { start: "10:30", end: "14:00" },
  dinner: { start: "15:00", end: "21:00" },
};
it("중식 시간대면 LUNCH", () => {
  expect(resolveMealKind(new Date("2026-06-11T12:00:00+09:00"), windows)).toBe("LUNCH");
});
it("중식과 석식 사이 공백이면 null", () => {
  expect(resolveMealKind(new Date("2026-06-11T14:30:00+09:00"), windows)).toBe(null);
});
```

`meal-kind-local.test.ts` 에도 동일 케이스 추가. 기존 테스트 중 2윈도우 객체 리터럴을 쓰는 곳은 lunch 필드를 추가해 컴파일되게 수정.

- [ ] **Step 2: `npm test` — 새 케이스 FAIL(타입 에러 포함) 확인**

- [ ] **Step 3: 구현** — `src/lib/meal-kind.ts`:

```ts
export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";

export interface MealWindows {
  breakfast: MealWindow;
  lunch: MealWindow;
  dinner: MealWindow;
}

export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  lunch: { start: "10:30", end: "14:00" },
  dinner: { start: "15:00", end: "21:00" },
};

export function resolveMealKind(now: Date, windows: MealWindows): MealKind | null {
  const minutes = kstMinutes(now); // 기존 KST 분 계산 로직 재사용
  const inWindow = (w: MealWindow) =>
    minutes >= toMinutes(w.start) && minutes <= toMinutes(w.end);
  if (inWindow(windows.breakfast)) return "BREAKFAST";
  if (inWindow(windows.lunch)) return "LUNCH";
  if (inWindow(windows.dinner)) return "DINNER";
  return null;
}
```

`isStudentEligibleToday` 는 **새 테이블 단일 조회**로 교체 (Task 5 이후에야 prisma 모델이 생기므로, 이 태스크에서는 함수 본문을 기존 로직 그대로 두고 시그니처의 `MealKind` 만 3종으로 넓힌다. 본문 교체는 Task 11):

```ts
export async function isStudentEligibleToday(
  userId: number,
  mealKind: MealKind,
  todayDate: Date,
): Promise<boolean> {
  // (Task 11 에서 MealRegistrationMealDate 단일 조회로 교체)
  if (mealKind === "LUNCH") return false; // 임시: 새 테이블 도입 전
  /* 기존 BREAKFAST/DINNER 로직 유지 */
}
```

`src/lib/meal-kind-local.ts` 도 동일하게 `MealKind`/`MealWindows`/판정 로직에 lunch 추가 (자체 타입 재정의 유지).

- [ ] **Step 4: `npm test` PASS 확인**
- [ ] **Step 5: Commit** — `feat(meal): MealKind에 LUNCH 추가, 3윈도우 판정으로 확장`

### Task 2: `meal-windows-validation.ts` 3윈도우 검증

**Files:**
- Modify: `src/lib/meal-windows-validation.ts`
- Test: `src/lib/__tests__/meal-windows-validation.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
it("중식 형식 오류", () => {
  expect(validateMealWindows({ ...valid, lunch: { start: "10시", end: "14:00" } }))
    .toBe("시간을 HH:MM 형식으로 입력해주세요");
});
it("조식과 중식 겹침", () => {
  expect(validateMealWindows({ ...valid, breakfast: { start: "04:00", end: "11:00" }, lunch: { start: "10:30", end: "14:00" } }))
    .toBe("식사 시간대가 서로 겹칠 수 없습니다");
});
it("중식과 석식 겹침", () => {
  expect(validateMealWindows({ ...valid, lunch: { start: "10:30", end: "15:30" } }))
    .toBe("식사 시간대가 서로 겹칠 수 없습니다");
});
```

- [ ] **Step 2: `npm test` FAIL 확인**
- [ ] **Step 3: 구현** — 윈도우 배열 `[breakfast, lunch, dinner]` 를 순회: 형식 → 순서 → 쌍별(3쌍) 겹침 검사. 겹침 메시지를 `"식사 시간대가 서로 겹칠 수 없습니다"` 로 통일하고 기존 `"조식과 석식 시간대가 겹칠 수 없습니다"` 를 대체(이 문자열을 기대하는 기존 테스트도 함께 수정). `mapServerError` 의 `"Meal windows must not overlap"` 매핑도 새 메시지로.
- [ ] **Step 4: `npm test` PASS**
- [ ] **Step 5: Commit** — `feat(meal): 시간대 검증 3윈도우(쌍별 겹침) 확장`

### Task 3: `meal-columns.ts` 일반화

**Files:**
- Modify: `src/lib/meal-columns.ts`
- Test: `src/lib/__tests__/meal-columns.test.ts` (새 파일 — 기존 테스트가 다른 파일에 있으면 그쪽에 추가)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { buildMonthlyMealColumns } from "@/lib/meal-columns";

it("조식·중식은 활성 날짜에만, 석식은 항상", () => {
  const cols = buildMonthlyMealColumns(2026, 7, {
    BREAKFAST: ["2026-07-01"],
    LUNCH: ["2026-07-01", "2026-07-02"],
  });
  const day1 = cols.filter((c) => c.day === 1).map((c) => c.mealKind);
  const day2 = cols.filter((c) => c.day === 2).map((c) => c.mealKind);
  const day3 = cols.filter((c) => c.day === 3).map((c) => c.mealKind);
  expect(day1).toEqual(["BREAKFAST", "LUNCH", "DINNER"]);
  expect(day2).toEqual(["LUNCH", "DINNER"]);
  expect(day3).toEqual(["DINNER"]);
});
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**

```ts
export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";

export interface MealColumn {
  key: string; // "YYYY-MM-DD:KIND"
  date: string;
  day: number;
  mealKind: MealKind;
  shortLabel: "조" | "중" | "석";
  label: "조식" | "중식" | "석식";
}

export function buildMonthlyMealColumns(
  year: number,
  month: number,
  activeDates: Partial<Record<"BREAKFAST" | "LUNCH", Array<string | Date>>> = {},
): MealColumn[] {
  const sets = {
    BREAKFAST: toDateKeySet(activeDates.BREAKFAST ?? []),
    LUNCH: toDateKeySet(activeDates.LUNCH ?? []),
  };
  // 날짜 루프: BREAKFAST(있으면) → LUNCH(있으면) → DINNER(항상) 순으로 push
}
```

기존 호출부(`/api/admin/checkins`, `/api/admin/export`)는 시그니처 변경으로 컴파일 에러가 나므로 **이 태스크에서 임시로** `{ BREAKFAST: breakfastDates }` 형태로 감싸 호환만 맞춘다 (LUNCH 전달은 Task 15).

- [ ] **Step 4: `npm test` + `npx tsc --noEmit` PASS**
- [ ] **Step 5: Commit** — `feat(meal): buildMonthlyMealColumns 3식사 일반화`

---

## Phase 2 — 스키마/마이그레이션

### Task 4: schema.prisma 확장

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 스키마 수정** — 아래를 그대로 반영:

```prisma
enum MealKind {
  BREAKFAST
  LUNCH
  DINNER
}

model MealApplication {
  // ... 기존 필드 유지 (type, applyStart/End 등 구 필드 삭제 금지) ...
  applyStartAt DateTime?
  applyEndAt   DateTime?
  startYear    Int?
  startMonth   Int?
  monthCount   Int?

  registrations MealRegistration[]
  allowedDates  MealApplicationDate[]
  meals         MealApplicationMeal[]
  mealDates     MealApplicationMealDate[]

  @@index([status])
  @@index([applyStart, applyEnd])
}

model MealApplicationMeal {
  applicationId       Int
  mealKind            MealKind
  price               Int      @default(0)
  exemptionSelectable Boolean  @default(false)
  method              String   @default("NONE") // "NONE" | "YN" | "WEEKDAY" | "DATE"

  application MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@id([applicationId, mealKind])
}

model MealApplicationMealDate {
  applicationId Int
  mealKind      MealKind
  grade         Int
  date          DateTime @db.Date

  application MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@id([applicationId, mealKind, grade, date])
  @@index([date, mealKind])
}

model MealRegistration {
  // ... 기존 필드 유지 ...
  meals     MealRegistrationMeal[]
  mealDates MealRegistrationMealDate[]
}

model MealRegistrationMeal {
  registrationId  Int
  mealKind        MealKind
  applied         Boolean @default(false)
  exempt          Boolean @default(false)
  weekdaysByMonth String? // JSON: {"2026-07":[1,3,5]} (0=일 ~ 6=토)

  registration MealRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@id([registrationId, mealKind])
}

model MealRegistrationMealDate {
  registrationId Int
  mealKind       MealKind
  date           DateTime @db.Date

  registration MealRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@id([registrationId, mealKind, date])
  @@index([date, mealKind])
}
```

- [ ] **Step 2: `npx prisma generate` 성공 확인**
- [ ] **Step 3: Commit** — `feat(schema): 식사별 설정/개설일/신청 테이블 + LUNCH (additive)`

### Task 5: 마이그레이션 2개 생성 (enum → 테이블+백필)

**Files:**
- Create: `prisma/migrations/<ts>_add_lunch_meal_kind/migration.sql`
- Create: `prisma/migrations/<ts>_add_meal_plan_tables/migration.sql`

PostgreSQL 의 `ALTER TYPE ... ADD VALUE` 는 같은 트랜잭션 안에서 새 값을 사용할 수 없으므로 **enum 추가와 테이블 생성을 별도 마이그레이션으로 분리**한다.

- [ ] **Step 1:** `npx prisma migrate dev --create-only --name add_lunch_meal_kind` 실행 후 SQL 을 아래로 교체:

```sql
ALTER TYPE "MealKind" ADD VALUE IF NOT EXISTS 'LUNCH';
```

- [ ] **Step 2:** `npx prisma migrate dev --create-only --name add_meal_plan_tables` 실행. 생성된 DDL(테이블 4개 + MealApplication 컬럼 5개) 뒤에 **백필 SQL 을 추가**:

```sql
-- ===== 백필: 기존 공고 → 새 구조 =====

-- 1) 공고 메타 (KST 00:00 / 23:59 환산)
UPDATE "MealApplication" SET
  "applyStartAt" = ("applyStart"::timestamp - interval '9 hours'),
  "applyEndAt"   = ("applyEnd"::timestamp + interval '14 hours 59 minutes'),
  "startYear"  = EXTRACT(YEAR  FROM COALESCE("mealStart", "applyStart"))::int,
  "startMonth" = EXTRACT(MONTH FROM COALESCE("mealStart", "applyStart"))::int,
  "monthCount" = GREATEST(1,
    ((EXTRACT(YEAR FROM COALESCE("mealEnd","applyEnd")) - EXTRACT(YEAR FROM COALESCE("mealStart","applyStart"))) * 12
     + EXTRACT(MONTH FROM COALESCE("mealEnd","applyEnd")) - EXTRACT(MONTH FROM COALESCE("mealStart","applyStart")) + 1)::int)
WHERE "applyStartAt" IS NULL;

-- 2) 식사 설정: type → mealKind 1행 (가격 0, 날짜선택)
INSERT INTO "MealApplicationMeal" ("applicationId","mealKind","price","exemptionSelectable","method")
SELECT id,
       CASE WHEN type = 'BREAKFAST' THEN 'BREAKFAST'::"MealKind" ELSE 'DINNER'::"MealKind" END,
       0, false, 'DATE'
FROM "MealApplication"
ON CONFLICT DO NOTHING;

-- 3) 개설일: BREAKFAST 는 allowedDates, DINNER 는 mealStart~mealEnd 전개. 학년 1·2·3 복제
INSERT INTO "MealApplicationMealDate" ("applicationId","mealKind","grade","date")
SELECT ad."applicationId", 'BREAKFAST'::"MealKind", g.grade, ad.date
FROM "MealApplicationDate" ad
JOIN "MealApplication" a ON a.id = ad."applicationId" AND a.type = 'BREAKFAST'
CROSS JOIN (VALUES (1),(2),(3)) AS g(grade)
ON CONFLICT DO NOTHING;

INSERT INTO "MealApplicationMealDate" ("applicationId","mealKind","grade","date")
SELECT a.id, 'DINNER'::"MealKind", g.grade, d::date
FROM "MealApplication" a
CROSS JOIN LATERAL generate_series(a."mealStart", a."mealEnd", interval '1 day') AS d
CROSS JOIN (VALUES (1),(2),(3)) AS g(grade)
WHERE a.type <> 'BREAKFAST' AND a."mealStart" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4) 신청별 식사 행
INSERT INTO "MealRegistrationMeal" ("registrationId","mealKind","applied","exempt")
SELECT r.id,
       CASE WHEN a.type = 'BREAKFAST' THEN 'BREAKFAST'::"MealKind" ELSE 'DINNER'::"MealKind" END,
       (r.status = 'APPROVED'), false
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
ON CONFLICT DO NOTHING;

-- 5) 신청별 확정 날짜
INSERT INTO "MealRegistrationMealDate" ("registrationId","mealKind","date")
SELECT rd."registrationId", 'BREAKFAST'::"MealKind", rd.date
FROM "MealRegistrationDate" rd
JOIN "MealRegistration" r ON r.id = rd."registrationId"
JOIN "MealApplication" a ON a.id = r."applicationId" AND a.type = 'BREAKFAST'
ON CONFLICT DO NOTHING;

INSERT INTO "MealRegistrationMealDate" ("registrationId","mealKind","date")
SELECT r.id, 'DINNER'::"MealKind", d::date
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
CROSS JOIN LATERAL generate_series(a."mealStart", a."mealEnd", interval '1 day') AS d
WHERE a.type <> 'BREAKFAST' AND a."mealStart" IS NOT NULL
ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: `prisma-migration-guardian` 에이전트로 두 마이그레이션 검수** (additive 여부, enum 트랜잭션 이슈, ON CONFLICT 멱등성)
- [ ] **Step 4:** 로컬 DB(`docker compose up -d`)에서 `npx prisma migrate dev` 적용 → 성공 확인. 기존 공고가 있으면 psql 로 spot check: `SELECT count(*) FROM "MealApplicationMeal";`
- [ ] **Step 5: Commit** — `feat(db): meal plan 테이블 마이그레이션 + 기존 데이터 백필`

---

## Phase 3 — 도메인 lib + zod

### Task 6: `src/lib/meal-plan.ts` (라벨·달력·요일전개·금액)

**Files:**
- Create: `src/lib/meal-plan.ts`
- Test: `src/lib/__tests__/meal-plan.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { expandWeekdays, monthsOf, calcMealFee, buildAppTitle, monthKeyOf } from "@/lib/meal-plan";

it("monthsOf: 2026-11부터 3개월", () => {
  expect(monthsOf(2026, 11, 3)).toEqual([
    { year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 },
  ]);
});
it("expandWeekdays: 개설일 중 선택 요일만", () => {
  // 2026-07-21(화) 22(수) 24(금) 27(월)
  expect(expandWeekdays(["2026-07-21", "2026-07-22", "2026-07-24", "2026-07-27"], [1, 3]))
    .toEqual(["2026-07-22", "2026-07-27"]); // 수=3? 주의: 0=일…6=토 기준 — 월=1, 수=3
});
it("calcMealFee: 면제는 0원", () => {
  expect(calcMealFee(5680, 8, false)).toBe(45440);
  expect(calcMealFee(5680, 8, true)).toBe(0);
});
it("buildAppTitle", () => {
  expect(buildAppTitle(2026, 6, "급식신청")).toBe("2026년 06월 급식신청");
});
it("monthKeyOf", () => {
  expect(monthKeyOf("2026-07-21")).toBe("2026-07");
});
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현** — 서버·클라이언트 공용(프리즈마 import 금지):

```ts
export type MealKind = "BREAKFAST" | "LUNCH" | "DINNER";
export type MealApplyMethod = "NONE" | "YN" | "WEEKDAY" | "DATE";

export const MEAL_KINDS: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];
export const MEAL_LABEL: Record<MealKind, string> = { BREAKFAST: "조식", LUNCH: "중식", DINNER: "석식" };
export const MEAL_SHORT: Record<MealKind, string> = { BREAKFAST: "조", LUNCH: "중", DINNER: "석" };
export const METHOD_LABEL: Record<MealApplyMethod, string> = {
  NONE: "신청불가", YN: "신청/미신청", WEEKDAY: "요일선택", DATE: "날짜선택",
};
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function monthsOf(startYear: number, startMonth: number, monthCount: number) {
  return Array.from({ length: monthCount }, (_, i) => {
    const m = startMonth - 1 + i;
    return { year: startYear + Math.floor(m / 12), month: (m % 12) + 1 };
  });
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

export function expandWeekdays(openDates: string[], weekdays: number[]): string[] {
  const set = new Set(weekdays);
  return openDates.filter((d) => set.has(weekdayOf(d))).sort();
}

export function calcMealFee(price: number, dayCount: number, exempt: boolean): number {
  return exempt ? 0 : price * dayCount;
}

export function buildAppTitle(startYear: number, startMonth: number, subject: string): string {
  return `${startYear}년 ${String(startMonth).padStart(2, "0")}월 ${subject}`;
}

// 학번: 1학년 2반 4번 → 10204
export function studentNumberOf(grade: number, classNum: number, number: number): number {
  return grade * 10000 + classNum * 100 + number;
}
```

- [ ] **Step 4: PASS 확인**
- [ ] **Step 5: Commit** — `feat(meal): meal-plan 도메인 유틸 (요일전개·금액·제목)`

### Task 7: zod 스키마 `src/lib/schemas/meal-plan.ts`

**Files:**
- Create: `src/lib/schemas/meal-plan.ts`
- Test: `src/lib/__tests__/meal-plan-schema.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { adminApplicationSchema, studentRegisterSchema } from "@/lib/schemas/meal-plan";

const validAdmin = {
  subject: "급식신청", description: "안내문",
  startYear: 2026, startMonth: 7, monthCount: 1,
  applyStartAt: "2026-06-10T17:00:00+09:00", applyEndAt: "2026-06-12T16:00:00+09:00",
  meals: [
    { mealKind: "DINNER", price: 5680, exemptionSelectable: true, method: "DATE",
      dates: [{ grade: 1, date: "2026-07-21" }] },
    { mealKind: "BREAKFAST", price: 0, exemptionSelectable: false, method: "NONE", dates: [] },
  ],
};
it("정상 통과", () => expect(adminApplicationSchema.safeParse(validAdmin).success).toBe(true));
it("마감 < 시작이면 실패", () => {
  expect(adminApplicationSchema.safeParse({ ...validAdmin, applyEndAt: "2026-06-01T00:00:00+09:00" }).success).toBe(false);
});
it("NONE 아닌데 개설일 없으면 실패", () => {
  expect(adminApplicationSchema.safeParse({
    ...validAdmin,
    meals: [{ mealKind: "DINNER", price: 0, exemptionSelectable: false, method: "DATE", dates: [] }],
  }).success).toBe(false);
});
it("학생 신청 정상", () => {
  expect(studentRegisterSchema.safeParse({
    signature: "data:image/png;base64,abc",
    meals: [
      { mealKind: "DINNER", applied: true, exempt: false, selectedDates: ["2026-07-21"] },
      { mealKind: "LUNCH", applied: true, exempt: false, weekdaysByMonth: { "2026-07": [1, 3] } },
    ],
  }).success).toBe(true);
});
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현**

```ts
import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mealKind = z.enum(["BREAKFAST", "LUNCH", "DINNER"]);
const method = z.enum(["NONE", "YN", "WEEKDAY", "DATE"]);

export const adminApplicationSchema = z.object({
  subject: z.string().min(1).max(100),
  description: z.string().max(5000).optional().default(""),
  startYear: z.number().int().min(2024).max(2100),
  startMonth: z.number().int().min(1).max(12),
  monthCount: z.number().int().min(1).max(6),
  applyStartAt: z.string().datetime({ offset: true }),
  applyEndAt: z.string().datetime({ offset: true }),
  meals: z.array(z.object({
    mealKind,
    price: z.number().int().min(0).max(1_000_000),
    exemptionSelectable: z.boolean(),
    method,
    dates: z.array(z.object({ grade: z.number().int().min(1).max(3), date: dateKey })),
  })).min(1).max(3),
})
  .refine((v) => new Date(v.applyEndAt) > new Date(v.applyStartAt),
    { message: "마감일시는 시작일시 이후여야 합니다" })
  .refine((v) => v.meals.every((m) => m.method === "NONE" || m.dates.length > 0),
    { message: "신청 가능한 식사는 개설일이 1개 이상이어야 합니다" })
  .refine((v) => new Set(v.meals.map((m) => m.mealKind)).size === v.meals.length,
    { message: "식사 종류가 중복되었습니다" });

export const studentRegisterSchema = z.object({
  signature: z.string().min(1).max(200_000),
  meals: z.array(z.object({
    mealKind,
    applied: z.boolean(),
    exempt: z.boolean().default(false),
    selectedDates: z.array(dateKey).optional(),
    weekdaysByMonth: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.array(z.number().int().min(0).max(6))).optional(),
  })).min(1).max(3),
});

export type AdminApplicationInput = z.infer<typeof adminApplicationSchema>;
export type StudentRegisterInput = z.infer<typeof studentRegisterSchema>;
```

- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(meal): 공고/신청 zod 스키마`

---

## Phase 4 — 서버 API

### Task 8: 설정 API + 캐시에 중식 윈도우

**Files:**
- Modify: `src/lib/settings-cache.ts` — `mealWindows.lunch` 읽기 (`lunch_window_start/end`, 없으면 `DEFAULT_MEAL_WINDOWS.lunch`)
- Modify: `src/app/api/system/settings/route.ts`

- [ ] **Step 1:** GET 응답에 `mealWindows.lunch` 포함, PUT body `mealWindows.lunch?: { start, end }` 허용. PUT 검증은 3윈도우 전체를 합성해 기존 서버측 검증(형식/순서/겹침) 수행 후 `lunch_window_start`, `lunch_window_end` upsert + `invalidateSettingsCache()`.
- [ ] **Step 2:** `npx tsc --noEmit` + 수동 확인: `npm run dev` 후 `GET /api/system/settings` 에 lunch 디폴트 포함.
- [ ] **Step 3: Commit** — `feat(settings): 중식 시간대 설정 추가`

### Task 9: 관리자 공고 CRUD API 재작성

**Files:**
- Modify: `src/app/api/admin/applications/route.ts` (GET/POST)
- Modify: `src/app/api/admin/applications/[id]/route.ts` (GET/PUT/DELETE)
- (유지) `src/app/api/admin/applications/[id]/close/route.ts`

핵심 헬퍼를 라우트 파일이 아닌 `src/lib/meal-plan-server.ts` 에 둔다:

- [ ] **Step 1: Create `src/lib/meal-plan-server.ts`**

```ts
import { prisma } from "@/lib/prisma";
import { dateKeyToUtcDate, formatMonthDateKey } from "@/lib/date-range";
import type { AdminApplicationInput } from "@/lib/schemas/meal-plan";
import { buildAppTitle } from "@/lib/meal-plan";

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 공고 + 식사설정 + 개설일을 단일 트랜잭션으로 저장 (생성/수정 공용)
export async function saveApplication(input: AdminApplicationInput, id?: number) {
  return prisma.$transaction(async (tx) => {
    const data = {
      title: buildAppTitle(input.startYear, input.startMonth, input.subject),
      description: input.description,
      startYear: input.startYear,
      startMonth: input.startMonth,
      monthCount: input.monthCount,
      applyStartAt: new Date(input.applyStartAt),
      applyEndAt: new Date(input.applyEndAt),
      type: "MULTI", // 구 컬럼 호환용 마커 (구 코드 경로에서 BREAKFAST 로직을 타지 않게)
      applyStart: new Date(input.applyStartAt.slice(0, 10)),
      applyEnd: new Date(input.applyEndAt.slice(0, 10)),
    };
    const app = id
      ? await tx.mealApplication.update({ where: { id }, data })
      : await tx.mealApplication.create({ data });

    await tx.mealApplicationMeal.deleteMany({ where: { applicationId: app.id } });
    await tx.mealApplicationMealDate.deleteMany({ where: { applicationId: app.id } });
    await tx.mealApplicationMeal.createMany({
      data: input.meals.map((m) => ({
        applicationId: app.id, mealKind: m.mealKind, price: m.price,
        exemptionSelectable: m.exemptionSelectable, method: m.method,
      })),
    });
    await tx.mealApplicationMealDate.createMany({
      data: input.meals.flatMap((m) =>
        m.dates.map((d) => ({
          applicationId: app.id, mealKind: m.mealKind, grade: d.grade,
          date: dateKeyToUtcDate(d.date),
        }))),
      skipDuplicates: true,
    });

    if (id) await resyncRegistrations(tx, app.id);
    return app;
  });
}

// 공고 수정 시 신청 데이터 재동기화:
//  - 개설일에서 빠진 날짜의 MealRegistrationMealDate 삭제
//  - YN 방식 식사는 신청자의 날짜를 학년 개설일 전체로 재생성
export async function resyncRegistrations(tx: PrismaTx, applicationId: number) {
  const meals = await tx.mealApplicationMeal.findMany({ where: { applicationId } });
  const openDates = await tx.mealApplicationMealDate.findMany({ where: { applicationId } });
  const regs = await tx.mealRegistration.findMany({
    where: { applicationId },
    include: { user: { select: { grade: true } }, meals: true },
  });
  for (const reg of regs) {
    const grade = reg.user.grade ?? 0;
    for (const meal of meals) {
      const open = openDates
        .filter((d) => d.mealKind === meal.mealKind && d.grade === grade)
        .map((d) => d.date);
      const regMeal = reg.meals.find((m) => m.mealKind === meal.mealKind);
      if (!regMeal?.applied) continue;
      if (meal.method === "YN") {
        await tx.mealRegistrationMealDate.deleteMany({
          where: { registrationId: reg.id, mealKind: meal.mealKind },
        });
        await tx.mealRegistrationMealDate.createMany({
          data: open.map((date) => ({ registrationId: reg.id, mealKind: meal.mealKind, date })),
          skipDuplicates: true,
        });
      } else {
        // WEEKDAY/DATE: 개설일에서 빠진 날짜만 제거
        await tx.mealRegistrationMealDate.deleteMany({
          where: {
            registrationId: reg.id, mealKind: meal.mealKind,
            date: { notIn: open },
          },
        });
      }
    }
  }
}
```

(`PrismaTx` 는 `Parameters<Parameters<typeof prisma.$transaction>[0]>[0]` 타입 별칭으로 선언.)

- [ ] **Step 2: GET (목록) 재작성** — `canWriteAdmin` 가드 유지. 응답:

```ts
// GET /api/admin/applications →
{ applications: Array<{
  id; title; description; status;
  startYear; startMonth; monthCount;
  applyStartAt; applyEndAt;       // ISO
  meals: Array<{ mealKind; price; exemptionSelectable; method; openDateCount }>;
  registrationCount;              // status=APPROVED
  cancelledCount;
}> }
```

구현: `prisma.mealApplication.findMany({ orderBy: { id: "desc" }, include: { meals: true, _count 패턴 } })` + `mealApplicationMealDate.groupBy({ by: ["applicationId","mealKind"], _count })` 로 openDateCount 채움.

- [ ] **Step 3: POST 재작성** — `adminApplicationSchema.safeParse` → `saveApplication(parsed.data)` → `{ application }` 201.
- [ ] **Step 4: [id] GET 추가 (edit 프리필용)** — 응답:

```ts
{ application: { id, subject /* title에서 prefix 제거한 원문이 없으므로 subject 별도 보존 불필요 — title 그대로 + startYear/startMonth 로 클라이언트가 subject 역산: title.replace(`${y}년 ${MM}월 `, "") */,
  title, description, status, startYear, startMonth, monthCount,
  applyStartAt, applyEndAt,
  meals: [{ mealKind, price, exemptionSelectable, method,
            dates: [{ grade, date: "YYYY-MM-DD" }] }] } }
```

- [ ] **Step 5: PUT 재작성** — schema 검증 → `saveApplication(data, id)`. DELETE 는 기존 유지(cascade 로 새 테이블도 삭제됨).
- [ ] **Step 6:** `npx tsc --noEmit` PASS. 수동 스모크: dev 서버에서 curl 로 POST→GET→PUT→GET 확인.
- [ ] **Step 7: Commit** — `feat(api): 관리자 공고 CRUD 를 식사별 구조로 재작성`

### Task 10: 학생 API 재작성

**Files:**
- Modify: `src/app/api/applications/route.ts` (GET 목록)
- Create: `src/app/api/applications/[id]/route.ts` (GET 상세)
- Modify: `src/app/api/applications/[id]/register/route.ts` (POST/DELETE)
- Modify: `src/app/api/applications/my/route.ts`

- [ ] **Step 1: GET 목록** — 로그인 학생 기준 OPEN + `applyStartAt <= now <= applyEndAt` 공고:

```ts
{ applications: [{ id, title, description, applyStartAt, applyEndAt,
  meals: [{ mealKind, price, method, exemptionSelectable }],
  myStatus: "NONE" | "APPLIED" | "CANCELLED" }] }
```

- [ ] **Step 2: GET 상세 (`[id]/route.ts`)** — 본인 학년 개설일 + 기존 신청 복원 데이터:

```ts
{ application: { id, title, description, startYear, startMonth, monthCount,
    applyStartAt, applyEndAt, status,
    meals: [{ mealKind, price, exemptionSelectable, method,
              openDates: ["YYYY-MM-DD"] /* 본인 학년만 */ }] },
  registrationCount: number, // APPROVED 수
  myRegistration: null | {
    status, signature: null /* 서명은 재전송 안 함 */,
    meals: [{ mealKind, applied, exempt, weekdaysByMonth, selectedDates: ["YYYY-MM-DD"] }] } }
```

- [ ] **Step 3: POST register 재작성** — `studentRegisterSchema` 검증 후:

```ts
// 1. 공고 존재 + status=OPEN + applyStartAt<=now<=applyEndAt 확인 (아니면 400 "신청 기간이 아닙니다.")
// 2. user.grade 필수 (없으면 400)
// 3. 식사별 확정 날짜 계산:
const appMeals = await prisma.mealApplicationMeal.findMany({ where: { applicationId } });
const openByKind = /* mealApplicationMealDate where grade=user.grade → Map<MealKind, string[]> */;
const resolved: Array<{ mealKind; applied; exempt; weekdaysByMonth: string | null; dates: string[] }> = [];
for (const input of body.meals) {
  const conf = appMeals.find((m) => m.mealKind === input.mealKind);
  if (!conf || conf.method === "NONE") return 400 "신청할 수 없는 식사입니다.";
  if (input.exempt && !conf.exemptionSelectable) return 400 "면제를 선택할 수 없습니다.";
  const open = openByKind.get(input.mealKind) ?? [];
  let dates: string[] = [];
  if (input.applied) {
    if (conf.method === "YN") dates = open;
    else if (conf.method === "WEEKDAY") {
      const byMonth = input.weekdaysByMonth ?? {};
      dates = open.filter((d) => (byMonth[monthKeyOf(d)] ?? []).includes(weekdayOf(d)));
    } else { // DATE
      const sel = new Set(input.selectedDates ?? []);
      if ([...sel].some((d) => !open.includes(d))) return 400 "선택할 수 없는 날짜가 포함되어 있습니다.";
      dates = [...sel].sort();
    }
    if (dates.length === 0) return 400 `${MEAL_LABEL[input.mealKind]} 신청 날짜가 없습니다.`;
  }
  resolved.push({ ... });
}
// 전체 식사 미신청이면 400 "신청할 식사를 선택해주세요."
// 4. 트랜잭션: registration upsert(재활성화 패턴 유지: 있으면 status=APPROVED, cancelledAt/By null, signature 갱신)
//    → mealRegistrationMeal/Date deleteMany 후 createMany (전체 교체 = 자유 수정)
// 5. 응답: { registration: { id } } — 신규 201 / 갱신 200
```

- [ ] **Step 4: DELETE 유지** — 기간 내 취소(status=CANCELLED). 새 테이블 행은 보존(재신청 시 교체됨).
- [ ] **Step 5: my 재작성** — 응답:

```ts
{ registrations: [{ id, status, createdAt, application: { id, title, applyStartAt, applyEndAt },
  meals: [{ mealKind, applied, exempt, dayCount, price, fee }] }] }
// fee = calcMealFee(price, dayCount, exempt)
```

- [ ] **Step 6:** `npx tsc --noEmit` + dev 서버 curl 스모크 (목록→상세→POST 3방식→상세 복원 확인→DELETE).
- [ ] **Step 7: Commit** — `feat(api): 학생 신청 API 식사별 구조로 재작성`

### Task 11: 체크인 자격·QR·동기화 3식사 대응

**Files:**
- Modify: `src/lib/meal-kind.ts` (`isStudentEligibleToday` 본문 교체)
- Modify: `src/app/api/sync/download/route.ts`
- Modify: `src/app/api/admin/checkins/toggle/route.ts`
- Test: `src/lib/__tests__/meal-kind.test.ts`

- [ ] **Step 1: `isStudentEligibleToday` 교체** — 단일 조회:

```ts
export async function isStudentEligibleToday(
  userId: number, mealKind: MealKind, todayDate: Date,
): Promise<boolean> {
  const row = await prisma.mealRegistrationMealDate.findFirst({
    where: {
      mealKind,
      date: todayDate,
      registration: { userId, status: "APPROVED" },
    },
    select: { registrationId: true },
  });
  return row !== null;
}
```

기존 BREAKFAST/DINNER 분기 로직 삭제. 관련 단위 테스트(mock 기반)를 새 쿼리 형태에 맞게 수정.

- [ ] **Step 2: `sync/download`** — eligibleEntries 를 새 테이블에서 생성:

```ts
const entries = await prisma.mealRegistrationMealDate.findMany({
  where: { date: { gte: today, lte: plus13days }, registration: { status: "APPROVED" } },
  select: { mealKind: true, date: true, registration: { select: { userId: true } } },
});
// → [{ userId, date: "YYYY-MM-DD", mealKind }] (LUNCH 포함)
// eligibleUserIds(구 필드)는 오늘자 DINNER 엔트리의 userId 목록으로 유지
```

- [ ] **Step 3: toggle** — `mealKind` 허용값에 `"LUNCH"` 추가 (기본값 DINNER 유지). `/api/checkin`, `/api/qr/token` 은 `MealKind` 타입 확장만으로 LUNCH 가 자연히 흐르는지 확인하고, payload 타입 선언에 LUNCH 포함.
- [ ] **Step 4:** `npm test` + `npx tsc --noEmit` PASS
- [ ] **Step 5: Commit** — `feat(checkin): 자격 판정을 식사별 날짜 테이블 단일 조회로 통일 (LUNCH 포함)`

### Task 12: 통계 API + 관리자 신청 관리

**Files:**
- Modify: `src/app/api/admin/applications/[id]/registrations/route.ts` (GET/POST)
- Modify: `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` (PATCH/DELETE)

- [ ] **Step 1: GET 재작성** — stats 페이지가 쓰는 전체 데이터:

```ts
{ application: { id, title, startYear, startMonth, monthCount,
    applyStartAt, applyEndAt,
    meals: [{ mealKind, price, exemptionSelectable, method }] },
  registrations: [{ id, createdAt, status, addedBy,
    user: { id, name, email, grade, classNum, number, gender },
    meals: [{ mealKind, applied, exempt, dayCount }] }] }
// dayCount: mealRegistrationMealDate groupBy({ by: ["registrationId","mealKind"], _count })
```

- [ ] **Step 2: POST (관리자 직접 추가)** — body `{ userId, meals: studentRegisterSchema.shape.meals }` (서명 없음). 학생 POST 와 같은 날짜 해석 로직(`meal-plan-server.ts` 로 추출해 공유 — `resolveRegistrationDates(applicationId, grade, meals)` 함수로 분리). `signature: "(관리자 등록)"`, `addedBy: "ADMIN"`.
- [ ] **Step 3: PATCH 재작성** — body 두 형태:
  - `{ status: "APPROVED" | "CANCELLED" }` — 상태 전환(기존 유지)
  - `{ meals: [...] }` — 관리자 신청 내용 수정. Step 2 와 동일 해석 후 교체.
- [ ] **Step 4: DELETE 추가** — registration 행 자체 삭제 (cascade). 통계의 "삭제" 버튼용.
- [ ] **Step 5:** `npx tsc --noEmit` + curl 스모크 → **Commit** — `feat(api): 통계용 신청자 API + 관리자 수정/삭제`

### Task 13: 리로 양식 3시트 엑셀

**Files:**
- Create: `src/lib/meal-stats-excel.ts`
- Modify: `src/app/api/admin/applications/[id]/export/route.ts`
- Test: `src/lib/__tests__/meal-stats-excel.test.ts`

- [ ] **Step 1: 실패하는 테스트** — 빌더에 순수 데이터를 넣고 셀/수식 검증:

```ts
import { buildStatsWorkbook } from "@/lib/meal-stats-excel";

const wb = await buildStatsWorkbook({
  title: "2026년 07월 급식신청",
  months: [{ year: 2026, month: 7 }],
  meals: [{ mealKind: "DINNER", price: 5680 }],
  openDates: { DINNER: ["2026-07-21", "2026-07-22"] }, // 전 학년 합집합
  rows: [{
    seq: 1, createdAt: "2026-06-10 17:01:02", loginId: "hong", studentNo: 20600,
    name: "최재혁", exempt: { DINNER: false },
    dates: { DINNER: ["2026-07-21"] },
  }],
});
const ws = wb.getWorksheet("전체신청내역")!;
expect(ws.getCell("A3").value).toBe("순번");        // 3행 헤더의 마지막 행
expect(ws.getCell("F4").value).toMatchObject({ formula: expect.stringContaining("(1-H4)") });
expect(ws.getCell("G4").value).toMatchObject({ formula: "SUM(K4:M4)" });
expect(wb.getWorksheet("요일별")).toBeTruthy();
expect(wb.getWorksheet("에듀파인")).toBeTruthy();
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현** — 시트 레이아웃 (샘플 파일과 동일):

**Sheet1 `전체신청내역`** — 고정 16컬럼 + 날짜×3:

| 열 | A | B | C | D | E | F | G | H~J | K~M | N~P | Q… |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 내용 | 순번 | 시간 | 아이디 | 학번 | 이름 | 수납액 | 합계 | 면제 조/중/석 | 단가 조/중/석 | 식수 조/중/석 | 날짜별 조/중/석 |

- 1행: 그룹 헤더(병합): A1:A3 "순번" … G1:G3 "합계", H1:J1 "면제", K1:M1 "단가", N1:P1 "식수", 날짜마다 3열 병합 "MM/DD".
- 2행: 날짜 열에 요일(`WEEKDAY_LABELS`), K2/L2/M2 에 **단가 숫자**.
- 3행: 면제·단가·식수·날짜 열에 "조"/"중"/"석".
- 데이터(4행~): 면제=1(면제 시), 식수=`dates[kind].length`, 날짜셀=선택 시 1.
  - F: `{ formula: "(1-H4)*K4+(1-I4)*L4+(1-J4)*M4" }` (행번호 치환)
  - G: `{ formula: "SUM(K4:M4)" }`
  - K/L/M(데이터행): `{ formula: "K$2*N4" }` / `"L$2*O4"` / `"M$2*P4"`
- 마지막 합계행: D="합계", E=`COUNTA(E4:E{n})`, F~P=`SUM(...)`, 날짜열=`COUNTA(...)`.
- 열 주소 계산은 exceljs `worksheet.getColumn(idx).letter` 사용.
- 미개설 식사(meals 에 없음)는 면제/단가/식수 열은 그대로 두되 값 0/빈칸 (샘플과 동일하게 3열 구조 고정).

**Sheet2 `요일별`** — A1 병합 "요일별 식수(첫주 기준)", 2행 헤더(구분/일~토), 3~5행 조식/중식/석식. 값: 공고 첫 달에서 각 요일의 **첫 개설일**에 대해 해당 날짜를 선택한 학생 수 (개설일 없으면 빈칸).

**Sheet3 `에듀파인`** — 헤더: `*주야 *계열 *학과 *학년 *반 *번호 *성명 *대상금액 조식면제 중식면제 석식면제 조식수 중식수 석식수 조식금액 중식금액 석식금액 금액합계 신청시간`. 데이터행: 고정값 "주간"/"일반계"/"일반학과" + user.grade/classNum/number/name + `{ formula: "전체신청내역!F4" }` 식의 시트 참조(H=F, I~K=H~J, L~N=N~P, O~Q=K~M, R=G) + 신청시간 문자열.

`buildStatsWorkbook(input)` 시그니처:

```ts
export interface StatsExcelInput {
  title: string;
  months: Array<{ year: number; month: number }>;
  meals: Array<{ mealKind: MealKind; price: number }>;
  openDates: Partial<Record<MealKind, string[]>>; // 전 학년 합집합, 정렬됨
  rows: Array<{
    seq: number; createdAt: string; loginId: string; studentNo: number; name: string;
    grade?: number; classNum?: number; number?: number;
    exempt: Partial<Record<MealKind, boolean>>;
    dates: Partial<Record<MealKind, string[]>>;
  }>;
}
export async function buildStatsWorkbook(input: StatsExcelInput): Promise<ExcelJS.Workbook>;
```

- [ ] **Step 4: export 라우트 수정** — 기존 `?template=true` (일괄신청 양식) 분기는 Task 14 에서 개편하므로 유지. 기본 모드를 `buildStatsWorkbook` 호출로 교체:
  - rows: APPROVED registrations (학년·반·번호 정렬), loginId = email `@` 앞부분, studentNo = `studentNumberOf(...)`.
  - 파일명: `{startYear}년_{MM}월_{title}_내역서({신청수}).xlsx` → `encodeURIComponent`.
- [ ] **Step 5:** `npm test` PASS → 수동: dev 서버에서 다운로드 후 Excel 로 열어 수식 동작 확인.
- [ ] **Step 6: Commit** — `feat(excel): 리로 양식 3시트(전체신청내역·요일별·에듀파인) 내보내기`

### Task 14: 일괄신청 (양식 다운로드 + 업로드)

**Files:**
- Modify: `src/app/api/admin/applications/[id]/export/route.ts` (`?template=true` 분기)
- Modify: `src/app/api/admin/applications/[id]/import/route.ts`

- [ ] **Step 1: 양식 모드 재작성** — 시트 1개, 헤더(1행): `학년 | 반 | 번호 | 이름 | 조식 | 중식 | 석식`. 전체 학생(grade 정렬) 나열, method=NONE 식사 열은 헤더에 "(신청불가)" 표기. 안내(2행 병합): `"신청할 식사에 O 표시 (해당 학년 개설일 전체 신청 처리)"`. 데이터는 3행부터.
- [ ] **Step 2: import 재작성** — 3행부터 파싱, 조/중/석 열의 `O`(대소문자/공백 허용) → 해당 식사 `applied=true` + 학년 개설일 전체(`YN` 해석과 동일). 한 행에 하나도 없으면 skip. 기존 신청자는 **갱신**(전체 교체), 신규는 생성(`addedBy:"ADMIN"`, `signature:"(관리자 일괄등록)"`). 응답 `{ added, updated, skippedNotFound, total }`.
- [ ] **Step 3:** 수동 스모크: 양식 다운로드 → O 표기 → 업로드 → stats GET 으로 반영 확인.
- [ ] **Step 4: Commit** — `feat(admin): 일괄신청 양식/업로드를 조중석 구조로 개편`

### Task 15: 기존 관리자 조회 화면 API 3식사 일반화

**Files:**
- Modify: `src/app/api/admin/checkins/route.ts`
- Modify: `src/app/api/admin/dashboard/route.ts`
- Modify: `src/app/api/admin/export/route.ts`

- [ ] **Step 1: checkins GET** — 월 범위의 활성 날짜 조회를 새 테이블로 교체:

```ts
const activeRows = await prisma.mealRegistrationMealDate.findMany({
  where: { date: { gte: monthStart, lte: monthEnd }, mealKind: { in: ["BREAKFAST", "LUNCH"] },
           registration: { status: "APPROVED" } },
  select: { date: true, mealKind: true }, distinct: ["date", "mealKind"],
});
const mealColumns = buildMonthlyMealColumns(year, month, {
  BREAKFAST: activeRows.filter((r) => r.mealKind === "BREAKFAST").map((r) => r.date),
  LUNCH: activeRows.filter((r) => r.mealKind === "LUNCH").map((r) => r.date),
});
```

- [ ] **Step 2: dashboard GET** — `hasLunch`, `lunchStudentCount` 추가 (조식과 동일 패턴: 해당 날짜 APPROVED LUNCH 신청 존재 여부 + LUNCH 체크인 수). 기존 필드 유지.
- [ ] **Step 3: admin/export (월별/일별 체크인 엑셀)** — Step 1 과 같은 mealColumns 사용. 월별 셀 표기: 기존 `"O+조"` 패턴에 `"중"` 결합 추가 (예: 조+석 체크 시 `"조·석"`, 표기 규칙은 기존 코드 패턴 따름). 일별 시트 "식사" 컬럼 라벨에 중식 포함.
- [ ] **Step 4:** `npx tsc --noEmit` + dev 스모크 → **Commit** — `feat(admin): 체크인 표/대시보드/엑셀 중식 일반화`

---

## Phase 5 — UI

**색상 상수** (Task 16 에서 정의, 이후 모든 UI 가 import):
조식 `sky`(#CAE9FF 근사), 중식 `orange`(#FFE0CA 근사), 석식 `rose`(#FFCFD2 근사).

### Task 16: 공용 식사 UI 상수 + 관리자용 달력 컴포넌트

**Files:**
- Create: `src/components/meal/meal-ui.ts`
- Create: `src/components/meal/AdminMealCalendar.tsx`

- [ ] **Step 1: `meal-ui.ts`**

```ts
import type { MealKind } from "@/lib/meal-plan";

export const MEAL_THEME: Record<MealKind, { side: string; head: string; cell: string; text: string }> = {
  BREAKFAST: { side: "bg-sky-100 dark:bg-sky-950", head: "bg-sky-50", cell: "bg-sky-50/60", text: "text-sky-700" },
  LUNCH: { side: "bg-orange-100 dark:bg-orange-950", head: "bg-orange-50", cell: "bg-orange-50/60", text: "text-orange-700" },
  DINNER: { side: "bg-rose-100 dark:bg-rose-950", head: "bg-rose-50", cell: "bg-rose-50/60", text: "text-rose-700" },
};
export const OPEN_DATE_BG = "bg-yellow-100 dark:bg-yellow-900/40"; // 개설일 하이라이트
```

- [ ] **Step 2: `AdminMealCalendar.tsx`** — 한 달 분량의 학년별 개설일 선택 그리드:

```tsx
"use client";
// props
interface AdminMealCalendarProps {
  year: number;
  month: number;
  mealKind: MealKind;
  checked: Set<string>;              // `${grade}:${YYYY-MM-DD}`
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}
```

구조 (리로 화면 차용, `<table>` + `overflow-x-auto` 래퍼, 셀 `whitespace-nowrap`):
- 캡션 행: `"{year}년 {MM}월 급식일 선택"` + 월 전체 토글 체크박스 (`checked.size === 모든 날짜×3` 일 때 checked).
- 요일 행: `일~토` 각각 체크박스 — 토글 시 그 요일의 모든 날짜×학년 키를 add/delete.
- 학년 행: 요일×학년(1·2·3) `⬇` 버튼(`min-h-11 min-w-11` 터치 타겟) — 해당 요일·학년 열 전체 토글.
- 본문: 주 단위 2행 쌍(날짜 숫자 행 / 체크박스 행). 각 날짜 셀에 학년 1·2·3 체크박스 3개(`<input type="checkbox">` 네이티브). 토글 시 `next = new Set(checked)` 복사 후 add/delete → `onChange(next)`.
- 날짜 키 생성은 `formatMonthDateKey(year, month, day)`, 요일 계산은 `weekdayOf`.
- `disabled` 시 전체 `pointer-events-none opacity-50`.

- [ ] **Step 3:** `npx tsc --noEmit` PASS → **Commit** — `feat(ui): 식사 색상 테마 + 관리자 학년별 개설일 달력`

### Task 17: 공고 작성/수정 페이지

**Files:**
- Create: `src/components/meal/ApplicationForm.tsx`
- Create: `src/app/admin/applications/new/page.tsx`
- Create: `src/app/admin/applications/[id]/edit/page.tsx`

- [ ] **Step 1: `ApplicationForm.tsx`** — 폼 상태와 제출:

```tsx
"use client";
interface ApplicationFormProps { applicationId?: number } // 있으면 수정 모드

interface MealFormState {
  price: string;                       // 입력 문자열
  exemptionSelectable: boolean;
  method: MealApplyMethod;
  checked: Set<string>;                // `${grade}:${date}`
}
// 페이지 상태: subject, description, startYear, startMonth, monthCount,
//   applyStartDate/"HH"/"MM" 시작·마감 6개 필드, meals: Record<MealKind, MealFormState>
```

- 수정 모드: mount 시 `GET /api/admin/applications/{id}` 로 프리필 (subject = `title.replace(/^\d{4}년 \d{2}월 /, "")`).
- 제목줄: `Select`(년: 올해~올해+1 / 월: 1~12 / 개월: 1~6) + `Input`(제목). 기본값 `new Date()` 의 년/월, 1개월, "급식신청".
- 내용: `<textarea rows={6}>`.
- 신청기간: `Input type="date"` + 시(`Select` 0~23) + 분(`Select` 0,5,…55) × 시작/마감.
- 설정사항: `MEAL_KINDS.map` 으로 3개 섹션. 좌측 세로 라벨 셀 `MEAL_THEME[kind].side`. 단가 `Input inputMode="numeric"`, 면제유무 `Select`(선택불가/선택가능), 신청방법 `Select`(METHOD_LABEL). `monthsOf(startYear, startMonth, monthCount)` 를 map 해 `AdminMealCalendar` 반복 렌더(method==="NONE" 이면 `disabled`).
- 개월수/시작월 변경 시: 범위를 벗어난 달의 체크를 제거(`checked` 에서 monthKey 가 새 범위 밖이면 delete).
- 제출(`저장`): body 로 변환 —

```ts
const meals = MEAL_KINDS.map((kind) => ({
  mealKind: kind,
  price: Number(form[kind].price || 0),
  exemptionSelectable: form[kind].exemptionSelectable,
  method: form[kind].method,
  dates: [...form[kind].checked].map((key) => {
    const [grade, date] = key.split(":");
    return { grade: Number(grade), date };
  }),
}));
const applyStartAt = `${startDate}T${sh}:${sm}:00+09:00`; // 마감 동일
// POST /api/admin/applications 또는 PUT .../{id}
// 성공: toast.success → router.push("/admin?tab=applications")
// 실패: toast.error(json.error)
```

- 클라이언트 검증: 마감>시작, NONE 아닌 식사의 checked 비어 있으면 toast 후 중단.

- [ ] **Step 2: 페이지 2개** — 서버 컴포넌트에서 `auth()` + `canWriteAdmin` 확인 후 미권한이면 `redirect("/admin/login")`, 권한 있으면 `<ApplicationForm />` / `<ApplicationForm applicationId={Number(params.id)} />` 렌더. 헤더는 `header-gradient` + 뒤로가기 링크.
- [ ] **Step 3:** `npm run build` 성공 → dev 에서 생성/수정 왕복 확인.
- [ ] **Step 4: Commit** — `feat(admin): 리로 방식 공고 작성/수정 페이지`

### Task 18: 신청관리 탭 목록 개편 + 설정 탭 중식

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 신청관리 탭** — 기존 공고 생성/수정 Dialog(`appForm`, `editingApp` 관련 state·JSX·핸들러)와 명단 Dialog(`selectedAppForReg`, `registrations`, BreakfastMatrixTable 사용부)를 **삭제**하고:
  - "새 공고 작성" 버튼 → `<Link href="/admin/applications/new">`.
  - 공고 카드: 제목/상태 배지(신청중·마감, `applyStartAt~applyEndAt` 포맷 표시)/식사 요약(`meals.map(m => `${MEAL_LABEL}` ${price}원·${METHOD_LABEL}`)` 칩, `MEAL_THEME[kind].text`)/신청 수.
  - 버튼: [통계·명단](`/admin/applications/{id}/stats`) [수정](`/admin/applications/{id}/edit`) [마감](기존 close POST) [삭제](기존 DELETE + confirm).
  - 목록 fetch 는 기존 GET 응답의 새 shape 사용.
- [ ] **Step 2: 설정 탭** — `windowsForm` 에 `lunch` 추가: 조식/중식/석식 3행 `Input type="time"` ×2. `validateMealWindows` 가 3윈도우를 받으므로 그대로 호출. PUT body 에 `lunch` 포함.
- [ ] **Step 3:** `npm run build` + dev 스모크(목록·마감·삭제·설정 저장).
- [ ] **Step 4: Commit** — `feat(admin): 신청관리 탭을 페이지 링크 구조로 개편, 중식 시간대 설정`

### Task 19: 학생 신청 UI

**Files:**
- Create: `src/components/meal/StudentMealCalendar.tsx`
- Create: `src/components/meal/StudentApplicationView.tsx`
- Modify: `src/app/student/page.tsx`

- [ ] **Step 1: `StudentMealCalendar.tsx`** — 학생용 한 달 달력:

```tsx
interface StudentMealCalendarProps {
  year: number; month: number;
  mealKind: MealKind;
  openDates: Set<string>;            // 본인 학년 개설일
  mode: "readonly" | "weekday" | "date";
  selectedDates: Set<string>;        // 현재 선택 (모든 mode 에서 표시용)
  selectedWeekdays?: Set<number>;    // weekday mode
  onToggleDate?: (date: string) => void;
  onToggleWeekday?: (weekday: number) => void;
}
```

- `<table>` 7열, 헤더 일~토 (weekday mode 면 요일 옆 체크박스, 그 달 개설일이 있는 요일만 활성).
- 셀: 개설일이면 `OPEN_DATE_BG`, date mode 면 체크박스+날짜, 선택된 날짜는 진한 배경. readonly 는 표시만.

- [ ] **Step 2: `StudentApplicationView.tsx`** — 공고 상세+신청 폼 (신청 탭 안에서 목록→상세 전환):

```tsx
interface StudentApplicationViewProps {
  applicationId: number;
  onBack: () => void;
  onSubmitted: () => void; // mutate 용
}
```

- mount 시 `GET /api/applications/{id}` → 상태 구성. `myRegistration` 있으면 식사별 `applied/exempt/selectedDates/weekdaysByMonth` 복원.
- 상단 정보 표: 신청 기간(`MM-DD HH시mm분 ~`), 신청 인원(registrationCount), 신청자(이름·학번 `studentNumberOf`).
- 식사 섹션 (method ≠ NONE 만): 헤더 `MEAL_THEME[kind].side` + `MEAL_LABEL`:
  - YN: 라디오 `신청함/신청안함` (네이티브 `<input type="radio">`). 달력 readonly.
  - WEEKDAY: 월별 `StudentMealCalendar mode="weekday"`. `selectedDates` 는 `expandWeekdays(openDates(월), weekdays)` 로 파생 표시.
  - DATE: `mode="date"`.
  - exemptionSelectable 시 체크박스 `면제 대상입니다`.
  - 금액 줄: `총 급식비 : {fee.toLocaleString()}원({price.toLocaleString()}원X{dayCount}일)` — dayCount 는 mode 별 선택 날짜 수, `calcMealFee` 사용.
- 하단: 전체 합계 + `SignaturePad onSignatureChange` + [신청하기]/[신청 취소](기존 신청 있을 때) + [목록으로].
- 제출 body (Task 10 의 스키마와 동일):

```ts
{ signature, meals: MEAL_KINDS.filter(개설됨).map((kind) => ({
    mealKind: kind, applied: state[kind].applied, exempt: state[kind].exempt,
    selectedDates: method === "DATE" ? [...state[kind].dates] : undefined,
    weekdaysByMonth: method === "WEEKDAY"
      ? Object.fromEntries([...months].map((m) => [`${m.year}-${MM}`, [...state[kind].weekdays[mKey]]]))
      : undefined,
  })) }
```

- 성공 toast → `onSubmitted()` → `onBack()`.

- [ ] **Step 3: `student/page.tsx` 신청 탭 교체** — 기존 카드+서명 Dialog 흐름 제거. 목록 카드(제목·기간·myStatus 배지·식사 칩) 클릭 → `StudentApplicationView` 렌더. "신청내역" 버튼 → 기존 `/api/applications/my` 기반 요약(식사별 일수·금액) Dialog 로 개편.
- [ ] **Step 4:** `npm run build` + dev 에서 3가지 방법 신청/수정/취소 확인.
- [ ] **Step 5: Commit** — `feat(student): 리로 방식 식사별 신청 화면`

### Task 20: 통계 페이지

**Files:**
- Create: `src/app/admin/applications/[id]/stats/page.tsx`
- Create: `src/components/meal/ApplicationStats.tsx`

- [ ] **Step 1: 페이지** — 서버 컴포넌트 가드(`canReadAdmin`) 후 `<ApplicationStats applicationId={...} />`.
- [ ] **Step 2: `ApplicationStats.tsx`**
- SWR: `GET /api/admin/applications/{id}/registrations`.
- 툴바: 학년/학급 `Select` 필터, [일괄신청](양식 다운로드 `?template=true` + 파일 업로드 → import POST), [엑셀저장](export GET), [신청 추가](사용자 검색 → Task 12 POST).
- 표 (래퍼 `overflow-x-auto`, thead sticky top-0 bg 지정, 셀 `whitespace-nowrap`):
  `순번 | 입력시간 | 아이디 | 학번 | 이름 | 성별 | {개설 식사별: 면제 · 신청일수} | 관리`.
  관리: [수정](학생과 동일 편집 — `StudentApplicationView` 의 폼 부분을 Dialog 로 재사용하거나 단순 식사별 토글 Dialog, PATCH `{ meals }`), [삭제](DELETE + confirm).
- 하단 합계: 학년별(1·2·3) 행 + 전체 행 — 각 행에 신청자 수(남/여 구분), 식사별 면제 수·신청일수 합.
- 취소(CANCELLED) 행은 회색 + 토글로 표시/숨김.
- [ ] **Step 3:** `npm run build` + dev 스모크 (필터·수정·삭제·엑셀·일괄신청).
- [ ] **Step 4: Commit** — `feat(admin): 리로 방식 신청 통계 페이지`

### Task 21: 기존 화면 중식 표시

**Files:**
- Modify: `src/components/AdminMealTable.tsx` — mealColumns 의 `shortLabel: "중"` 헤더/토글(mealKind 전달) 그대로 동작하는지 확인, 합계 행 포함.
- Modify: `src/components/MonthlyCalendar.tsx` — 셀에 LUNCH 체크인 표시 (`중식 HH:MM`, `MEAL_THEME.LUNCH.text`).
- Modify: 관리자 당일현황 탭 (`src/app/admin/page.tsx` dashboard 섹션) — `hasLunch`/`lunchStudentCount` 카드 표시.

- [ ] **Step 1:** 세 파일 수정 → `npm run build`.
- [ ] **Step 2:** dev 에서 toggle API 로 LUNCH 체크인 만들고 표/달력/대시보드 표시 확인.
- [ ] **Step 3: Commit** — `feat(ui): 체크인 표·달력·당일현황 중식 표시`

---

## Phase 6 — 검증/마무리

### Task 22: 통합 검증 + 맵 갱신 + 배포

- [ ] **Step 1:** `npm test` 전체 PASS, `npm run build` 성공.
- [ ] **Step 2:** `responsive-ui-reviewer` 에이전트로 신규 UI 파일(ApplicationForm, AdminMealCalendar, StudentMealCalendar, StudentApplicationView, ApplicationStats, admin/student page 수정분) 점검 → 위반 수정.
- [ ] **Step 3:** Playwright(webapp-testing)로 E2E: 관리자 로그인 → 공고 생성(조식 YN·중식 WEEKDAY·석식 DATE 혼합) → 학생 신청 → 수정 → 통계 확인 → 엑셀 다운로드 → QR 중식 체크인(설정 시간대 변경 후).
- [ ] **Step 4:** `project-map-updater` 에이전트로 PROJECT_MAP.md 갱신 (새 라우트/모델/컴포넌트/lib).
- [ ] **Step 5:** `git push` → test 서비스(`posanmeal.up.railway.app`) 배포 확인 → 마이그레이션 적용 로그 확인 → 수동 검증.
- [ ] **Step 6:** 사용자 승인 후 `main` 머지 → prod 배포. **구 컬럼 정리(2차 마이그레이션)는 별도 후속 작업**으로 양쪽 안정 가동 후 진행.

---

## Self-Review 결과 (스펙 대비)

- 스펙 §3 데이터 모델 → Task 4·5 / §4 마이그레이션 → Task 5 / §5 시간대·체크인 → Task 1·2·8·11 / §6 공고 생성 → Task 9·16·17·18 / §7 학생 신청 → Task 10·19 / §8 통계+엑셀 → Task 12·13·14·20 / §9 기존 화면 → Task 3·15·21 / §11 검증 → 각 태스크 Step + Task 22. 누락 없음.
- 구 코드 호환: 1차 릴리스 동안 구 컬럼·테이블 유지 (`type:"MULTI"` 마커), drop 은 후속.
