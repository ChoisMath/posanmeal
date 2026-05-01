# 조식 날짜별 신청 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 조식(`BREAKFAST`)을 날짜 단위 신청·체크인으로 분해하고, 같은 날 조식+석식 동시 운영을 가능하게 한다. 석식 동작은 보존.

**Architecture:** 정규화된 별도 테이블(`MealApplicationDate`, `MealRegistrationDate`)로 날짜 집합을 표현. `CheckIn` unique 키를 `(userId, date, mealKind)` 로 확장. 시간대 자동분기로 `mealKind` 결정. 5단계 배포(additive→backfill→destructive) + IndexedDB v3→v4.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + PostgreSQL, Auth.js v5, Tailwind v4 + shadcn/ui, exceljs, Vitest(신규), nimiq/qr-scanner.

**Spec:** [docs/superpowers/specs/2026-05-02-breakfast-date-selection-design.md](../specs/2026-05-02-breakfast-date-selection-design.md)

---

## File Structure (변경 영향)

### 신규 파일
- `src/lib/meal-kind.ts` — 서버 헬퍼 (`MealKind`, `resolveMealKind`, `isStudentEligibleToday`)
- `src/lib/meal-kind-local.ts` — 클라이언트 헬퍼 (태블릿/학생 디바이스용)
- `src/lib/schemas/application.ts` — zod discriminatedUnion 공고 스키마
- `src/lib/__tests__/meal-kind.test.ts` — 시간대 분기 단위 테스트
- `src/lib/__tests__/meal-kind-local.test.ts`
- `src/lib/__tests__/breakfast-validation.test.ts` — selectedDates ⊆ allowedDates
- `src/components/MealKindBadge.tsx`
- `src/components/DateMultiPicker.tsx` — 관리자 캘린더 다중선택
- `src/components/DateCheckboxList.tsx` — 학생 체크박스 리스트
- `src/components/BreakfastMatrixTable.tsx` — 학생×날짜 매트릭스
- `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` — PATCH 추가 (기존 파일 확장)
- `prisma/migrations/<timestamp>_add_meal_dates_and_mealkind_nullable/migration.sql`
- `prisma/migrations/<timestamp>_backfill_meal_kind_and_breakfast_dates/migration.sql`
- `prisma/migrations/<timestamp>_enforce_meal_kind_unique/migration.sql`
- `vitest.config.ts`

### 수정 파일
- `prisma/schema.prisma`
- `package.json` — `vitest` devDep + `test` script
- 서버 라우트: `applications/{my,route,[id]/register}`, `qr/token`, `checkin`, `sync/{download,upload}`, `admin/applications/{route,[id]/{route,close,export,import,registrations/{route,[id]/route}}}`, `admin/{checkins/{route,toggle},dashboard,export}`, `system/settings`
- `src/lib/{qr-token,settings-cache,local-db,timezone}.ts`
- 페이지: `src/app/{student,admin,check}/page.tsx`
- 컴포넌트: `src/components/{QRGenerator,MonthlyCalendar,AdminMealTable}.tsx`
- 훅: `src/hooks/useApplications.ts` (타입 확장)

---

## Phase 0 — 사전 인프라 (Vitest + 헬퍼)

### Task 0.1: Vitest 셋업

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Vitest devDep 설치**

```bash
npm install -D vitest @types/node
```

- [ ] **Step 2: `vitest.config.ts` 작성**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 3: `package.json` scripts 에 추가**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: 더미 테스트로 검증**

`src/lib/__tests__/sanity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("sanity", () => { it("works", () => expect(1).toBe(1)); });
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: 더미 테스트 삭제 + 커밋**

```bash
rm src/lib/__tests__/sanity.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): vitest 설정 추가"
```

---

### Task 0.2: meal-kind 서버 헬퍼 (TDD)

**Files:**
- Create: `src/lib/meal-kind.ts`
- Test: `src/lib/__tests__/meal-kind.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/meal-kind.test.ts
import { describe, it, expect } from "vitest";
import { resolveMealKind, type MealWindows } from "@/lib/meal-kind";

const w: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner:    { start: "15:00", end: "21:00" },
};
function at(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

describe("resolveMealKind", () => {
  it("조식 윈도우 안", () => expect(resolveMealKind(at("07:00"), w)).toBe("BREAKFAST"));
  it("조식 시작 경계 포함", () => expect(resolveMealKind(at("04:00"), w)).toBe("BREAKFAST"));
  it("조식 끝 경계 직전", () => expect(resolveMealKind(at("09:59"), w)).toBe("BREAKFAST"));
  it("조식 끝 경계 직후", () => expect(resolveMealKind(at("10:00"), w)).toBeNull());
  it("점심 시간(둘 다 외)", () => expect(resolveMealKind(at("12:30"), w)).toBeNull());
  it("석식 윈도우 안", () => expect(resolveMealKind(at("18:00"), w)).toBe("DINNER"));
  it("석식 끝 경계 직후", () => expect(resolveMealKind(at("21:00"), w)).toBeNull());
  it("자정 직전", () => expect(resolveMealKind(at("23:30"), w)).toBeNull());
});
```

- [ ] **Step 2: 테스트 실행, 실패 확인**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/meal-kind'".

- [ ] **Step 3: 헬퍼 구현**

```ts
// src/lib/meal-kind.ts
import { prisma } from "@/lib/prisma";

export type MealKind = "BREAKFAST" | "DINNER";

export interface MealWindows {
  breakfast: { start: string; end: string };  // "HH:MM"
  dinner:    { start: string; end: string };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function resolveMealKind(now: Date, w: MealWindows): MealKind | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inWindow = (s: string, e: string) =>
    minutes >= toMinutes(s) && minutes < toMinutes(e);

  if (inWindow(w.breakfast.start, w.breakfast.end)) return "BREAKFAST";
  if (inWindow(w.dinner.start,    w.dinner.end))    return "DINNER";
  return null;
}

export async function isStudentEligibleToday(
  userId: number,
  mealKind: MealKind,
  todayDate: Date,
): Promise<boolean> {
  if (mealKind === "DINNER") {
    const reg = await prisma.mealRegistration.findFirst({
      where: {
        userId,
        status: "APPROVED",
        application: {
          type: "DINNER",
          mealStart: { not: null, lte: todayDate },
          mealEnd:   { not: null, gte: todayDate },
        },
      },
    });
    return !!reg;
  }
  // BREAKFAST
  const date = await prisma.mealRegistrationDate.findFirst({
    where: {
      date: todayDate,
      registration: { userId, status: "APPROVED" },
    },
  });
  return !!date;
}
```

- [ ] **Step 4: 테스트 실행, 통과 확인**

Run: `npm test`
Expected: PASS — 8 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/meal-kind.ts src/lib/__tests__/meal-kind.test.ts
git commit -m "feat(lib): meal-kind 헬퍼 + 시간대 자동분기"
```

---

### Task 0.3: meal-kind-local 클라이언트 헬퍼 (TDD)

**Files:**
- Create: `src/lib/meal-kind-local.ts`
- Test: `src/lib/__tests__/meal-kind-local.test.ts`

- [ ] **Step 1: 테스트**

```ts
// src/lib/__tests__/meal-kind-local.test.ts
import { describe, it, expect } from "vitest";
import { resolveMealKindLocal, type MealWindows } from "@/lib/meal-kind-local";

const w: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner:    { start: "15:00", end: "21:00" },
};
function at(h: number, m = 0) { const d = new Date(); d.setHours(h, m, 0, 0); return d; }

describe("resolveMealKindLocal", () => {
  it("조식", () => expect(resolveMealKindLocal(at(7), w)).toBe("BREAKFAST"));
  it("석식", () => expect(resolveMealKindLocal(at(18), w)).toBe("DINNER"));
  it("점심 외부", () => expect(resolveMealKindLocal(at(12), w)).toBeNull());
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: 구현 (서버 헬퍼와 동일 로직, prisma 의존 없는 순수 함수만 분리)**

```ts
// src/lib/meal-kind-local.ts
export type MealKind = "BREAKFAST" | "DINNER";

export interface MealWindows {
  breakfast: { start: string; end: string };
  dinner:    { start: string; end: string };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function resolveMealKindLocal(now: Date, w: MealWindows): MealKind | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const inWindow = (s: string, e: string) =>
    minutes >= toMinutes(s) && minutes < toMinutes(e);
  if (inWindow(w.breakfast.start, w.breakfast.end)) return "BREAKFAST";
  if (inWindow(w.dinner.start,    w.dinner.end))    return "DINNER";
  return null;
}

export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner:    { start: "15:00", end: "21:00" },
};
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/meal-kind-local.ts src/lib/__tests__/meal-kind-local.test.ts
git commit -m "feat(lib): 클라이언트 측 시간대 분기 헬퍼"
```

---

### Task 0.4: BREAKFAST 검증 헬퍼 (TDD)

**Files:**
- Create: `src/lib/breakfast-validation.ts`
- Test: `src/lib/__tests__/breakfast-validation.test.ts`

- [ ] **Step 1: 테스트**

```ts
// src/lib/__tests__/breakfast-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateSelectedDates } from "@/lib/breakfast-validation";

describe("validateSelectedDates", () => {
  const allowed = ["2026-05-05","2026-05-07","2026-05-12"];

  it("부분집합 통과", () => expect(validateSelectedDates(["2026-05-05"], allowed).ok).toBe(true));
  it("동일 셋 통과", () => expect(validateSelectedDates(allowed, allowed).ok).toBe(true));
  it("빈 셋 실패", () => expect(validateSelectedDates([], allowed)).toEqual({ ok:false, code:"INVALID_DATES" }));
  it("외부 날짜 포함 실패", () => expect(validateSelectedDates(["2026-05-06"], allowed)).toEqual({ ok:false, code:"INVALID_DATES" }));
  it("일부 외부 실패", () => expect(validateSelectedDates(["2026-05-05","2026-05-06"], allowed)).toEqual({ ok:false, code:"INVALID_DATES" }));
  it("중복 입력 정규화", () => expect(validateSelectedDates(["2026-05-05","2026-05-05"], allowed).ok).toBe(true));
});
```

- [ ] **Step 2: 실패 확인** — Run `npm test`, FAIL.

- [ ] **Step 3: 구현**

```ts
// src/lib/breakfast-validation.ts
export type ValidationResult =
  | { ok: true; dates: string[] }
  | { ok: false; code: "INVALID_DATES" };

export function validateSelectedDates(
  selected: string[],
  allowed: string[],
): ValidationResult {
  const unique = Array.from(new Set(selected));
  if (unique.length === 0) return { ok: false, code: "INVALID_DATES" };
  const allowedSet = new Set(allowed);
  for (const d of unique) {
    if (!allowedSet.has(d)) return { ok: false, code: "INVALID_DATES" };
  }
  return { ok: true, dates: unique };
}
```

- [ ] **Step 4: 통과 확인** — Run `npm test`, PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/breakfast-validation.ts src/lib/__tests__/breakfast-validation.test.ts
git commit -m "feat(lib): selectedDates 검증 헬퍼"
```

---

## Phase 1 — DB-A (additive 마이그레이션)

### Task 1.1: Prisma 스키마 변경

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: enum + 모델 추가**

`prisma/schema.prisma` 의 `enum CheckInSource` 블록 다음에 추가:

```prisma
enum MealKind {
  BREAKFAST
  DINNER
}
```

`MealApplication` 모델 마지막에 `allowedDates` 필드, 그리고 모델 자체 다음에 새 모델 2개 추가:

```prisma
model MealApplication {
  // ...기존 필드 그대로...
  registrations MealRegistration[]
  allowedDates  MealApplicationDate[]   // ← 추가

  @@index([status])
  @@index([applyStart, applyEnd])
}

model MealApplicationDate {
  applicationId Int
  date          DateTime @db.Date
  application   MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@id([applicationId, date])
  @@index([date])
}

model MealRegistration {
  // ...기존 필드 그대로...
  updatedAt     DateTime @updatedAt    // ← 추가
  // ...
  selectedDates MealRegistrationDate[]   // ← 추가
}

model MealRegistrationDate {
  registrationId Int
  date           DateTime @db.Date
  createdAt      DateTime @default(now())
  registration   MealRegistration @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@id([registrationId, date])
  @@index([date])
}
```

`CheckIn` 에 mealKind 추가 (nullable 로 시작) + 인덱스:

```prisma
model CheckIn {
  id        Int            @id @default(autoincrement())
  userId    Int
  date      DateTime       @db.Date
  mealKind  MealKind?       // ← 추가 (Phase 1 단계는 nullable. Phase 4 에서 NOT NULL)
  checkedAt DateTime       @default(now())
  type      CheckInType
  source    CheckInSource?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, date])     // ← Phase 1 까지 유지. Phase 4 에서 변경.
  @@index([date])
  @@index([userId])
  @@index([date, mealKind])    // ← 추가
}
```

- [ ] **Step 2: 마이그레이션 생성 (로컬 DB 기준)**

Run:
```bash
docker compose up -d
npx prisma migrate dev --name add_meal_dates_and_mealkind_nullable --create-only
```

