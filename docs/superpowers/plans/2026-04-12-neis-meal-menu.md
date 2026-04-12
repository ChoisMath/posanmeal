# NEIS 급식 식단 표시 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEIS 급식 API로 포산고등학교 일일 식단(조식/중식/석식)을 서버 캐싱과 함께 표시하고, 학생·교사 페이지 탭 구조를 재편(식단 탭을 첫 번째로, 교사 QR 탭 통합).

**Architecture:** 서버에 NEIS API 호출 + 인메모리 캐시 서비스(`src/lib/neis-meal.ts`)를 두고, `/api/meals` API Route가 이를 호출. 클라이언트는 공유 `MealMenu` 컴포넌트가 날짜별 데이터를 fetch하여 석식→중식→조식 순으로 렌더링. 터치 스와이프 + 버튼으로 날짜 네비게이션.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS v4, shadcn/ui

---

## 파일 구조

| 파일 | 작업 | 역할 |
|------|------|------|
| `src/lib/neis-meal.ts` | 신규 | NEIS API 호출, 응답 파싱, 인메모리 캐시 |
| `src/app/api/meals/route.ts` | 신규 | GET 엔드포인트 — date 파라미터 검증 후 neis-meal 서비스 호출 |
| `src/components/MealMenu.tsx` | 신규 | 식단 표시 클라이언트 컴포넌트 — 날짜 네비게이션(스와이프+버튼), 식사 카드 3개, 알레르기 배지, 영양 토글 |
| `src/middleware.ts` | 수정 | `/api/meals` 공개 경로 추가 |
| `src/app/student/page.tsx` | 수정 | 식단 탭 추가 (첫 번째), 기본 탭을 식단으로 변경 |
| `src/app/teacher/page.tsx` | 수정 | 식단 탭 추가 (첫 번째), 개인석식/근무를 "QR" 탭으로 통합, 기본 탭을 식단으로 변경 |

---

### Task 1: NEIS 급식 서비스 — `src/lib/neis-meal.ts`

**Files:**
- Create: `src/lib/neis-meal.ts`

- [ ] **Step 1: 파일 생성 — 타입 정의 + 상수 + 알레르기 매핑**

```typescript
// src/lib/neis-meal.ts

const NEIS_API_URL = "https://open.neis.go.kr/hub/mealServiceDietInfo";
const OFFICE_CODE = "D10";
const SCHOOL_CODE = "7240189";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

export interface Dish {
  name: string;
  allergies: string[]; // 알레르기 코드 (예: ["5", "6"])
}

export interface Meal {
  type: string;       // "1"=조식, "2"=중식, "3"=석식
  typeName: string;   // "조식", "중식", "석식"
  dishes: Dish[];
  calories: string;
  nutrition: string[];
}

export interface MealResponse {
  success: boolean;
  date: string;
  meals: Meal[];
  message?: string;
  error?: string;
}

const ALLERGY_MAP: Record<string, string> = {
  "1": "난류", "2": "우유", "3": "메밀", "4": "땅콩", "5": "대두",
  "6": "밀", "7": "고등어", "8": "게", "9": "새우", "10": "돼지고기",
  "11": "복숭아", "12": "토마토", "13": "아황산류", "14": "호두",
  "15": "닭고기", "16": "쇠고기", "17": "오징어",
  "18": "조개류(굴,전복,홍합 포함)", "19": "잣",
};

export { ALLERGY_MAP };
```

- [ ] **Step 2: 파싱 함수 구현**

아래 코드를 같은 파일 하단에 추가:

```typescript
function parseDishes(dishString: string): Dish[] {
  if (!dishString) return [];
  return dishString.split("<br/>").map((raw) => {
    const trimmed = raw.trim();
    const match = trimmed.match(/(.+?)\s*\(?([\d.]+)\)?$/);
    if (match) {
      return {
        name: match[1].trim(),
        allergies: match[2].split(".").filter(Boolean),
      };
    }
    return { name: trimmed, allergies: [] };
  });
}

function parseNutrition(nutritionString: string): string[] {
  if (!nutritionString) return [];
  return nutritionString.split("<br/>").map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 3: 캐시 + fetchMeals 메인 함수 구현**

아래 코드를 같은 파일 하단에 추가:

```typescript
const cache = new Map<string, { data: MealResponse; fetchedAt: number }>();