생성된 `prisma/migrations/<timestamp>_add_meal_dates_and_mealkind_nullable/migration.sql` 확인.
Expected: 새 테이블 2개 + enum 1개 + ALTER TABLE 추가만 있고 destructive 변경(DROP/ALTER COLUMN NOT NULL/UNIQUE 변경) 은 없어야 함.

- [ ] **Step 3: SystemSetting seed 를 마이그레이션에 추가**

생성된 SQL 파일 끝에 수동으로 추가:

```sql
INSERT INTO "SystemSetting"("key","value","updatedAt") VALUES
  ('breakfast_window_start','04:00', NOW()),
  ('breakfast_window_end',  '10:00', NOW()),
  ('dinner_window_start',   '15:00', NOW()),
  ('dinner_window_end',     '21:00', NOW())
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 4: 로컬 마이그레이션 적용**

Run:
```bash
npx prisma migrate dev
npx prisma generate
```

Expected: 적용 성공. `src/generated/prisma` 갱신.

- [ ] **Step 5: prisma-migration-guardian 으로 검수**

별도 에이전트 호출 (사용자 승인 후):
```
prisma-migration-guardian 에이전트로 마이그레이션 SQL 점검.
대상: prisma/migrations/<timestamp>_add_meal_dates_and_mealkind_nullable/migration.sql
```

- [ ] **Step 6: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): 조식 날짜 모델 + CheckIn.mealKind nullable 추가 (Phase 1)"
```

---

## Phase 2 — 코드-A (새 동작 구현)

### Task 2A.1: zod 공고 스키마 (discriminatedUnion)

**Files:**
- Create: `src/lib/schemas/application.ts`

- [ ] **Step 1: zod 의존성 확인**

Run: `npm ls zod`
Expected: 이미 의존성에 있음 (shadcn 경유). 없으면 `npm install zod`.

- [ ] **Step 2: 스키마 작성**

```ts
// src/lib/schemas/application.ts
import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  applyStart: dateString,
  applyEnd: dateString,
};

export const dinnerSchema = z.object({
  type: z.literal("DINNER"),
  ...baseFields,
  mealStart: dateString,
  mealEnd: dateString,
});

export const breakfastSchema = z.object({
  type: z.literal("BREAKFAST"),
  ...baseFields,
  allowedDates: z.array(dateString).min(1),
});

export const otherSchema = z.object({
  type: z.literal("OTHER"),
  ...baseFields,
});

export const applicationSchema = z.discriminatedUnion("type", [
  dinnerSchema,
  breakfastSchema,
  otherSchema,
]);

export const registerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DINNER"),
    signature: z.string().min(1),
  }),
  z.object({
    type: z.literal("BREAKFAST"),
    signature: z.string().min(1),
    selectedDates: z.array(dateString).min(1),
  }),
]);

export const patchRegistrationSchema = z.object({
  addDates: z.array(dateString).optional(),
  removeDates: z.array(dateString).optional(),
}).refine(
  (d) => (d.addDates?.length ?? 0) + (d.removeDates?.length ?? 0) > 0,
  { message: "addDates 또는 removeDates 중 하나는 필요합니다." },
);
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/schemas/application.ts
git commit -m "feat(lib): zod 공고/등록 스키마"
```

---

### Task 2A.2: POST/PUT /api/admin/applications BREAKFAST 분기

**Files:**
- Modify: `src/app/api/admin/applications/route.ts`
- Modify: `src/app/api/admin/applications/[id]/route.ts`

- [ ] **Step 1: POST 라우트 변경**

`src/app/api/admin/applications/route.ts` 의 `POST` 함수 전체 교체:

```ts
import { applicationSchema } from "@/lib/schemas/application";

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const data = parsed.data;

  if (data.type === "BREAKFAST") {
    // 다른 진행중 BREAKFAST 공고와 날짜 겹침 검사
    const overlap = await prisma.mealApplicationDate.findFirst({
      where: {
        date: { in: data.allowedDates.map((d) => new Date(d)) },
        application: { type: "BREAKFAST", status: "OPEN" },
      },
    });
    if (overlap) {
      return NextResponse.json(
        { error: "다른 진행중 조식 공고와 날짜가 겹칩니다.", errorCode: "OVERLAPPING_DATES" },
        { status: 409 },
      );
    }
    const sorted = [...data.allowedDates].sort();
    const application = await prisma.mealApplication.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        type: "BREAKFAST",
        applyStart: new Date(data.applyStart),
        applyEnd:   new Date(data.applyEnd),
        mealStart:  new Date(sorted[0]),
        mealEnd:    new Date(sorted[sorted.length - 1]),
        allowedDates: { create: sorted.map((d) => ({ date: new Date(d) })) },
      },
    });
    return NextResponse.json({ application }, { status: 201 });
  }

  // DINNER / OTHER
  const application = await prisma.mealApplication.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      type: data.type,
      applyStart: new Date(data.applyStart),
      applyEnd:   new Date(data.applyEnd),
      mealStart:  data.type === "DINNER" ? new Date(data.mealStart) : null,
      mealEnd:    data.type === "DINNER" ? new Date(data.mealEnd) : null,
    },
  });
  return NextResponse.json({ application }, { status: 201 });
}
```

- [ ] **Step 2: PUT 라우트 변경**

`src/app/api/admin/applications/[id]/route.ts` 의 `PUT` 함수 전체 교체:

```ts
import { applicationSchema } from "@/lib/schemas/application";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const appId = parseInt(id);
  const body = await request.json();
  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const data = parsed.data;

  if (data.type === "BREAKFAST") {
    const newDates = [...data.allowedDates].sort();
    const newSet = new Set(newDates);

    // 다른 진행중 BREAKFAST 공고와 날짜 겹침 검사 (자기 자신 제외)
    const overlap = await prisma.mealApplicationDate.findFirst({
      where: {
        date: { in: newDates.map((d) => new Date(d)) },
        applicationId: { not: appId },
        application: { type: "BREAKFAST", status: "OPEN" },
      },
    });
    if (overlap) {
      return NextResponse.json(
        { error: "다른 진행중 조식 공고와 날짜가 겹칩니다.", errorCode: "OVERLAPPING_DATES" },
        { status: 409 },
      );
    }

    const old = await prisma.mealApplicationDate.findMany({
      where: { applicationId: appId },
      select: { date: true },
    });
    const removedDates = old
      .map((o) => o.date.toISOString().slice(0, 10))
      .filter((d) => !newSet.has(d));
    const addedDates = newDates.filter(
      (d) => !old.some((o) => o.date.toISOString().slice(0, 10) === d),
    );

    let affectedRegistrations = 0;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.mealApplication.update({
        where: { id: appId },
        data: {
          title: data.title,
          description: data.description ?? null,
          applyStart: new Date(data.applyStart),
          applyEnd:   new Date(data.applyEnd),
          mealStart:  new Date(newDates[0]),
          mealEnd:    new Date(newDates[newDates.length - 1]),
        },
      });
      if (removedDates.length) {
        await tx.mealApplicationDate.deleteMany({
          where: { applicationId: appId, date: { in: removedDates.map((d) => new Date(d)) } },
        });
        const affected = await tx.mealRegistrationDate.deleteMany({
          where: {
            date: { in: removedDates.map((d) => new Date(d)) },
            registration: { applicationId: appId },
          },
        });
        affectedRegistrations = affected.count;
      }
      if (addedDates.length) {
        await tx.mealApplicationDate.createMany({
          data: addedDates.map((d) => ({ applicationId: appId, date: new Date(d) })),
        });
      }
      return updated;
    });
    return NextResponse.json({ application: result, affectedRegistrations });
  }

  // DINNER / OTHER
  const application = await prisma.mealApplication.update({
    where: { id: appId },
    data: {
      title: data.title,
      description: data.description ?? null,
      type: data.type,
      applyStart: new Date(data.applyStart),
      applyEnd:   new Date(data.applyEnd),
      mealStart:  data.type === "DINNER" ? new Date(data.mealStart) : null,
      mealEnd:    data.type === "DINNER" ? new Date(data.mealEnd) : null,
    },
  });
  return NextResponse.json({ application });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/route.ts src/app/api/admin/applications/[id]/route.ts
git commit -m "feat(api): 관리자 공고 생성/수정 BREAKFAST 분기 + 겹침 검증"
```

---

### Task 2A.3: GET /api/admin/applications 응답 보강

**Files:**
- Modify: `src/app/api/admin/applications/route.ts`

- [ ] **Step 1: GET 함수에 dailyCounts + allowedDatesCount 추가**

기존 `GET` 함수 교체:

```ts
export async function GET() {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [applications, cancelledCounts, breakfastDailyCounts] = await Promise.all([
    prisma.mealApplication.findMany({
      include: {
        _count: {
          select: {
            registrations: { where: { status: "APPROVED" } },
            allowedDates: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mealRegistration.groupBy({
      by: ["applicationId"],
      where: { status: "CANCELLED" },
      _count: true,
    }),
    prisma.mealRegistrationDate.groupBy({
      by: ["date"],
      where: { registration: { status: "APPROVED" } },
      _count: true,
    }),
  ]);

  const cancelledMap = new Map(cancelledCounts.map((c) => [c.applicationId, c._count]));

  // 날짜별 카운트를 application 별로 집계
  const dateToApp: Record<string, number> = {};
  for (const app of applications) {
    if (app.type !== "BREAKFAST") continue;
    const dates = await prisma.mealApplicationDate.findMany({
      where: { applicationId: app.id },
      select: { date: true },
    });
    for (const d of dates) dateToApp[d.date.toISOString().slice(0, 10)] = app.id;
  }

  const dailyCountsByApp: Record<number, Record<string, number>> = {};
  for (const c of breakfastDailyCounts) {
    const dateKey = c.date.toISOString().slice(0, 10);
    const appId = dateToApp[dateKey];
    if (appId == null) continue;
    dailyCountsByApp[appId] ??= {};
    dailyCountsByApp[appId][dateKey] = c._count;
  }

  const appsWithCounts = applications.map((app) => ({
    ...app,
    cancelledCount: cancelledMap.get(app.id) || 0,
    allowedDatesCount: app._count.allowedDates,
    dailyCounts: dailyCountsByApp[app.id] ?? {},
  }));

  return NextResponse.json({ applications: appsWithCounts });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/admin/applications/route.ts
git commit -m "feat(api): GET /admin/applications 에 allowedDatesCount + dailyCounts 추가"
```

---

### Task 2A.4: PATCH /api/admin/applications/[id]/registrations/[regId] (신규)

**Files:**
- Modify: `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`

- [ ] **Step 1: 기존 파일 확인**

```bash
cat src/app/api/admin/applications/\[id\]/registrations/\[regId\]/route.ts
```

기존 DELETE 가 들어있을 것. 그 아래에 PATCH 추가.

- [ ] **Step 2: PATCH 함수 추가**

기존 파일에 `PATCH` 함수 추가:

```ts
import { patchRegistrationSchema } from "@/lib/schemas/application";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, regId } = await params;
  const appId = parseInt(id);
  const registrationId = parseInt(regId);

  const body = await request.json();
  const parsed = patchRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const { addDates = [], removeDates = [] } = parsed.data;

  // 검증: addDates ⊆ allowedDates
  if (addDates.length) {
    const allowed = await prisma.mealApplicationDate.findMany({
      where: { applicationId: appId, date: { in: addDates.map((d) => new Date(d)) } },
      select: { date: true },
    });
    if (allowed.length !== new Set(addDates).size) {
      return NextResponse.json(
        { error: "허용되지 않은 날짜가 포함되었습니다.", errorCode: "INVALID_DATES" },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (removeDates.length) {
      await tx.mealRegistrationDate.deleteMany({
        where: { registrationId, date: { in: removeDates.map((d) => new Date(d)) } },
      });
    }
    if (addDates.length) {
      await tx.mealRegistrationDate.createMany({
        data: addDates.map((d) => ({ registrationId, date: new Date(d) })),
        skipDuplicates: true,
      });
    }
    await tx.mealRegistration.update({
      where: { id: registrationId },
      data: { updatedAt: new Date() },
    });
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/\[id\]/registrations/\[regId\]/route.ts
git commit -m "feat(api): 관리자 등록 PATCH (BREAKFAST 부분 추가/제거)"
```

---

### Task 2B.1: GET /api/applications 응답 보강

**Files:**
- Modify: `src/app/api/applications/route.ts`

- [ ] **Step 1: include 에 allowedDates + selectedDates 추가**

기존 `GET` 의 `include` 블록 확장:

```ts
const applications = await prisma.mealApplication.findMany({
  where: {
    status: "OPEN",
    applyStart: { lte: today },
    applyEnd:   { gte: today },
  },
  include: {
    allowedDates: { select: { date: true }, orderBy: { date: "asc" } },
    registrations: {
      where: { userId: session.user.dbUserId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        selectedDates: { select: { date: true }, orderBy: { date: "asc" } },
      },
    },
  },
  orderBy: { applyEnd: "asc" },
});
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/applications/route.ts
git commit -m "feat(api): GET /applications 응답에 allowedDates + selectedDates 포함"
```

---

### Task 2B.2: POST/DELETE /api/applications/[id]/register BREAKFAST 분기

**Files:**
- Modify: `src/app/api/applications/[id]/register/route.ts`

- [ ] **Step 1: POST 함수 전체 교체**

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { validateSelectedDates } from "@/lib/breakfast-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id);
  const body = await request.json();
  const { signature, selectedDates: rawSelectedDates } = body;

  if (!signature) {
    return NextResponse.json({ error: "서명이 필요합니다.", errorCode: "RESIGN_REQUIRED" }, { status: 400 });
  }
  if (signature.length > 200_000) {
    return NextResponse.json({ error: "서명 데이터가 너무 큽니다." }, { status: 400 });
  }

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    include: { allowedDates: { select: { date: true } } },
  });

  if (!app || app.status !== "OPEN" || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json({ error: "신청 기간이 아닙니다.", errorCode: "OUT_OF_APPLY_WINDOW" }, { status: 400 });
  }

  // BREAKFAST 검증
  let normalizedDates: string[] | null = null;
  if (app.type === "BREAKFAST") {
    if (!Array.isArray(rawSelectedDates)) {
      return NextResponse.json({ error: "선택 날짜가 필요합니다.", errorCode: "INVALID_DATES" }, { status: 400 });
    }
    const allowed = app.allowedDates.map((d) => d.date.toISOString().slice(0, 10));
    const result = validateSelectedDates(rawSelectedDates, allowed);
    if (!result.ok) {
      return NextResponse.json({ error: "허용되지 않은 날짜이거나 비어 있습니다.", errorCode: "INVALID_DATES" }, { status: 400 });
    }
    normalizedDates = result.dates;
  }

  try {
    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
    });

    if (existing?.status === "APPROVED" && app.type !== "BREAKFAST") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }

    const reg = await prisma.$transaction(async (tx) => {
      const upserted = existing
        ? await tx.mealRegistration.update({
            where: { id: existing.id },
            data: {
              status: "APPROVED",
              signature,
              cancelledAt: null,
              cancelledBy: null,
            },
          })
        : await tx.mealRegistration.create({
            data: { applicationId, userId: session.user.dbUserId, signature },
          });

      if (app.type === "BREAKFAST" && normalizedDates) {
        await tx.mealRegistrationDate.deleteMany({ where: { registrationId: upserted.id } });
        await tx.mealRegistrationDate.createMany({
          data: normalizedDates.map((d) => ({ registrationId: upserted.id, date: new Date(d) })),
        });
      }
      return upserted;
    });

    return NextResponse.json({ registration: reg }, { status: existing ? 200 : 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }
    throw err;
  }
}
```

DELETE 함수는 기존 그대로 유지 (자식 cascade).

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/applications/\[id\]/register/route.ts
git commit -m "feat(api): 학생 신청 BREAKFAST 분기 (selectedDates + 재서명)"
```

---

### Task 2B.3: GET /api/applications/my 응답 보강

**Files:**
- Modify: `src/app/api/applications/my/route.ts`

- [ ] **Step 1: include 확장**

```ts
const registrations = await prisma.mealRegistration.findMany({
  where: { userId: session.user.dbUserId },
  include: {
    application: {
      select: {
        id: true, title: true, type: true, description: true,
        applyStart: true, applyEnd: true, mealStart: true, mealEnd: true, status: true,
        allowedDates: { select: { date: true }, orderBy: { date: "asc" } },
      },
    },
    selectedDates: { select: { date: true }, orderBy: { date: "asc" } },
  },
  orderBy: { createdAt: "desc" },
});
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/applications/my/route.ts
git commit -m "feat(api): GET /applications/my 응답에 selectedDates + allowedDates 포함"
```

---

### Task 2C.1: qr-token.ts payload 확장

**Files:**
- Modify: `src/lib/qr-token.ts`

- [ ] **Step 1: MealKind 포함**

```ts
import jwt from "jsonwebtoken";
import type { MealKind } from "@/lib/meal-kind";

const QR_SECRET = process.env.QR_JWT_SECRET!;
const EXPIRY_SECONDS = parseInt(
  process.env.QR_TOKEN_EXPIRY_SECONDS || "180",
  10
);

export interface QRTokenPayload {
  userId: number;
  role: "STUDENT" | "TEACHER";
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: MealKind;        // ← 추가 (옛 토큰 호환을 위해 optional)
}

export function signQRToken(payload: QRTokenPayload): string {
  return jwt.sign(payload, QR_SECRET, { expiresIn: EXPIRY_SECONDS });
}

export function verifyQRToken(token: string): QRTokenPayload {
  return jwt.verify(token, QR_SECRET) as QRTokenPayload;
}

export function getQRExpirySeconds(): number {
  return EXPIRY_SECONDS;
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/qr-token.ts
git commit -m "feat(lib): QR 토큰 payload 에 mealKind 옵션 추가"
```

---

### Task 2C.2: settings-cache 확장 + GET /api/system/settings mealWindows

**Files:**
- Modify: `src/lib/settings-cache.ts`
- Modify: `src/app/api/system/settings/route.ts`

- [ ] **Step 1: settings-cache 확장**

```ts
// src/lib/settings-cache.ts
import { prisma } from "@/lib/prisma";
import type { MealWindows } from "@/lib/meal-kind";

interface CachedSettings {
  operationMode: string;
  qrGeneration: string;
  mealWindows: MealWindows;
}

let cache: CachedSettings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000;

const DEFAULT_WINDOWS: MealWindows = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner:    { start: "15:00", end: "21:00" },
};

export async function getCachedSettings(): Promise<CachedSettings> {
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL) return cache;

  const settings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  cache = {
    operationMode: map.operationMode || "online",
    qrGeneration: map.qrGeneration || "1",
    mealWindows: {
      breakfast: {
        start: map.breakfast_window_start || DEFAULT_WINDOWS.breakfast.start,
        end:   map.breakfast_window_end   || DEFAULT_WINDOWS.breakfast.end,
      },
      dinner: {
        start: map.dinner_window_start || DEFAULT_WINDOWS.dinner.start,
        end:   map.dinner_window_end   || DEFAULT_WINDOWS.dinner.end,
      },
    },
  };
  cacheTimestamp = Date.now();
  return cache;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheTimestamp = 0;
}
```

- [ ] **Step 2: /api/system/settings GET 응답에 mealWindows 추가**

```ts
export async function GET() {
  const settings = await getCachedSettings();
  return NextResponse.json(
    {
      operationMode: settings.operationMode,
      qrGeneration: parseInt(settings.qrGeneration, 10),
      mealWindows: settings.mealWindows,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
```

- [ ] **Step 3: PUT 에 mealWindows 처리 추가**

기존 PUT 함수 안 `if (body.refreshQR)` 다음에 추가:

```ts
if (body.mealWindows) {
  const mw = body.mealWindows;
  const validate = (t: { start: string; end: string }) =>
    /^\d{2}:\d{2}$/.test(t.start) && /^\d{2}:\d{2}$/.test(t.end) && t.start < t.end;

  if (!validate(mw.breakfast) || !validate(mw.dinner)) {
    return NextResponse.json({ error: "잘못된 시간 형식입니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  // 조식·석식 윈도우 미겹침
  if (!(mw.breakfast.end <= mw.dinner.start || mw.dinner.end <= mw.breakfast.start)) {
    return NextResponse.json({ error: "조식·석식 시간이 겹칩니다.", errorCode: "INVALID_BODY" }, { status: 400 });
  }
  const upserts = [
    ["breakfast_window_start", mw.breakfast.start],
    ["breakfast_window_end",   mw.breakfast.end],
    ["dinner_window_start",    mw.dinner.start],
    ["dinner_window_end",      mw.dinner.end],
  ] as const;
  await prisma.$transaction(
    upserts.map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key }, update: { value }, create: { key, value },
      }),
    ),
  );
}
```

PUT 끝의 응답에도 `mealWindows` 포함하도록 변경:

```ts
return NextResponse.json({
  operationMode: settings.operationMode,
  qrGeneration: parseInt(settings.qrGeneration, 10),
  mealWindows: settings.mealWindows,
});
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/settings-cache.ts src/app/api/system/settings/route.ts
git commit -m "feat(api): system settings 에 mealWindows 추가 + 검증"
```

---

### Task 2C.3: /api/qr/token mealKind 결정

**Files:**
- Modify: `src/app/api/qr/token/route.ts`

- [ ] **Step 1: 시간대 분기 + 자격 검증 추가**