export async function fetchMeals(date: string): Promise<MealResponse> {
  // date 형식 검증 (YYYYMMDD)
  if (!/^\d{8}$/.test(date)) {
    return { success: false, date, meals: [], error: "잘못된 날짜 형식입니다" };
  }

  // 캐시 확인
  const cached = cache.get(date);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const apiKey = process.env.NEIS_API_KEY;
  if (!apiKey) {
    console.warn("[neis-meal] NEIS_API_KEY is not set");
    return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
  }

  try {
    const params = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: "1",
      pSize: "10",
      ATPT_OFCDC_SC_CODE: OFFICE_CODE,
      SD_SCHUL_CODE: SCHOOL_CODE,
      MLSV_YMD: date,
    });

    const res = await fetch(`${NEIS_API_URL}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
    }

    const data = await res.json();

    // NEIS API 에러 (예: INFO-200 = 데이터 없음)
    if (data.RESULT) {
      if (data.RESULT.CODE === "INFO-200") {
        const result: MealResponse = { success: true, date, meals: [], message: "급식 정보가 없습니다" };
        cache.set(date, { data: result, fetchedAt: Date.now() });
        return result;
      }
      return { success: false, date, meals: [], error: data.RESULT.MESSAGE || "API 오류" };
    }

    const rows = data?.mealServiceDietInfo?.[1]?.row;
    if (!rows || rows.length === 0) {
      const result: MealResponse = { success: true, date, meals: [], message: "급식 정보가 없습니다" };
      cache.set(date, { data: result, fetchedAt: Date.now() });
      return result;
    }

    const meals: Meal[] = rows.map((row: Record<string, string>) => ({
      type: row.MMEAL_SC_CODE,
      typeName: row.MMEAL_SC_NM || (row.MMEAL_SC_CODE === "1" ? "조식" : row.MMEAL_SC_CODE === "2" ? "중식" : "석식"),
      dishes: parseDishes(row.DDISH_NM),
      calories: row.CAL_INFO || "",
      nutrition: parseNutrition(row.NTR_INFO),
    }));

    const result: MealResponse = { success: true, date, meals };
    cache.set(date, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (err) {
    console.error("[neis-meal] fetch error:", err);
    return { success: false, date, meals: [], error: "급식 정보를 불러올 수 없습니다" };
  }
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음 (또는 기존 무관한 경고만)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/neis-meal.ts
git commit -m "feat: add NEIS meal service with in-memory caching"
```

---

### Task 2: API Route — `GET /api/meals`

**Files:**
- Create: `src/app/api/meals/route.ts`
- Modify: `src/middleware.ts:10` — publicPrefixes에 `/api/meals` 추가

- [ ] **Step 1: API Route 생성**

```typescript
// src/app/api/meals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchMeals } from "@/lib/neis-meal";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let date = searchParams.get("date");

  if (!date) {
    // 오늘 날짜 (KST)
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    date = kst.toISOString().slice(0, 10).replace(/-/g, "");
  }

  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json(
      { success: false, error: "잘못된 날짜 형식입니다. YYYYMMDD 형식이어야 합니다." },
      { status: 400 }
    );
  }

  const result = await fetchMeals(date);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
```

- [ ] **Step 2: middleware에 공개 경로 추가**

`src/middleware.ts` 10번째 줄의 `publicPrefixes` 배열에 `"/api/meals"` 추가:

변경 전:
```typescript
  const publicPrefixes = ["/api/auth", "/api/checkin", "/api/uploads", "/api/system/settings", "/api/sync", "/_next", "/uploads"];
```

변경 후:
```typescript
  const publicPrefixes = ["/api/auth", "/api/checkin", "/api/uploads", "/api/system/settings", "/api/sync", "/api/meals", "/_next", "/uploads"];
```

- [ ] **Step 3: 빌드 확인**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/meals/route.ts src/middleware.ts
git commit -m "feat: add GET /api/meals endpoint with public access"
```

---

### Task 3: MealMenu 컴포넌트 — `src/components/MealMenu.tsx`

**Files:**
- Create: `src/components/MealMenu.tsx`

- [ ] **Step 1: 컴포넌트 생성 — 날짜 상태 + fetch 로직**

```typescript
// src/components/MealMenu.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Sun, UtensilsCrossed, Moon, ChevronDown } from "lucide-react";
import type { Meal, MealResponse } from "@/lib/neis-meal";
import { ALLERGY_MAP } from "@/lib/neis-meal";

function toKSTDate(d: Date = new Date()): Date {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return new Date(kst.toISOString().slice(0, 10) + "T00:00:00");
}

function formatDateKR(date: Date): string {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = days[date.getDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}

function toYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const MEAL_CONFIG: Record<string, { icon: typeof Sun; label: string; gradient: string; darkBg: string }> = {
  "3": {
    icon: Moon,
    label: "석식",
    gradient: "from-indigo-500 to-indigo-600",
    darkBg: "dark:from-indigo-900 dark:to-indigo-800",
  },
  "2": {
    icon: UtensilsCrossed,
    label: "중식",
    gradient: "from-green-500 to-green-600",
    darkBg: "dark:from-green-900 dark:to-green-800",
  },
  "1": {
    icon: Sun,
    label: "조식",
    gradient: "from-amber-500 to-amber-600",
    darkBg: "dark:from-amber-900 dark:to-amber-800",
  },
};

// 표시 순서: 석식(3) → 중식(2) → 조식(1)
const MEAL_ORDER = ["3", "2", "1"];

export function MealMenu() {
  const [date, setDate] = useState<Date>(() => toKSTDate());
  const [data, setData] = useState<MealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (d: Date) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meals?date=${toYYYYMMDD(d)}`);
      const json: MealResponse = await res.json();
      setData(json);
    } catch {
      setData({ success: false, date: toYYYYMMDD(d), meals: [], error: "급식 정보를 불러올 수 없습니다" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(date);
  }, [date, fetchData]);

  function goNext() { setDate((d) => addDays(d, 1)); }
  function goPrev() { setDate((d) => addDays(d, -1)); }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  }

  function handleTouchMove(e: React.TouchEvent) {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  }

  function handleTouchEnd() {
    if (touchDeltaX.current > 50) goPrev();
    else if (touchDeltaX.current < -50) goNext();
    touchDeltaX.current = 0;
  }

  // 정렬된 식사 배열 (석식 → 중식 → 조식)
  const sortedMeals = data?.meals
    ? MEAL_ORDER
        .map((code) => data.meals.find((m) => m.type === code))
        .filter((m): m is Meal => !!m)
    : [];

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-4"
    >
      {/* 날짜 헤더 */}
      <div className="flex items-center justify-between px-2">
        <button
          onClick={goPrev}
          className="p-2 rounded-full hover:bg-muted transition-colors"
          aria-label="이전 날짜"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold">{formatDateKR(date)}</h2>
        <button
          onClick={goNext}
          className="p-2 rounded-full hover:bg-muted transition-colors"
          aria-label="다음 날짜"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-muted/50 h-40 animate-pulse" />
          ))}
        </div>
      )}

      {/* 에러 */}
      {!loading && data && !data.success && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{data.error || "급식 정보를 불러올 수 없습니다"}</p>
          <p className="text-sm mt-1">잠시 후 다시 시도해주세요</p>
        </div>
      )}

      {/* 데이터 없음 */}
      {!loading && data?.success && sortedMeals.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{data.message || "급식 정보가 없습니다"}</p>
        </div>
      )}

      {/* 식사 카드들 */}
      {!loading && data?.success && sortedMeals.map((meal) => (
        <MealCard key={meal.type} meal={meal} />
      ))}
    </div>
  );
}

function MealCard({ meal }: { meal: Meal }) {
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const config = MEAL_CONFIG[meal.type] || MEAL_CONFIG["3"];
  const Icon = config.icon;

  return (
    <div className="rounded-2xl overflow-hidden border border-border/30 bg-card shadow-sm">
      {/* 헤더 */}
      <div className={`bg-gradient-to-r ${config.gradient} ${config.darkBg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white">
          <Icon className="h-4 w-4" />
          <span className="font-semibold text-sm">{config.label}</span>
        </div>
        {meal.calories && (
          <span className="text-white/80 text-xs">{meal.calories}</span>
        )}
      </div>

      {/* 메뉴 목록 */}
      <div className="px-4 py-3 space-y-1.5">
        {meal.dishes.length === 0 ? (
          <p className="text-sm text-muted-foreground">메뉴 정보가 없습니다</p>
        ) : (
          meal.dishes.map((dish, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="flex-1">{dish.name}</span>
              {dish.allergies.length > 0 && (
                <div className="flex flex-wrap gap-1 shrink-0">
                  {dish.allergies.map((code) => (
                    <span
                      key={code}
                      className="inline-block px-1.5 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground leading-none"
                      title={ALLERGY_MAP[code] || code}
                    >
                      {ALLERGY_MAP[code] || code}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 영양 정보 토글 */}
      {meal.nutrition.length > 0 && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setNutritionOpen((v) => !v)}
            className="w-full px-4 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
          >
            <span>영양 정보</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${nutritionOpen ? "rotate-180" : ""}`} />
          </button>
          {nutritionOpen && (
            <div className="px-4 pb-3 text-xs text-muted-foreground space-y-0.5">
              {meal.nutrition.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/MealMenu.tsx
git commit -m "feat: add MealMenu component with swipe navigation and allergy badges"
```

---

### Task 4: 학생 페이지 탭 구조 변경

**Files:**
- Modify: `src/app/student/page.tsx`

- [ ] **Step 1: import 추가 + 탭 구조 변경**

`src/app/student/page.tsx`에서:

1) import 추가 — 기존 import들 뒤에:

변경 전:
```typescript
import { LogOut } from "lucide-react";
```

변경 후:
```typescript
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";
```

2) Tabs defaultValue를 `"qr"`에서 `"meal"`로 변경, grid-cols를 3에서 4로, 식단 탭 추가:

변경 전:
```tsx
        <Tabs defaultValue="qr">
          <TabsList className="grid w-full grid-cols-3 rounded-xl h-11">
            <TabsTrigger value="qr" className="rounded-lg">QR</TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg">개인정보</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg">확인</TabsTrigger>
          </TabsList>
```

변경 후:
```tsx
        <Tabs defaultValue="meal">
          <TabsList className="grid w-full grid-cols-4 rounded-xl h-11">
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm">식단</TabsTrigger>
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm">QR</TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
          </TabsList>
```

3) qr TabsContent 바로 위에 식단 TabsContent 추가:

기존 `<TabsContent value="qr">` 바로 위에:
```tsx
          <TabsContent value="meal">
            <Card className="card-elevated rounded-2xl border-0">
              <CardContent className="pt-6">
                <MealMenu />
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 2: 빌드 확인**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/student/page.tsx
git commit -m "feat(student): add meal tab as default, reorder tabs"
```

---

### Task 5: 교사 페이지 탭 구조 변경 + QR 통합

**Files:**
- Modify: `src/app/teacher/page.tsx`

- [ ] **Step 1: import 추가**

변경 전:
```typescript
import { LogOut } from "lucide-react";
```

변경 후:
```typescript
import { LogOut } from "lucide-react";
import { MealMenu } from "@/components/MealMenu";
```

- [ ] **Step 2: QR 타입 상태 추가**

교사 컴포넌트 함수 내부, 기존 state 선언들 뒤에 추가:

변경 전:
```typescript
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", homeroom: "", position: "" });
```

변경 후:
```typescript
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", homeroom: "", position: "" });
  const [qrType, setQrType] = useState<"PERSONAL" | "WORK">("PERSONAL");
```

- [ ] **Step 3: TabsList 변경 — 식단 탭 추가, 개인석식/근무를 QR 탭으로 통합**

변경 전:
```tsx
        <Tabs defaultValue="personal">
          <TabsList className={`grid w-full max-w-md mx-auto rounded-xl h-11 ${isHomeroom ? "grid-cols-5" : "grid-cols-4"}`}>
            <TabsTrigger value="personal" className="rounded-lg text-xs sm:text-sm">개인석식</TabsTrigger>
            <TabsTrigger value="work" className="rounded-lg text-xs sm:text-sm">근무</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm">학생관리</TabsTrigger>}
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
          </TabsList>
```

변경 후:
```tsx
        <Tabs defaultValue="meal">
          <TabsList className={`grid w-full max-w-md mx-auto rounded-xl h-11 ${isHomeroom ? "grid-cols-5" : "grid-cols-4"}`}>
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm">식단</TabsTrigger>
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm">QR</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm">학생관리</TabsTrigger>}
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
          </TabsList>
```

- [ ] **Step 4: TabsContent 변경 — personal/work 제거, meal/qr 추가**

기존 personal + work TabsContent 2개:
```tsx
          <TabsContent value="personal">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="PERSONAL" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">개인 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="work">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                <QRGenerator type="WORK" />
                <p className="mt-4 font-semibold">{user.name} 선생님</p>
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">근무 석식용 QR</p>
              </CardContent>
            </Card>
          </TabsContent>
```

이것을 아래로 교체:
```tsx
          <TabsContent value="meal">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6">
                <MealMenu />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="qr">
            <Card className="max-w-md mx-auto card-elevated rounded-2xl border-0">
              <CardContent className="pt-6 text-center">
                {/* 세그먼트 컨트롤: 개인석식 / 근무 */}
                <div className="flex rounded-xl bg-muted p-1 mb-4 max-w-xs mx-auto">
                  <button
                    onClick={() => setQrType("PERSONAL")}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      qrType === "PERSONAL"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    개인석식
                  </button>
                  <button
                    onClick={() => setQrType("WORK")}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      qrType === "WORK"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    근무
                  </button>
                </div>
                {qrType === "PERSONAL" ? (
                  <>
                    <QRGenerator type="PERSONAL" />
                    <p className="mt-4 font-semibold">{user.name} 선생님</p>
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-1">개인 석식용 QR</p>
                  </>
                ) : (
                  <>
                    <QRGenerator type="WORK" />
                    <p className="mt-4 font-semibold">{user.name} 선생님</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">근무 석식용 QR</p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 5: 빌드 확인**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/teacher/page.tsx
git commit -m "feat(teacher): add meal tab, merge personal/work QR into single tab with toggle"
```

---

### Task 6: 개발 서버에서 수동 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 개발 서버 시작**

Run: `npm run dev`

- [ ] **Step 2: 학생 페이지 검증**

브라우저에서 `/student` 접속 후 확인:
1. 식단 탭이 첫 번째이고 기본 선택됨
2. 오늘 날짜의 급식 메뉴가 석식→중식→조식 순서로 표시됨
3. 알레르기 배지가 각 메뉴 옆에 표시됨
4. 영양 정보 토글이 동작함
5. `<` `>` 버튼으로 날짜 이동 가능
6. QR 탭 클릭 시 QR 코드가 정상 생성됨
7. 다른 탭들도 기존과 동일하게 동작함

- [ ] **Step 3: 교사 페이지 검증**

브라우저에서 `/teacher` 접속 후 확인:
1. 식단 탭이 첫 번째이고 기본 선택됨
2. QR 탭에 세그먼트 컨트롤(개인석식/근무)이 표시됨
3. 토글 전환 시 QR 코드가 해당 타입으로 변경됨
4. 나머지 탭(확인, 학생관리, 개인정보)이 정상 동작함

- [ ] **Step 4: 모바일 뷰 검증**

브라우저 DevTools에서 모바일 뷰포트(375px)로 확인:
1. 탭 4~5개가 가로 스크롤 없이 표시됨
2. 터치 스와이프 시뮬레이션으로 날짜 이동 확인
3. 알레르기 배지 레이아웃이 깨지지 않음

- [ ] **Step 5: 주말/빈 데이터 검증**

날짜를 주말로 이동하여 "급식 정보가 없습니다" 메시지 확인

---

### Task 7: 프로덕션 빌드 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공, 에러 없음

- [ ] **Step 2: 최종 커밋 (필요 시)**

빌드 중 발견된 문제가 있으면 수정 후 커밋.