기존 파일 전체 교체:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { signQRToken, getQRExpirySeconds } from "@/lib/qr-token";
import { getCachedSettings } from "@/lib/settings-cache";
import { resolveMealKind, isStudentEligibleToday } from "@/lib/meal-kind";
import { todayKST, nowKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "STUDENT";
  const userId = session.user.dbUserId;
  const role = session.user.role as "STUDENT" | "TEACHER";

  const settings = await getCachedSettings();
  const isLocal = settings.operationMode === "local";

  const mealKind = resolveMealKind(nowKST(), settings.mealWindows);

  if (role === "STUDENT") {
    if (!mealKind) {
      return NextResponse.json(
        { error: "현재는 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW", mealWindows: settings.mealWindows },
        { status: 400 },
      );
    }
    const today = new Date(todayKST());
    const ok = await isStudentEligibleToday(userId, mealKind, today);
    if (!ok) {
      return NextResponse.json(
        { error: `오늘 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 신청 내역이 없습니다.`, errorCode: "NO_MEAL_PERIOD" },
        { status: 400 },
      );
    }
  }

  const validType = role === "STUDENT" ? "STUDENT" : (type as "WORK" | "PERSONAL");

  // Local mode
  if (isLocal) {
    const generation = settings.qrGeneration;
    const mk = mealKind ?? "DINNER";   // 교사는 mealKind 무관 — DINNER 로 박아도 무방
    const qrString = `posanmeal:${userId}:${generation}:${validType}:${mk}`;
    return NextResponse.json({ token: qrString, expiresIn: 0, mode: "local", mealKind: mk });
  }

  // Online mode
  const token = signQRToken({
    userId,
    role,
    type: validType,
    mealKind: mealKind ?? undefined,
  });

  return NextResponse.json({
    token,
    expiresIn: getQRExpirySeconds(),
    mode: "online",
    mealKind,
  });
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/qr/token/route.ts
git commit -m "feat(api): QR 토큰 발급 시간대 자동분기 + selectedDates 검증"
```

---

### Task 2C.4: /api/checkin mealKind 검증 + 저장

**Files:**
- Modify: `src/app/api/checkin/route.ts`

- [ ] **Step 1: 검증/저장 로직 갱신**

기존 파일 전체 교체:

```ts
import { NextResponse } from "next/server";
import { verifyQRToken } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST, nowKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { resolveMealKind, isStudentEligibleToday, type MealKind } from "@/lib/meal-kind";

export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (!token) {
      return NextResponse.json({ success: false, error: "토큰이 없습니다." }, { status: 400 });
    }

    let payload;
    try { payload = verifyQRToken(token); }
    catch {
      return NextResponse.json({ success: false, error: "QR이 만료되었습니다. 새로고침 해주세요." }, { status: 400 });
    }

    const settings = await getCachedSettings();
    const sysMealKind = resolveMealKind(nowKST(), settings.mealWindows);

    // 학생: payload.mealKind 우선, 없으면 sysMealKind
    let mealKind: MealKind | null;
    if (payload.role === "STUDENT") {
      mealKind = payload.mealKind ?? sysMealKind;
      if (!mealKind) {
        return NextResponse.json(
          { success: false, error: "현재는 식사 시간이 아닙니다.", errorCode: "NO_MEAL_WINDOW" },
          { status: 400 },
        );
      }
    } else {
      // 교사: 시간대로 결정 (없으면 DINNER 기본)
      mealKind = sysMealKind ?? "DINNER";
    }

    const today = todayKST();
    const todayDate = new Date(today);

    const [activeReg, existing, user] = await Promise.all([
      payload.role === "STUDENT"
        ? isStudentEligibleToday(payload.userId, mealKind, todayDate)
        : Promise.resolve(true),
      prisma.checkIn.findFirst({
        where: { userId: payload.userId, date: todayDate, mealKind },
      }),
      prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true, role: true, grade: true, classNum: true, number: true, photoUrl: true },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ success: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (payload.role === "STUDENT" && !activeReg) {
      return NextResponse.json(
        { success: false, error: `오늘 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 신청 내역이 없습니다.`, errorCode: "NO_MEAL_PERIOD" },
        { status: 400 },
      );
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        user,
        mealKind,
        error: `이미 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 체크인 되었습니다.`,
      });
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: payload.userId,
        date: todayDate,
        type: payload.type,
        mealKind,
        source: "QR",
      },
    });

    return NextResponse.json({
      success: true,
      user,
      type: payload.type,
      mealKind,
      checkedAt: checkIn.checkedAt,
    });
  } catch {
    return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
```

> 주의: Phase 1 단계에서는 unique 키가 여전히 `(userId, date)` 라서 같은 날 두 식사 INSERT 가 P2002 위반. **Phase 4 적용 전까지는 운영상 한 번에 한 식사만 가능**. 이는 의도된 점진적 배포의 결과이며, 학생 행동(같은 날 조식+석식)은 Phase 4 후부터 진정 동작.

- [ ] **Step 2: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/checkin/route.ts
git commit -m "feat(api): 체크인 mealKind 검증 + CheckIn 에 mealKind 저장"
```

---

### Task 2D.1: /api/sync/download eligibleEntries + mealWindows

**Files:**
- Modify: `src/app/api/sync/download/route.ts`

- [ ] **Step 1: 응답 확장**

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { getCachedSettings } from "@/lib/settings-cache";
import { canWriteAdmin } from "@/lib/permissions";

const HORIZON_DAYS = 14;

export async function GET() {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date(todayKST());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const [settings, users, dinnerRegs, breakfastDates] = await Promise.all([
    getCachedSettings(),
    prisma.user.findMany({
      select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
    }),
    prisma.mealRegistration.findMany({
      where: {
        status: "APPROVED",
        application: {
          type: "DINNER",
          mealStart: { not: null, lte: horizon },
          mealEnd:   { not: null, gte: today },
        },
      },
      select: {
        userId: true,
        application: { select: { mealStart: true, mealEnd: true } },
      },
    }),
    prisma.mealRegistrationDate.findMany({
      where: {
        date: { gte: today, lte: horizon },
        registration: { status: "APPROVED", application: { type: "BREAKFAST" } },
      },
      select: { date: true, registration: { select: { userId: true } } },
    }),
  ]);

  // DINNER 항목 펼치기 (mealStart..mealEnd ∩ [today..horizon])
  const dinnerEntries: { userId: number; date: string; mealKind: "DINNER" }[] = [];
  for (const r of dinnerRegs) {
    const start = r.application.mealStart! > today ? r.application.mealStart! : today;
    const end   = r.application.mealEnd!   < horizon ? r.application.mealEnd!   : horizon;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dinnerEntries.push({
        userId: r.userId,
        date: d.toISOString().slice(0, 10),
        mealKind: "DINNER",
      });
    }
  }

  const breakfastEntries = breakfastDates.map((b) => ({
    userId: b.registration.userId,
    date: b.date.toISOString().slice(0, 10),
    mealKind: "BREAKFAST" as const,
  }));

  const eligibleEntries = [...dinnerEntries, ...breakfastEntries];

  // 레거시: 오늘 활성 신청자 union (식사 무관)
  const todayKey = today.toISOString().slice(0, 10);
  const eligibleUserIdsSet = new Set<number>();
  for (const e of eligibleEntries) {
    if (e.date === todayKey) eligibleUserIdsSet.add(e.userId);
  }

  return NextResponse.json({
    operationMode: settings.operationMode,
    qrGeneration: parseInt(settings.qrGeneration, 10),
    users,
    eligibleUserIds: Array.from(eligibleUserIdsSet),
    eligibleEntries,
    mealWindows: settings.mealWindows,
    serverTime: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/sync/download/route.ts
git commit -m "feat(api): sync/download 에 eligibleEntries(14일치) + mealWindows 추가"
```

---

### Task 2D.2: /api/sync/upload mealKind 처리

**Files:**
- Modify: `src/app/api/sync/upload/route.ts`

- [ ] **Step 1: 페이로드 + 검증 갱신**

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canWriteAdmin } from "@/lib/permissions";
import { isStudentEligibleToday, type MealKind } from "@/lib/meal-kind";

interface UploadCheckIn {
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind?: MealKind;        // 옛 태블릿 호환: 없으면 DINNER
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { checkins } = (await request.json()) as { checkins: UploadCheckIn[] };
  if (!Array.isArray(checkins) || checkins.length === 0) {
    return NextResponse.json({ accepted: 0, duplicates: 0, rejected: [] });
  }

  let accepted = 0;
  let duplicates = 0;
  const rejected: { userId: number; date: string; reason: string }[] = [];

  for (const ci of checkins) {
    try {
      const dateObj = new Date(ci.date + "T00:00:00Z");
      const mealKind: MealKind = ci.mealKind ?? "DINNER";

      const user = await prisma.user.findUnique({
        where: { id: ci.userId },
        select: { id: true, role: true },
      });
      if (!user) {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "USER_NOT_FOUND" });
        continue;
      }

      if (user.role === "STUDENT") {
        const ok = await isStudentEligibleToday(ci.userId, mealKind, dateObj);
        if (!ok) {
          rejected.push({ userId: ci.userId, date: ci.date, reason: "NO_MEAL_PERIOD" });
          continue;
        }
      }

      await prisma.checkIn.create({
        data: {
          userId: ci.userId,
          date: dateObj,
          checkedAt: new Date(ci.checkedAt),
          type: ci.type,
          mealKind,
          source: "LOCAL_SYNC",
        },
      });
      accepted++;
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
        duplicates++;
      } else {
        rejected.push({ userId: ci.userId, date: ci.date, reason: "SERVER_ERROR" });
      }
    }
  }

  return NextResponse.json({ accepted, duplicates, rejected });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/sync/upload/route.ts
git commit -m "feat(api): sync/upload payload 에 mealKind 추가 + 학생 검증"
```

---

### Task 2E.1: 관리자 등록 GET/POST BREAKFAST 분기

**Files:**
- Modify: `src/app/api/admin/applications/[id]/registrations/route.ts`

- [ ] **Step 1: GET 응답 확장 + POST BREAKFAST 분기**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const appId = parseInt(id);

  const [application, registrations] = await Promise.all([
    prisma.mealApplication.findUnique({
      where: { id: appId },
      include: { allowedDates: { select: { date: true }, orderBy: { date: "asc" } } },
    }),
    prisma.mealRegistration.findMany({
      where: { applicationId: appId },
      include: {
        user: { select: { id: true, name: true, grade: true, classNum: true, number: true } },
        selectedDates: { select: { date: true }, orderBy: { date: "asc" } },
      },
      orderBy: [
        { user: { grade: "asc" } },
        { user: { classNum: "asc" } },
        { user: { number: "asc" } },
      ],
    }),
  ]);

  return NextResponse.json({ application, registrations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const appId = parseInt(id);
  const { userId, dates } = await request.json();

  const app = await prisma.mealApplication.findUnique({
    where: { id: appId },
    include: { allowedDates: { select: { date: true } } },
  });
  if (!app) return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });

  if (app.type === "BREAKFAST") {
    if (!Array.isArray(dates) || dates.length === 0) {
      return NextResponse.json({ error: "선택 날짜가 필요합니다.", errorCode: "INVALID_DATES" }, { status: 400 });
    }
    const allowed = new Set(app.allowedDates.map((d) => d.date.toISOString().slice(0, 10)));
    for (const d of dates) {
      if (!allowed.has(d)) {
        return NextResponse.json({ error: "허용되지 않은 날짜가 포함되었습니다.", errorCode: "INVALID_DATES" }, { status: 400 });
      }
    }
    try {
      const reg = await prisma.$transaction(async (tx) => {
        const r = await tx.mealRegistration.create({
          data: { applicationId: appId, userId, signature: "", addedBy: "ADMIN" },
        });
        await tx.mealRegistrationDate.createMany({
          data: dates.map((d: string) => ({ registrationId: r.id, date: new Date(d) })),
        });
        return r;
      });
      return NextResponse.json({ registration: reg }, { status: 201 });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        return NextResponse.json({ error: "이미 등록되어 있습니다." }, { status: 409 });
      }
      throw err;
    }
  }

  // DINNER / OTHER (기존 동작)
  try {
    const registration = await prisma.mealRegistration.create({
      data: { applicationId: appId, userId, signature: "", addedBy: "ADMIN" },
    });
    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 등록되어 있습니다." }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/admin/applications/\[id\]/registrations/route.ts
git commit -m "feat(api): 관리자 등록 GET 응답 확장 + POST BREAKFAST 분기"
```

---

### Task 2E.2: BREAKFAST 매트릭스 export/import

**Files:**
- Modify: `src/app/api/admin/applications/[id]/export/route.ts`
- Modify: `src/app/api/admin/applications/[id]/import/route.ts`

- [ ] **Step 1: export — BREAKFAST 매트릭스 분기**

`src/app/api/admin/applications/[id]/export/route.ts` 의 핵심 변경 — 기존 코드 흐름 유지하되 application.type 이 BREAKFAST 이고 isTemplate==false 인 경우 매트릭스 시트 생성. 기존 함수에서 `application` 변수 로딩 직후 BREAKFAST 분기 추가:

```ts
// application 로딩 다음에 추가
const allowedDates = application.type === "BREAKFAST"
  ? (await prisma.mealApplicationDate.findMany({
      where: { applicationId: appId },
      select: { date: true },
      orderBy: { date: "asc" },
    })).map((d) => d.date.toISOString().slice(0, 10))
  : [];

// BREAKFAST 매트릭스 분기 (template 도 여기로)
if (application.type === "BREAKFAST") {
  const allStudents = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { id: true, name: true, grade: true, classNum: true, number: true },
    orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }],
  });
  const regsWithDates = await prisma.mealRegistration.findMany({
    where: { applicationId: appId, status: "APPROVED" },
    select: { userId: true, selectedDates: { select: { date: true } } },
  });
  const studentDates = new Map<number, Set<string>>();
  for (const r of regsWithDates) {
    studentDates.set(r.userId, new Set(r.selectedDates.map((d) => d.date.toISOString().slice(0, 10))));
  }

  const sheet = workbook.addWorksheet("신청매트릭스");
  const headers = ["학년", "반", "번호", "이름", ...allowedDates, "합계"];
  sheet.mergeCells(1, 1, 1, headers.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${application.title} — 신청 매트릭스`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  const headerRow = sheet.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });

  const colWidths = [6, 6, 6, 12, ...allowedDates.map(() => 8), 8];
  colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  let rowNum = 4;
  const dateTotals: Record<string, number> = Object.fromEntries(allowedDates.map((d) => [d, 0]));
  for (const s of allStudents) {
    const r = sheet.getRow(rowNum++);
    r.getCell(1).value = s.grade;
    r.getCell(2).value = s.classNum;
    r.getCell(3).value = s.number;
    r.getCell(4).value = s.name;
    let total = 0;
    const sel = studentDates.get(s.id) ?? new Set();
    allowedDates.forEach((d, i) => {
      const cell = r.getCell(5 + i);
      if (sel.has(d)) { cell.value = "O"; cell.alignment = { horizontal: "center" }; total++; dateTotals[d]++; }
    });
    r.getCell(5 + allowedDates.length).value = total;
  }

  // 합계 행
  const totalRow = sheet.getRow(rowNum);
  totalRow.getCell(4).value = "합계";
  totalRow.getCell(4).font = { bold: true };
  allowedDates.forEach((d, i) => {
    const cell = totalRow.getCell(5 + i);
    cell.value = dateTotals[d];
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_matrix.xlsx"`,
    },
  });
}
```

기존 DINNER/OTHER 분기는 그 다음에 그대로 유지.

- [ ] **Step 2: import — BREAKFAST 매트릭스 분기**

`src/app/api/admin/applications/[id]/import/route.ts` 에서 application 로딩 다음에 분기 추가:

```ts
if (application.type === "BREAKFAST") {
  const allowed = await prisma.mealApplicationDate.findMany({
    where: { applicationId },
    select: { date: true },
  });
  const allowedSet = new Set(allowed.map((d) => d.date.toISOString().slice(0, 10)));

  // 헤더 행 3 의 5번째 컬럼부터 날짜 컬럼
  const headerRow = sheet.getRow(3);
  const dateColumns: { col: number; date: string }[] = [];
  for (let col = 5; col <= sheet.columnCount; col++) {
    const raw = headerRow.getCell(col).value;
    if (raw == null) continue;
    let dateStr: string | null = null;
    if (raw instanceof Date) {
      dateStr = raw.toISOString().slice(0, 10);
    } else {
      const s = String(raw).trim();
      // "5/5" 또는 "2026-05-05" 모두 허용 — allowedSet 매칭
      if (allowedSet.has(s)) dateStr = s;
      else {
        // M/D 형식이면 현재 연도로 추정
        const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (m) {
          const candidate = `${new Date().getFullYear()}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
          if (allowedSet.has(candidate)) dateStr = candidate;
        }
      }
    }
    if (dateStr && allowedSet.has(dateStr)) {
      dateColumns.push({ col, date: dateStr });
    }
  }

  let added = 0, updated = 0, skippedExisting = 0, skippedNotFound = 0, skippedDuplicateRow = 0;
  const seen = new Set<string>();

  const allStudents = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { id: true, grade: true, classNum: true, number: true },
  });
  const studentMap = new Map<string, number>();
  for (const s of allStudents) {
    if (s.grade != null && s.classNum != null && s.number != null) {
      studentMap.set(`${s.grade}-${s.classNum}-${s.number}`, s.id);
    }
  }

  for (let rowNum = 4; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    const grade = row.getCell(1).value;
    const classNum = row.getCell(2).value;
    const number = row.getCell(3).value;
    if (!grade || !classNum || !number) continue;
    const key = `${grade}-${classNum}-${number}`;
    if (seen.has(key)) { skippedDuplicateRow++; continue; }
    seen.add(key);
    const userId = studentMap.get(key);
    if (!userId) { skippedNotFound++; continue; }

    const dates: string[] = [];
    for (const { col, date } of dateColumns) {
      const v = String(row.getCell(col).value ?? "").trim().toUpperCase();
      if (v === "O") dates.push(date);
    }
    if (dates.length === 0) continue;

    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId } },
    });

    await prisma.$transaction(async (tx) => {
      const reg = existing
        ? await tx.mealRegistration.update({
            where: { id: existing.id },
            data: { status: "APPROVED", cancelledAt: null, cancelledBy: null, addedBy: "ADMIN" },
          })
        : await tx.mealRegistration.create({
            data: { applicationId, userId, signature: "", addedBy: "ADMIN" },
          });
      await tx.mealRegistrationDate.deleteMany({ where: { registrationId: reg.id } });
      await tx.mealRegistrationDate.createMany({
        data: dates.map((d) => ({ registrationId: reg.id, date: new Date(d) })),
      });
      if (existing) updated++;
      else added++;
    });
  }

  return NextResponse.json({ added, updated, skippedExisting, skippedNotFound, skippedDuplicateRow });
}
```

- [ ] **Step 3: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/\[id\]/export/route.ts src/app/api/admin/applications/\[id\]/import/route.ts
git commit -m "feat(api): 관리자 매트릭스 export/import (BREAKFAST)"
```

---

### Task 2E.3: /api/admin/checkins 응답에 breakfastDates + per-row mealKind

**Files:**
- Modify: `src/app/api/admin/checkins/route.ts`

- [ ] **Step 1: GET 응답 변경**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());
  const category = searchParams.get("category") || "teacher";

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const isTeacher = category === "teacher";
  const grade = isTeacher ? undefined : parseInt(category);

  const [users, breakfastDateRows] = await Promise.all([
    prisma.user.findMany({
      where: isTeacher ? { role: "TEACHER" } : { role: "STUDENT", grade },
      select: {
        id: true, name: true, number: true, grade: true, classNum: true,
        subject: true, homeroom: true,
        checkIns: {
          where: { date: { gte: startDate, lte: endDate } },
          select: { id: true, date: true, checkedAt: true, type: true, mealKind: true },
          orderBy: { date: "asc" },
        },
      },
      orderBy: isTeacher ? { name: "asc" } : [{ classNum: "asc" }, { number: "asc" }],
    }),
    prisma.mealApplicationDate.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        application: { type: "BREAKFAST" },
      },
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "asc" },
    }),
  ]);

  const breakfastDates = breakfastDateRows.map((d) => d.date.toISOString().slice(0, 10));

  return NextResponse.json({ users, year, month, category, breakfastDates });
}

// PATCH 는 기존 그대로
```

(기존 PATCH 함수는 변경 없이 유지)

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/admin/checkins/route.ts
git commit -m "feat(api): /admin/checkins 응답에 breakfastDates + mealKind 포함"
```

---

### Task 2E.4: /api/admin/dashboard 분리 카운트

**Files:**
- Modify: `src/app/api/admin/dashboard/route.ts`

- [ ] **Step 1: 응답 분리**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  const targetDate = new Date(dateParam);

  const [counts, records] = await Promise.all([
    prisma.checkIn.groupBy({
      by: ["type", "mealKind"],
      where: { date: targetDate },
      _count: { id: true },
    }),
    prisma.checkIn.findMany({
      where: { date: targetDate },
      select: {
        id: true, type: true, mealKind: true, source: true, checkedAt: true,
        user: { select: { name: true, role: true, grade: true, classNum: true, number: true } },
      },
      orderBy: { checkedAt: "asc" },
    }),
  ]);

  const studentBreakfast = counts.find((c) => c.type === "STUDENT" && c.mealKind === "BREAKFAST")?._count.id ?? 0;
  const studentDinner    = counts.find((c) => c.type === "STUDENT" && c.mealKind === "DINNER")?._count.id ?? 0;
  const teacherWork      = counts.filter((c) => c.type === "WORK").reduce((s, c) => s + c._count.id, 0);
  const teacherPersonal  = counts.filter((c) => c.type === "PERSONAL").reduce((s, c) => s + c._count.id, 0);

  return NextResponse.json({
    date: dateParam,
    breakfast: { studentCount: studentBreakfast },
    dinner:    { studentCount: studentDinner, teacherWorkCount: teacherWork, teacherPersonalCount: teacherPersonal },
    records: records.map((c) => ({
      id: c.id,
      userName: c.user.name,
      role: c.user.role,
      type: c.type,
      mealKind: c.mealKind,
      source: c.source,
      checkedAt: c.checkedAt.toISOString(),
      grade: c.user.grade,
      classNum: c.user.classNum,
      number: c.user.number,
    })),
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/admin/dashboard/route.ts
git commit -m "feat(api): 대시보드 응답 조식·석식 분리 카운트"
```

---

### Task 2E.5: /api/admin/checkins/toggle mealKind 필수

**Files:**
- Modify: `src/app/api/admin/checkins/toggle/route.ts`

- [ ] **Step 1: body 에 mealKind 받기**

기존 파일 읽고, `(userId, date, mealKind)` 단위로 동작하도록 변경. 핵심:
- POST body 에 `mealKind: "BREAKFAST" | "DINNER"` 추가.
- toggle 로직에서 `findFirst({ where: { userId, date, mealKind }})` 로 조회.
- 생성/삭제 시 mealKind 포함.

(상세 코드는 기존 toggle 라우트 구조에 맞춰 동일 패턴 — `mealKind` 를 모든 where/data 에 포함)

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/admin/checkins/toggle/route.ts
git commit -m "feat(api): /admin/checkins/toggle 에 mealKind 필수화"
```

---

### Task 2E.6: /api/admin/export 동적 매트릭스

**Files:**
- Modify: `src/app/api/admin/export/route.ts`

- [ ] **Step 1: 단일 시트 + 동적 sub-column 으로 재작성**

기존 라우트를 다음 패턴으로 교체 (요지):

```ts
// 1) 해당 월 BREAKFAST 운영일 집합
const breakfastDates = (await prisma.mealApplicationDate.findMany({
  where: { date: { gte: startDate, lte: endDate }, application: { type: "BREAKFAST" } },
  distinct: ["date"], select: { date: true }, orderBy: { date: "asc" },
})).map((d) => d.date.toISOString().slice(0, 10));

// 2) 그 월 모든 날짜 (1일~말일)
const allDates: string[] = [];
for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  allDates.push(d.toISOString().slice(0, 10));
}

// 3) 헤더: 학년/반/번호/이름/(각 날짜의 (조|석) 또는 (석))/합계조/합계석
const sheet = workbook.addWorksheet(category);
// 헤더 row 1: 날짜 (운영일은 mergeCells 2칸)
// 헤더 row 2: "조" / "석" 또는 "석"
// row 3 이후: 학생 데이터, 셀에 "O"
```

핵심 로직 (간소화):
```ts
const breakfastSet = new Set(breakfastDates);
let col = 5;
const colMap: Record<string, { dinner: number; breakfast?: number }> = {};
const dateHeaderRow = sheet.getRow(1);
const kindHeaderRow = sheet.getRow(2);
["학년","반","번호","이름"].forEach((h, i) => {
  sheet.mergeCells(1, i+1, 2, i+1);
  sheet.getCell(1, i+1).value = h;
});
for (const d of allDates) {
  if (breakfastSet.has(d)) {
    sheet.mergeCells(1, col, 1, col + 1);
    dateHeaderRow.getCell(col).value = d;
    kindHeaderRow.getCell(col).value = "조";
    kindHeaderRow.getCell(col + 1).value = "석";
    colMap[d] = { breakfast: col, dinner: col + 1 };
    col += 2;
  } else {
    sheet.mergeCells(1, col, 2, col);
    dateHeaderRow.getCell(col).value = d;
    colMap[d] = { dinner: col };
    col += 1;
  }
}
// 학생 데이터 채우기 — checkIns 의 (date, mealKind) 매핑
```

상세는 구현 시점에서 기존 export 의 패턴(헤더 정렬, 합계, 컬럼폭) 을 참고해 적용.

- [ ] **Step 2: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/admin/export/route.ts
git commit -m "feat(api): /admin/export 동적 매트릭스 (조식 운영일은 (조|석))"
```

---

## Phase 2G — 로컬 IndexedDB v3→v4

### Task 2G.1: local-db.ts v4 마이그레이션

**Files:**
- Modify: `src/lib/local-db.ts`

- [ ] **Step 1: DB_VERSION 4, 스키마 변경, 새 인터페이스/함수**

기존 파일을 다음 골격으로 변경:

```ts
const DB_NAME = "posanmeal-local";
const DB_VERSION = 4;

export interface LocalUser { /* 기존 그대로 */ }

export interface LocalCheckIn {
  id?: number;
  userId: number;
  date: string;
  checkedAt: string;
  type: "STUDENT" | "WORK" | "PERSONAL";
  mealKind: "BREAKFAST" | "DINNER";    // ← 신규 (필수)
  synced: number;
}

export interface EligibleEntry {
  userId: number;
  date: string;       // YYYY-MM-DD
  mealKind: "BREAKFAST" | "DINNER";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("users")) {
        const userStore = db.createObjectStore("users", { keyPath: "id" });
        userStore.createIndex("byRoleGrade", ["role", "grade", "classNum", "number"]);
      }

      // v3 의 eligibleUsers 제거
      if (oldVersion < 4 && db.objectStoreNames.contains("eligibleUsers")) {
        db.deleteObjectStore("eligibleUsers");
      }
      // v4 의 eligibleEntries 추가
      if (!db.objectStoreNames.contains("eligibleEntries")) {
        const store = db.createObjectStore("eligibleEntries", { keyPath: ["userId", "date", "mealKind"] });
        store.createIndex("byDateKind", ["date", "mealKind"]);
      }

      // checkins: 기존 store 삭제 후 재생성 (v4)
      if (oldVersion < 4 && db.objectStoreNames.contains("checkins")) {
        db.deleteObjectStore("checkins");
      }
      if (!db.objectStoreNames.contains("checkins")) {
        const checkinStore = db.createObjectStore("checkins", { keyPath: "id", autoIncrement: true });
        checkinStore.createIndex("byUserDateMealKind", ["userId", "date", "mealKind"], { unique: true });
        checkinStore.createIndex("bySynced", "synced");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 기존 getSetting/setSetting/getUser/replaceAllUsers 그대로 유지

// === eligibleEntries ===
export async function replaceAllEligibleEntries(entries: EligibleEntry[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleEntries", "readwrite");
    const store = tx.objectStore("eligibleEntries");
    store.clear();
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isEligibleLocal(userId: number, date: string, mealKind: "BREAKFAST"|"DINNER"): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleEntries", "readonly");
    const req = tx.objectStore("eligibleEntries").get([userId, date, mealKind]);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

// === checkins (v4) ===
export async function getCheckIn(userId: number, date: string, mealKind: "BREAKFAST"|"DINNER"): Promise<LocalCheckIn | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checkins", "readonly");
    const idx = tx.objectStore("checkins").index("byUserDateMealKind");
    const req = idx.get([userId, date, mealKind]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// addCheckIn 시그니처는 그대로 (LocalCheckIn 에 mealKind 포함되어 있으므로)
// 기존의 isEligible(userId) 함수는 제거. 호출자 모두 isEligibleLocal 로 전환.
// 기존 replaceAllEligibleUsers 도 제거.
```

- [ ] **Step 2: clearAllData 의 storeNames 갱신**

```ts
const storeNames = ["settings", "users", "eligibleEntries", "checkins"] as const;
```

- [ ] **Step 3: 빌드 확인 + 호출자 컴파일 에러 확인**

Run: `npm run build`
Expected: `/check` 페이지의 `isEligible`, `replaceAllEligibleUsers`, `getCheckIn(userId, date)` 호출처에서 컴파일 에러. 다음 task 에서 수정.

- [ ] **Step 4: 커밋 (페이지 수정 후로 미룸)**

이 task 는 4 의 빌드 에러를 다음 task 에서 해결한 후 한꺼번에 커밋.

---

### Task 2G.2: /check 페이지 — mealKind 시간대 분기 + 로컬 검증

**Files:**
- Modify: `src/app/check/page.tsx`

- [ ] **Step 1: import + 시간대 분기 로직 적용**

기존 import 에 추가:
```ts
import { resolveMealKindLocal, type MealKind, type MealWindows, DEFAULT_MEAL_WINDOWS } from "@/lib/meal-kind-local";
import { isEligibleLocal, replaceAllEligibleEntries, type EligibleEntry } from "@/lib/local-db";
```

`useState` 추가:
```ts
const [mealWindows, setMealWindows] = useState<MealWindows>(DEFAULT_MEAL_WINDOWS);
const [currentMealKind, setCurrentMealKind] = useState<MealKind | null>(null);
```

`useEffect` 안에서 1초마다 mealKind 갱신:
```ts
const tick = setInterval(() => {
  setCurrentMealKind(resolveMealKindLocal(new Date(), mealWindows));
}, 5_000);
return () => { clearInterval(tick); };
```

- [ ] **Step 2: parseLocalQR 5필드 지원**

```ts
function parseLocalQR(data: string): { userId: number; generation: string; type: string; mealKind?: MealKind } | null {
  const parts = data.split(":");
  if (parts.length < 4 || parts[0] !== "posanmeal") return null;
  const userId = parseInt(parts[1], 10);
  if (isNaN(userId)) return null;
  return {
    userId,
    generation: parts[2],
    type: parts[3],
    mealKind: parts[4] === "BREAKFAST" || parts[4] === "DINNER" ? parts[4] : undefined,
  };
}
```

- [ ] **Step 3: handleLocalScan 변경**

기존 step 5 (eligibility check) 변경:
```ts
const mealKind: MealKind | null = parsed.mealKind ?? currentMealKind;
if (!mealKind) {
  setResult({ success: false, error: "현재는 식사 시간이 아닙니다." });
  playDoubleBeep();
  return;
}
if (user.role === "STUDENT") {
  const eligible = await isEligibleLocal(parsed.userId, todayLocal(), mealKind);
  if (!eligible) {
    setResult({ success: false, error: `오늘 ${mealKind === "BREAKFAST" ? "조식" : "석식"} 신청 내역이 없습니다.` });
    playDoubleBeep();
    return;
  }
}
```

step 6 (duplicate) 변경:
```ts
const today = todayLocal();
const existing = await getCheckIn(parsed.userId, today, mealKind);
```

step 7 (save) 변경:
```ts
await addCheckIn({
  userId: parsed.userId,
  date: today,
  checkedAt,
  type: parsed.type as "STUDENT" | "WORK" | "PERSONAL",
  mealKind,
  synced: 0,
});
```

- [ ] **Step 4: performSync 의 download 처리 변경**

기존 `replaceAllEligibleUsers(data.eligibleUserIds)` 를 제거하고:
```ts
if (data.eligibleEntries) {
  await replaceAllEligibleEntries(data.eligibleEntries as EligibleEntry[]);
}
if (data.mealWindows) {
  await setSetting("mealWindows", JSON.stringify(data.mealWindows));
  setMealWindows(data.mealWindows);
}
```

`useEffect` 초기 로드에서:
```ts
const stored = await getSetting("mealWindows");
if (stored) {
  try { setMealWindows(JSON.parse(stored)); } catch {}
}
```

- [ ] **Step 5: upload payload 에 mealKind 포함**

```ts
const payload = unsynced.map((ci) => ({
  userId: ci.userId, date: ci.date, checkedAt: ci.checkedAt,
  type: ci.type, mealKind: ci.mealKind,
}));
```

- [ ] **Step 6: 상태바에 currentMealKind 표시 + 결과 영역 mealKind 텍스트**

상단 상태바 업데이트:
```tsx
<span className={currentMealKind ? "text-emerald-400" : "text-white/50"}>
  {currentMealKind === "BREAKFAST" ? "조식" : currentMealKind === "DINNER" ? "석식" : "시간외"}
</span>
```

성공 메시지 mealKind 반영:
```tsx
{result.success && (
  <p className="text-emerald-700 dark:text-emerald-300 text-fit-sm mt-1.5 font-medium">
    {result.mealKind === "BREAKFAST" ? "조식" : "석식"} 체크인 되었습니다.
  </p>
)}
```

(기존 typeLabel 등 교사 표시는 그대로)

- [ ] **Step 7: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/local-db.ts src/app/check/page.tsx
git commit -m "feat(check): IndexedDB v4 + 시간대 자동분기 + mealKind 별 검증"
```

---

## Phase 2H — 신규 컴포넌트

### Task 2H.1: MealKindBadge

**Files:**
- Create: `src/components/MealKindBadge.tsx`

- [ ] **Step 1: 작성**

```tsx
// src/components/MealKindBadge.tsx
import type { MealKind } from "@/lib/meal-kind-local";

export function MealKindBadge({ kind, size = "default" }: { kind: MealKind; size?: "default" | "sm" }) {
  const sm = size === "sm";
  const base = `whitespace-nowrap inline-flex items-center rounded-full font-medium ${sm ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs"}`;
  if (kind === "BREAKFAST") {
    return <span className={`${base} bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300`}>조식</span>;
  }
  return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`}>석식</span>;
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/MealKindBadge.tsx
git commit -m "feat(ui): MealKindBadge 컴포넌트"
```

---

### Task 2H.2: DateMultiPicker

**Files:**
- Create: `src/components/DateMultiPicker.tsx`

- [ ] **Step 1: 작성**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  initialMonth?: string;  // "YYYY-MM"
}

export function DateMultiPicker({ value, onChange, initialMonth }: Props) {
  const today = new Date();
  const [year, setYear] = useState(initialMonth ? parseInt(initialMonth.slice(0, 4)) : today.getFullYear());
  const [month, setMonth] = useState(initialMonth ? parseInt(initialMonth.slice(5, 7)) - 1 : today.getMonth());

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  function pad(n: number) { return String(n).padStart(2, "0"); }
  function dateKey(d: number) { return `${year}-${pad(month + 1)}-${pad(d)}`; }

  function toggle(d: number) {
    const k = dateKey(d);
    const next = new Set(value);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(next);
  }

  function changeMonth(delta: number) {
    let newMonth = month + delta, newYear = year;
    if (newMonth < 0) { newMonth = 11; newYear--; }
    if (newMonth > 11) { newMonth = 0; newYear++; }
    setMonth(newMonth); setYear(newYear);
  }

  const cells: ({ d: number; key: string } | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, key: dateKey(d) });

  const weekdays = ["일","월","화","수","목","금","토"];

  return (
    <div className="border rounded-xl p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="font-semibold whitespace-nowrap">{year}년 {month + 1}월</span>
        <Button variant="ghost" size="icon" onClick={() => changeMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs sm:text-sm">
        {weekdays.map((w, i) => (
          <div key={w} className={`text-center py-1 font-medium ${i===0?"text-red-500":i===6?"text-blue-500":"text-muted-foreground"}`}>{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />;
          const selected = value.has(cell.key);
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => toggle(cell.d)}
              className={`min-h-11 rounded-lg text-sm transition-colors ${selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted"}`}
            >
              {cell.d}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground mt-2 text-right">선택: {value.size}일</div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/DateMultiPicker.tsx
git commit -m "feat(ui): DateMultiPicker — 캘린더 다중 선택"
```

---

### Task 2H.3: DateCheckboxList

**Files:**
- Create: `src/components/DateCheckboxList.tsx`

- [ ] **Step 1: 작성**

```tsx
"use client";
import { Button } from "@/components/ui/button";

interface Props {
  dates: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

const WEEKDAYS = ["일","월","화","수","목","금","토"];

export function DateCheckboxList({ dates, selected, onChange }: Props) {
  function toggle(d: string) {
    const next = new Set(selected);
    if (next.has(d)) next.delete(d); else next.add(d);
    onChange(next);
  }
  function selectAll() { onChange(new Set(dates)); }
  function clearAll() { onChange(new Set()); }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground whitespace-nowrap">선택: {selected.size} / {dates.length}일</span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={selectAll} className="text-xs rounded-lg">전체선택</Button>
          <Button type="button" variant="outline" size="sm" onClick={clearAll} className="text-xs rounded-lg">전체해제</Button>
        </div>
      </div>
      <div className="space-y-1 max-h-64 overflow-auto">
        {dates.map((d) => {
          const date = new Date(d);
          const wd = WEEKDAYS[date.getDay()];
          const checked = selected.has(d);
          return (
            <label key={d} className="flex items-center gap-3 min-h-11 px-2 rounded-lg hover:bg-muted cursor-pointer">
              <input
                type="checkbox" checked={checked}
                onChange={() => toggle(d)}
                className="w-5 h-5"
              />
              <span className="text-sm whitespace-nowrap">{d.slice(5).replace("-","/")} ({wd})</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/DateCheckboxList.tsx
git commit -m "feat(ui): DateCheckboxList — 체크박스 리스트"
```

---

### Task 2H.4: BreakfastMatrixTable

**Files:**
- Create: `src/components/BreakfastMatrixTable.tsx`

- [ ] **Step 1: 작성**

```tsx
"use client";

interface Student {
  id: number;
  name: string;
  grade: number;
  classNum: number;
  number: number;
}

interface Registration {
  id: number;
  userId: number;
  status: string;
  selectedDates: { date: string }[];
}

interface Props {
  allowedDates: string[];   // YYYY-MM-DD
  students: Student[];
  registrations: Registration[];
  onCellClick?: (userId: number, date: string, currentlySelected: boolean) => void;
  showCancelled: boolean;
}

export function BreakfastMatrixTable({ allowedDates, students, registrations, onCellClick, showCancelled }: Props) {
  const regByUser = new Map(registrations.map((r) => [r.userId, r]));
  const filtered = students.filter((s) => {
    const r = regByUser.get(s.id);
    if (!r) return false;
    if (!showCancelled && r.status !== "APPROVED") return false;
    return true;
  });

  const dateTotals: Record<string, number> = Object.fromEntries(allowedDates.map((d) => [d, 0]));
  for (const r of registrations) {
    if (r.status !== "APPROVED") continue;
    for (const sd of r.selectedDates) {
      if (dateTotals[sd.date] != null) dateTotals[sd.date]++;
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs whitespace-nowrap">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-40 bg-card border px-2 py-1">학년</th>
            <th className="sticky top-0 left-0 z-40 bg-card border px-2 py-1">반</th>
            <th className="sticky top-0 left-0 z-40 bg-card border px-2 py-1">번호</th>
            <th className="sticky top-0 left-0 z-40 bg-card border px-2 py-1">이름</th>
            {allowedDates.map((d) => (
              <th key={d} className="sticky top-0 z-20 bg-card border px-1 py-1 text-center">
                {d.slice(5).replace("-", "/")}
              </th>
            ))}
            <th className="sticky top-0 z-20 bg-card border px-2 py-1">합계</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => {
            const r = regByUser.get(s.id)!;
            const selectedSet = new Set(r.selectedDates.map((sd) => sd.date));
            const isCancelled = r.status !== "APPROVED";
            return (
              <tr key={s.id} className={isCancelled ? "opacity-40" : ""}>
                <td className="sticky left-0 z-30 bg-card border px-2 py-1">{s.grade}</td>
                <td className="sticky left-0 z-30 bg-card border px-2 py-1">{s.classNum}</td>
                <td className="sticky left-0 z-30 bg-card border px-2 py-1">{s.number}</td>
                <td className="sticky left-0 z-30 bg-card border px-2 py-1">{s.name}</td>
                {allowedDates.map((d) => {
                  const sel = selectedSet.has(d);
                  return (
                    <td
                      key={d}
                      onClick={() => onCellClick?.(s.id, d, sel)}
                      className={`border w-7 text-center cursor-pointer ${sel ? "bg-primary/15 font-bold" : ""}`}
                    >
                      {sel ? "O" : ""}
                    </td>
                  );
                })}
                <td className="border px-2 py-1 text-center font-medium">{selectedSet.size}</td>
              </tr>
            );
          })}
          <tr className="bg-muted/40 font-semibold">
            <td colSpan={4} className="sticky left-0 z-30 bg-muted/40 border px-2 py-1 text-right">날짜별 합계</td>
            {allowedDates.map((d) => (
              <td key={d} className="border w-7 text-center">{dateTotals[d]}</td>
            ))}
            <td className="border" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/BreakfastMatrixTable.tsx
git commit -m "feat(ui): BreakfastMatrixTable — 학생×날짜 매트릭스"
```

---

## Phase 2I — 학생 페이지

### Task 2I.1: 신청 다이얼로그 BREAKFAST 분기

**Files:**
- Modify: `src/app/student/page.tsx`

- [ ] **Step 1: 타입 확장 + state 추가**

`MealApplicationItem` 인터페이스 확장:
```ts
interface MealApplicationItem {
  // ...기존
  allowedDates?: { date: string }[];
  registrations: Array<{
    id: number; status: string; createdAt: string;
    selectedDates?: { date: string }[];
  }>;
}
```

새 state:
```ts
const [breakfastSelected, setBreakfastSelected] = useState<Set<string>>(new Set());
```

`import { DateCheckboxList } from "@/components/DateCheckboxList";`
`import { MealKindBadge } from "@/components/MealKindBadge";`

- [ ] **Step 2: 다이얼로그 진입 시 기존 selectedDates 프리체크**

`onClick={() => { setSelectedApp(app); setSignatureData(null); ... }}` 자리:
```tsx
onClick={() => {
  setSelectedApp(app);
  setSignatureData(null);
  if (app.type === "BREAKFAST") {
    const existing = app.registrations[0]?.selectedDates ?? [];
    setBreakfastSelected(new Set(existing.map((d) => d.date.slice(0, 10))));
  } else {
    setBreakfastSelected(new Set());
  }
  setSignDialogOpen(true);
}}
```

- [ ] **Step 3: 다이얼로그 본문 분기**

`<SignaturePad ... />` 위에 분기:
```tsx
{selectedApp.type === "BREAKFAST" && (
  <div>
    <p className="text-sm font-medium mb-2">먹을 날짜 선택</p>
    <DateCheckboxList
      dates={(selectedApp.allowedDates ?? []).map((d) => d.date.slice(0, 10))}
      selected={breakfastSelected}
      onChange={setBreakfastSelected}
    />
  </div>
)}
```

타이틀도 분기:
```tsx
<DialogTitle>{selectedApp?.type === "BREAKFAST" ? "조식 신청" : "석식 신청"}</DialogTitle>
```

- [ ] **Step 4: handleRegister 변경**

```ts
const handleRegister = async () => {
  if (!selectedApp || !signatureData) return;
  if (selectedApp.type === "BREAKFAST" && breakfastSelected.size === 0) {
    toast.error("최소 1일을 선택해주세요.");
    return;
  }
  setSubmitting(true);
  try {
    const body: Record<string, unknown> = { signature: signatureData };
    if (selectedApp.type === "BREAKFAST") {
      body.selectedDates = Array.from(breakfastSelected);
    }
    const res = await fetch(`/api/applications/${selectedApp.id}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("신청이 완료되었습니다.");
      setSignDialogOpen(false);
      setSignatureData(null); setSelectedApp(null);
      setBreakfastSelected(new Set());
      mutateUser(); mutateApps();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "신청에 실패했습니다.");
    }
  } catch { toast.error("신청 중 오류가 발생했습니다."); }
  finally { setSubmitting(false); }
};
```

- [ ] **Step 5: 카드 표시 — BREAKFAST 면 "선택 N일"**

기존 `급식 기간` 표시 자리:
```tsx
{app.type === "BREAKFAST" ? (
  <p className="whitespace-nowrap">
    운영일: {(app.allowedDates ?? []).length}일
    {isRegistered && app.registrations[0]?.selectedDates && (
      <> · 선택 {app.registrations[0].selectedDates.length}일</>
    )}
  </p>
) : app.mealStart && app.mealEnd ? (
  <p className="whitespace-nowrap">
    급식 기간: {new Date(app.mealStart).toLocaleDateString("ko-KR")} ~ {new Date(app.mealEnd).toLocaleDateString("ko-KR")}
  </p>
) : (
  <p>명단 수합용</p>
)}
```

- [ ] **Step 6: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 7: 커밋**

```bash
git add src/app/student/page.tsx
git commit -m "feat(student): 신청 다이얼로그 BREAKFAST 분기"
```

---

### Task 2I.2: QR 탭 시간대 자동분기

**Files:**
- Modify: `src/app/student/page.tsx`
- Modify: `src/components/QRGenerator.tsx`

- [ ] **Step 1: useUser/useApplications 의 타입 확장은 2I.1 에서 완료. 학생 페이지에 mealKind state 추가**

```ts
import { resolveMealKindLocal, type MealKind, DEFAULT_MEAL_WINDOWS } from "@/lib/meal-kind-local";
import useSWR from "swr";

// 페이지 컴포넌트 안:
const { data: settings } = useSWR("/api/system/settings", (u) => fetch(u).then((r) => r.json()), { refreshInterval: 60_000 });
const mealWindows = settings?.mealWindows ?? DEFAULT_MEAL_WINDOWS;
const [currentMealKind, setCurrentMealKind] = useState<MealKind | null>(() => resolveMealKindLocal(new Date(), mealWindows));

useEffect(() => {
  const id = setInterval(() => setCurrentMealKind(resolveMealKindLocal(new Date(), mealWindows)), 5_000);
  return () => clearInterval(id);
}, [mealWindows]);
```

- [ ] **Step 2: QR 탭 분기**

기존 `<TabsContent value="qr">` 본문 교체:
```tsx
<TabsContent value="qr">
  <Card className="card-elevated rounded-2xl border-0">
    <CardContent className="pt-6 text-center">
      {!currentMealKind ? (
        <p className="text-muted-foreground py-8">
          현재 식사 시간이 아닙니다.<br/>
          조식 {mealWindows.breakfast.start}–{mealWindows.breakfast.end} · 석식 {mealWindows.dinner.start}–{mealWindows.dinner.end}
        </p>
      ) : (() => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const eligibleToday = (user.registrations ?? []).some((r) => {
          if (r.application.type === "BREAKFAST" && currentMealKind === "BREAKFAST") {
            return (r.selectedDates ?? []).some((d) => d.date.slice(0, 10) === todayKey);
          }
          if (r.application.type === "DINNER" && currentMealKind === "DINNER") {
            return r.application.mealStart && r.application.mealEnd
              && todayKey >= r.application.mealStart.slice(0, 10)
              && todayKey <= r.application.mealEnd.slice(0, 10);
          }
          return false;
        });
        if (!eligibleToday) {
          return <p className="text-muted-foreground py-8">오늘 {currentMealKind === "BREAKFAST" ? "조식" : "석식"} 신청 내역이 없습니다.</p>;
        }
        return (
          <>
            <QRGenerator type="STUDENT" />
            <p className="mt-4 font-semibold whitespace-nowrap">
              {currentMealKind === "BREAKFAST" ? "조식" : "석식"} QR · {user.grade}학년 {user.classNum}반 {user.number}번 {user.name}
            </p>
          </>
        );
      })()}
    </CardContent>
  </Card>
</TabsContent>
```

`useUser` 가 반환하는 `registrations` 타입은 `selectedDates` 포함하도록 확장 필요 — `src/hooks/useUser.ts` 도 수정 (간단히 SWR 의 응답 타입 풀어두면 됨).

- [ ] **Step 3: QRGenerator 는 토큰 발급에 mealKind 자동 반영 (서버에서 처리됨, 컴포넌트 변경 불필요)**

`/api/qr/token` 이 시간대 기반으로 mealKind 결정하므로 컴포넌트 측은 `type=STUDENT` 만 넘기면 됨.

- [ ] **Step 4: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 5: 커밋**

```bash
git add src/app/student/page.tsx src/hooks/useUser.ts
git commit -m "feat(student): QR 탭 시간대 자동 분기 + 식사별 자격 검증"
```

---

### Task 2I.3: MonthlyCalendar 에 mealKind 점

**Files:**
- Modify: `src/components/MonthlyCalendar.tsx`
- Modify: `src/app/api/checkins/route.ts`

- [ ] **Step 1: API 응답에 mealKind 포함 (간단 변경)**

`/api/checkins` GET 의 select 에 `mealKind: true` 추가.

- [ ] **Step 2: MonthlyCalendar 셀에 두 점 표시**

기존 셀 표시 로직에서 `breakfastDone` / `dinnerDone` 두 boolean 으로 분기, 각각 작은 점 (보라/앰버) 표시.

상세 코드는 컴포넌트 구조에 맞춰 작성. 핵심:
```tsx
{breakfastDone && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mr-0.5" />}
{dinnerDone && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/checkins/route.ts src/components/MonthlyCalendar.tsx
git commit -m "feat(ui): 학생 월별 달력에 조식·석식 분리 점 표시"
```

---

## Phase 2J — 관리자 페이지

### Task 2J.1: 공고 다이얼로그 BREAKFAST 분기

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: appForm 확장 + DateMultiPicker 추가**

```ts
const emptyAppForm = {
  title: "", description: "", type: "DINNER",
  applyStart: "", applyEnd: "",
  mealStart: "", mealEnd: "",
  allowedDates: [] as string[],
};
```

다이얼로그 본문에 분기 추가:
```tsx
{appForm.type === "BREAKFAST" ? (
  <div>
    <Label>가능 날짜 (캘린더에서 클릭)</Label>
    <DateMultiPicker
      value={new Set(appForm.allowedDates)}
      onChange={(s) => setAppForm({ ...appForm, allowedDates: Array.from(s).sort() })}
    />
  </div>
) : appForm.type === "DINNER" ? (
  <div className="grid grid-cols-2 gap-2">
    <div><Label>급식 시작</Label><Input type="date" value={appForm.mealStart} onChange={(e) => setAppForm({...appForm, mealStart: e.target.value})}/></div>
    <div><Label>급식 종료</Label><Input type="date" value={appForm.mealEnd} onChange={(e) => setAppForm({...appForm, mealEnd: e.target.value})}/></div>
  </div>
) : null}
```

- [ ] **Step 2: 저장 시 type 별 body 구성**

```ts
async function handleSaveApp() {
  const body: Record<string, unknown> = {
    type: appForm.type,
    title: appForm.title,
    description: appForm.description,
    applyStart: appForm.applyStart,
    applyEnd: appForm.applyEnd,
  };
  if (appForm.type === "DINNER") {
    body.mealStart = appForm.mealStart;
    body.mealEnd = appForm.mealEnd;
  } else if (appForm.type === "BREAKFAST") {
    if (appForm.allowedDates.length === 0) { toast.error("최소 1일 선택"); return; }
    body.allowedDates = appForm.allowedDates;
  }
  // POST or PUT 분기
  // ...
}
```

- [ ] **Step 3: 수정 시 영향 알림 confirm**

PUT 응답에 `affectedRegistrations > 0` 면 `confirm("기존 신청자 ${n}명의 일부 날짜가 제거됩니다. 계속?")` (실제로는 PUT 전에 미리 알 수 없으므로 PUT 후 toast 로 안내가 더 자연스러움)

- [ ] **Step 4: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 5: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): 공고 다이얼로그 BREAKFAST 분기 + 캘린더 다중선택"
```

---

### Task 2J.2: 신청자 매트릭스 뷰 + PATCH 부분 수정

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: import + 매트릭스 분기**

```tsx
import { BreakfastMatrixTable } from "@/components/BreakfastMatrixTable";

// regDialog 내부:
{selectedAppForReg?.type === "BREAKFAST" ? (
  <BreakfastMatrixTable
    allowedDates={(selectedAppForReg.allowedDates ?? []).map((d) => d.date.slice(0, 10))}
    students={allStudentsForRegMatrix}
    registrations={registrations.map((r) => ({
      id: r.id, userId: r.userId, status: r.status,
      selectedDates: r.selectedDates ?? [],
    }))}
    onCellClick={async (userId, date, currentlySelected) => {
      const reg = registrations.find((r) => r.userId === userId);
      if (!reg) return;
      const body = currentlySelected
        ? { removeDates: [date] }
        : { addDates: [date] };
      const res = await fetch(`/api/admin/applications/${selectedAppForReg.id}/registrations/${reg.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) fetchRegistrations(selectedAppForReg.id);
    }}
    showCancelled={showCancelled}
  />
) : (
  /* 기존 DINNER/OTHER 명단 테이블 */
)}
```

- [ ] **Step 2: allStudentsForRegMatrix fetch (한번 만 로드)**

```ts
const [allStudentsForRegMatrix, setAllStudentsForRegMatrix] = useState<Array<...>>([]);
useEffect(() => {
  if (regDialogOpen && selectedAppForReg?.type === "BREAKFAST" && allStudentsForRegMatrix.length === 0) {
    fetch("/api/admin/users?role=STUDENT")
      .then((r) => r.json())
      .then((d) => setAllStudentsForRegMatrix(d.users));
  }
}, [regDialogOpen, selectedAppForReg]);
```

(또는 `users` state 가 이미 있으면 그것 필터링)

- [ ] **Step 3: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): 신청자 매트릭스 뷰 + 셀 토글 PATCH"
```

---

### Task 2J.3: 시스템 설정 mealWindows + 대시보드 카운트 분리

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 시스템 설정 탭 mealWindows UI**

```tsx
const [windowsForm, setWindowsForm] = useState({ bfStart:"04:00", bfEnd:"10:00", dnStart:"15:00", dnEnd:"21:00" });

// fetchSystemSettings 안에서:
if (data.mealWindows) {
  setWindowsForm({
    bfStart: data.mealWindows.breakfast.start, bfEnd: data.mealWindows.breakfast.end,
    dnStart: data.mealWindows.dinner.start,    dnEnd: data.mealWindows.dinner.end,
  });
}

async function handleSaveWindows() {
  const res = await fetch("/api/system/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mealWindows: {
      breakfast: { start: windowsForm.bfStart, end: windowsForm.bfEnd },
      dinner:    { start: windowsForm.dnStart, end: windowsForm.dnEnd },
    }}),
  });
  if (res.ok) toast.success("저장됨");
  else { const e = await res.json().catch(()=>null); toast.error(e?.error || "실패"); }
}
```

UI 영역 (시스템 설정 탭 내부에 추가):
```tsx
<div className="space-y-2 pt-4 border-t">
  <h4 className="font-semibold">식사 시간 임계값</h4>
  <div className="flex items-center gap-2"><span className="w-16 whitespace-nowrap">조식</span>
    <Input type="time" value={windowsForm.bfStart} onChange={(e)=>setWindowsForm({...windowsForm, bfStart:e.target.value})}/>
    <span>~</span>
    <Input type="time" value={windowsForm.bfEnd} onChange={(e)=>setWindowsForm({...windowsForm, bfEnd:e.target.value})}/>
  </div>
  <div className="flex items-center gap-2"><span className="w-16 whitespace-nowrap">석식</span>
    <Input type="time" value={windowsForm.dnStart} onChange={(e)=>setWindowsForm({...windowsForm, dnStart:e.target.value})}/>
    <span>~</span>
    <Input type="time" value={windowsForm.dnEnd} onChange={(e)=>setWindowsForm({...windowsForm, dnEnd:e.target.value})}/>
  </div>
  <Button size="sm" onClick={handleSaveWindows}>저장</Button>
</div>
```

- [ ] **Step 2: 대시보드 분리 카운트 표시**

기존 카운트 카드 자리에 4개 카드 (조식 학생 / 석식 학생 / 교사 근무 / 교사 개인). API 응답이 이미 `breakfast.studentCount` / `dinner.studentCount` 등 분리됨.

- [ ] **Step 3: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): 시스템 설정 mealWindows UI + 대시보드 분리 카운트"
```

---

### Task 2J.4: AdminMealTable 동적 sub-column

**Files:**
- Modify: `src/components/AdminMealTable.tsx`

- [ ] **Step 1: 응답에서 breakfastDates 받아 sub-column 동적 생성**

기존 AdminMealTable 의 헤더/셀 렌더링 로직을 다음 패턴으로 변경:

```tsx
interface Props {
  // ...기존
  breakfastDates: string[];
}

// 헤더: 두 줄
// row 1: 학년/반/번호/이름 (rowSpan=2) | 5/5 (colSpan=2 if breakfast) | 5/6 | ...
// row 2: 조 | 석 | 석 | ...

const breakfastSet = new Set(breakfastDates);
// 모든 날짜는 그 월의 1~말일 (이미 있는 days 변수 활용)

// 헤더 렌더:
<thead>
  <tr>
    <th rowSpan={2}>학년</th>
    <th rowSpan={2}>반</th>
    <th rowSpan={2}>번호</th>
    <th rowSpan={2}>이름</th>
    {days.map((d) => (
      <th key={d} colSpan={breakfastSet.has(d) ? 2 : 1} className="sticky top-0 z-20 bg-card">
        {d.slice(5).replace("-","/")}
      </th>
    ))}
  </tr>
  <tr>
    {days.map((d) => breakfastSet.has(d) ? (
      <Fragment key={d}>
        <th className="sticky top-7 z-20 bg-purple-50 dark:bg-purple-900/20 text-purple-700">조</th>
        <th className="sticky top-7 z-20 bg-amber-50 dark:bg-amber-900/20 text-amber-700">석</th>
      </Fragment>
    ) : (
      <th key={d} className="sticky top-7 z-20 bg-amber-50 dark:bg-amber-900/20 text-amber-700">석</th>
    ))}
  </tr>
</thead>

// 본문 셀:
{days.map((d) => {
  const ci = checkInsByDate.get(d) ?? {};   // {BREAKFAST?: CheckIn, DINNER?: CheckIn}
  if (breakfastSet.has(d)) {
    return (
      <Fragment key={d}>
        <td>{ci.BREAKFAST ? "O" : ""}</td>
        <td>{ci.DINNER ? "O" : ""}</td>
      </Fragment>
    );
  }
  return <td key={d}>{ci.DINNER ? "O" : ""}</td>;
})}
```

학생 합계 셀: `조 N · 석 M` 표시.

- [ ] **Step 2: 빌드 확인** — `npm run build`. 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/components/AdminMealTable.tsx
git commit -m "feat(admin): AdminMealTable 동적 sub-column (조|석)"
```

---

## Phase 3 — 백필 마이그레이션 (운영자가 1회 실행)

### Task 3.1: 백필 마이그레이션 작성

**Files:**
- Create: `prisma/migrations/<timestamp>_backfill_meal_kind_and_breakfast_dates/migration.sql`

- [ ] **Step 1: 마이그레이션 폴더 생성**

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_backfill_meal_kind_and_breakfast_dates
```

(또는 `npx prisma migrate dev --name backfill_meal_kind_and_breakfast_dates --create-only` 후 SQL 만 작성)

- [ ] **Step 2: SQL 작성**

```sql
-- 1) 기존 CheckIn 전부 DINNER 로 백필
UPDATE "CheckIn" SET "mealKind"='DINNER' WHERE "mealKind" IS NULL;

-- 2) 기존 BREAKFAST 공고 → mealStart..mealEnd 의 모든 날짜 (평일/주말 제한 없음)
INSERT INTO "MealApplicationDate"("applicationId","date")
SELECT a.id, d::date
FROM "MealApplication" a,
     generate_series(a."mealStart", a."mealEnd", interval '1 day') d
WHERE a.type='BREAKFAST' AND a."mealStart" IS NOT NULL AND a."mealEnd" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3) 기존 BREAKFAST 신청 → 위 모든 날짜로 selectedDates 채움
INSERT INTO "MealRegistrationDate"("registrationId","date")
SELECT r.id, mad.date
FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
JOIN "MealApplicationDate" mad ON mad."applicationId" = a.id
WHERE a.type='BREAKFAST' AND r.status='APPROVED'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: prisma-migration-guardian 으로 검수**

별도 에이전트 호출.

- [ ] **Step 4: 커밋**

```bash
git add prisma/migrations/
git commit -m "feat(db): Phase 3 백필 마이그레이션"
```

---

### Task 3.2: 백필 검증 SQL 문서화

**Files:**
- Create: `docs/superpowers/plans/2026-05-02-breakfast-verification-queries.sql`

- [ ] **Step 1: 검증 쿼리 작성**

```sql
-- 1) BREAKFAST 공고 중 allowedDates 비어있는 것
SELECT a.id, a.title FROM "MealApplication" a
LEFT JOIN "MealApplicationDate" mad ON mad."applicationId" = a.id
WHERE a.type='BREAKFAST'
GROUP BY a.id, a.title HAVING COUNT(mad."date")=0;

-- 2) BREAKFAST 등록 중 selectedDates 비어있는 것 (APPROVED 만)
SELECT r.id FROM "MealRegistration" r
JOIN "MealApplication" a ON a.id = r."applicationId"
LEFT JOIN "MealRegistrationDate" mrd ON mrd."registrationId" = r.id
WHERE a.type='BREAKFAST' AND r.status='APPROVED'
GROUP BY r.id HAVING COUNT(mrd."date")=0;

-- 3) selectedDates 가 allowedDates 에 없음 (제약 위반)
SELECT mrd."registrationId", mrd."date" FROM "MealRegistrationDate" mrd
JOIN "MealRegistration" r ON r.id = mrd."registrationId"
LEFT JOIN "MealApplicationDate" mad ON mad."applicationId" = r."applicationId" AND mad."date" = mrd."date"
WHERE mad."date" IS NULL;

-- 4) CheckIn.mealKind NULL (Phase 4 전이라야 검출)
SELECT COUNT(*) FROM "CheckIn" WHERE "mealKind" IS NULL;
```

- [ ] **Step 2: 커밋**

```bash
git add docs/superpowers/plans/2026-05-02-breakfast-verification-queries.sql
git commit -m "docs: 백필 검증 SQL"
```

---

## Phase 4 — DB-B (destructive)

### Task 4.1: NOT NULL + unique 키 변경

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_enforce_meal_kind_unique/migration.sql`

⚠️ **선결조건**: Phase 1, 2, 3 가 prod·test 양쪽 모두 24시간 이상 안정 운영 후에만 진행.

- [ ] **Step 1: schema.prisma 변경**

```prisma
model CheckIn {
  // ...
  mealKind  MealKind                       // optional 제거
  // ...
  @@unique([userId, date, mealKind])       // 변경
  // 기존 @@unique([userId, date]) 제거
  // ...
}
```

- [ ] **Step 2: 마이그레이션 생성**

```bash
npx prisma migrate dev --name enforce_meal_kind_unique --create-only
```

생성된 SQL 확인 — `ALTER TABLE "CheckIn" ALTER COLUMN "mealKind" SET NOT NULL` + 제약 교체가 들어 있어야 함. Prisma 가 자동 만든 제약 이름과 다를 수 있어 다음 쿼리로 확인:

```sql
SELECT conname FROM pg_constraint WHERE conrelid = '"CheckIn"'::regclass AND contype='u';
```

확인된 제약 이름으로 SQL 수정:

```sql
ALTER TABLE "CheckIn" ALTER COLUMN "mealKind" SET NOT NULL;
ALTER TABLE "CheckIn" DROP CONSTRAINT "<old-unique-constraint-name>";
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_date_mealKind_key" UNIQUE ("userId","date","mealKind");
```

- [ ] **Step 3: prisma-migration-guardian 으로 검수**

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): Phase 4 — mealKind NOT NULL + unique 키 변경"
```

---

## Phase 5 — 배포 + 모니터링

### Task 5.1: 배포 체크리스트

**Files:**
- (운영 가이드, 코드 변경 없음)

- [ ] **Step 1: Phase 1 배포**

```bash
# test 브랜치
git checkout feat/posanmeal-mvp
git push origin feat/posanmeal-mvp
# Railway 자동 배포. prisma migrate deploy 로 Phase 1 마이그레이션 적용.
# https://posanmeal.up.railway.app 에서 헬스체크.
# main 머지
git checkout main && git merge --ff-only feat/posanmeal-mvp && git push origin main
```

- [ ] **Step 2: Phase 2 코드 배포 동시 진행** — Phase 1 과 같은 푸시에 포함됨 (단일 마이그레이션 + 새 코드).

- [ ] **Step 3: Phase 3 백필 적용**

`prisma migrate deploy` 가 Railway 컨테이너 시작 시 자동 적용 (마이그레이션 파일이 일반 마이그레이션과 같이 다음 푸시에 포함).

또는 안전을 위해 사용자가 별도 푸시:
```bash
git checkout feat/posanmeal-mvp
git cherry-pick <Phase 3 commit>
git push
# 동일하게 main 까지
```

- [ ] **Step 4: 백필 검증**

Railway DB 콘솔에서 `2026-05-02-breakfast-verification-queries.sql` 의 쿼리 4개 실행. 모두 0 결과여야 정상.

- [ ] **Step 5: Phase 4 배포 (24시간 후)**

Phase 1~3 배포 후 24시간 모니터링 통과 시:
```bash
# 새 마이그레이션 포함된 푸시 (test → main)
```

- [ ] **Step 6: PWA 갱신 안내**

학교 운영자에게 1회 안내:
- 식당 입구 태블릿 페이지(`/check`) 한 번 새로고침.
- 관리자 페이지 → 시스템 설정에서 식사 시간 임계값 확인 (필요 시 조정).
- 기존 조식 공고 1건 → 매트릭스 화면 정상 표시 확인.

---

### Task 5.2: 24시간 모니터링

- [ ] **Step 1: Railway 로그 확인**

신규 에러 코드(`MEAL_KIND_MISMATCH`, `INVALID_DATES`, `OVERLAPPING_DATES`, `NO_MEAL_WINDOW`) 빈도 확인. 비정상 급증 없어야 함.

- [ ] **Step 2: SQL 분포 확인 (당일 1회)**

```sql
SELECT mealKind, COUNT(*) FROM "CheckIn"
WHERE date = CURRENT_DATE GROUP BY mealKind;
```

조식·석식 분포가 운영 패턴과 일치해야 함.

- [ ] **Step 3: 사용자 피드백 수집**

학생/관리자에게 새 화면 동작 확인. 문제 발견 시 fix-forward (롤백은 Phase 4 까지 진행되면 거의 불가능).

---

## 자체 검증 (Self-Review)

스펙 §11 의 모든 영역이 task 로 매핑됨:

| 스펙 영역 | 태스크 |
|---|---|
| Prisma 스키마 | Task 1.1 |
| 마이그레이션 3개 | Task 1.1, 3.1, 4.1 |
| 서버 헬퍼 | Task 0.2, 0.4 |
| 13개 서버 라우트 | Task 2A.* ~ 2E.*, 2C.*, 2D.*, 2F (settings 는 2C.2) |
| 학생 페이지 | Task 2I.1, 2I.2, 2I.3 |
| 관리자 페이지 | Task 2J.1, 2J.2, 2J.3, 2J.4 |
| 태블릿 페이지 | Task 2G.2 |
| 로컬 DB | Task 2G.1 |
| 클라이언트 헬퍼 | Task 0.3 |
| 신규 컴포넌트 4개 | Task 2H.1, 2H.2, 2H.3, 2H.4 |
| 변경 컴포넌트 3개 | Task 2I.2 (QRGenerator), 2I.3 (MonthlyCalendar), 2J.4 (AdminMealTable) |
| Vitest 셋업 + 테스트 | Task 0.1, 0.2, 0.3, 0.4 |

**타입 일관성**: `MealKind`, `MealWindows`, `EligibleEntry` 명칭 통일. `resolveMealKind` (서버) / `resolveMealKindLocal` (클라이언트) 분리. `selectedDates` / `allowedDates` 일관 사용.

**스펙 missing 없음**.
