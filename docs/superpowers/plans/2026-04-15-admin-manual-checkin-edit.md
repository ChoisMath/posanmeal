# 관리자 수기 체크인 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자(`/admin` 석식확인 탭)가 셀 클릭으로 체크인을 직접 추가·삭제·전환할 수 있도록 한다.

**Architecture:** 신규 `POST /api/admin/checkins/toggle` 엔드포인트가 서버 측에서 현재 상태를 읽어 cycle/toggle 전이를 수행한다. 클라이언트(`AdminMealTable`)는 모든 셀에 onClick을 연결하고 SWR mutate로 UI를 갱신한다. 권한은 기존 `canWriteAdmin`(서브관리자 제외)으로 게이트.

**Tech Stack:** Next.js 16 App Router · Prisma 7 · Auth.js v5 · SWR · Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-15-admin-manual-checkin-edit-design.md`

**Note:** 이 프로젝트는 자동화 테스트가 없고 배포 환경 수동 검증을 사용한다 (CLAUDE.md 참조). 각 태스크는 **수동 검증 단계**로 대체한다.

---

## File Structure

- **Create**: `src/app/api/admin/checkins/toggle/route.ts` — POST 엔드포인트, cycle/toggle 전이 로직
- **Modify**: `src/components/AdminMealTable.tsx` — 셀 onClick 통합, 기존 `handleToggleType` 제거 및 `handleCellClick`으로 대체

다른 파일 변경 없음 (권한 헬퍼·세션·타임존 유틸 재사용).

---

## Task 1: 신규 toggle API 엔드포인트 구현

**Files:**
- Create: `src/app/api/admin/checkins/toggle/route.ts`

- [ ] **Step 1: 엔드포인트 파일 생성**

`src/app/api/admin/checkins/toggle/route.ts` 전체 내용:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

// POST /api/admin/checkins/toggle
// body: { userId: number, date: "YYYY-MM-DD", action: "cycle" | "toggle" }
//  - action="cycle"  (교사): 없음 → WORK → PERSONAL → 삭제
//  - action="toggle" (학생): 없음 ↔ STUDENT
export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: number; date?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { userId, date, action } = body;

  if (
    typeof userId !== "number" ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (action !== "cycle" && action !== "toggle")
  ) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // KST 해당 일자 00:00 → UTC Date로 변환 (기존 checkIn.date 저장 규칙과 동일)
  // DB는 YYYY-MM-DD 00:00:00 UTC로 저장되어 있음 (todayKST()가 en-CA 포맷이라 동일 규칙)
  const targetDate = new Date(`${date}T00:00:00.000Z`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }

  if (action === "cycle" && user.role !== "TEACHER") {
    return NextResponse.json({ error: "교사에게만 적용됩니다." }, { status: 400 });
  }
  if (action === "toggle" && user.role !== "STUDENT") {
    return NextResponse.json({ error: "학생에게만 적용됩니다." }, { status: 400 });
  }

  const existing = await prisma.checkIn.findUnique({
    where: { userId_date: { userId, date: targetDate } },
    select: { id: true, type: true },
  });

  // --- cycle (교사) ---
  if (action === "cycle") {
    if (!existing) {
      await prisma.checkIn.create({
        data: { userId, date: targetDate, type: "WORK" },
      });
      return NextResponse.json({ success: true, state: "WORK" });
    }
    if (existing.type === "WORK") {
      await prisma.checkIn.update({
        where: { id: existing.id },
        data: { type: "PERSONAL" },
      });
      return NextResponse.json({ success: true, state: "PERSONAL" });
    }
    // PERSONAL (또는 예상 외 타입) → 삭제
    await prisma.checkIn.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true, state: "empty" });
  }

  // --- toggle (학생) ---
  if (!existing) {
    await prisma.checkIn.create({
      data: { userId, date: targetDate, type: "STUDENT" },
    });
    return NextResponse.json({ success: true, state: "STUDENT" });
  }
  await prisma.checkIn.delete({ where: { id: existing.id } });
  return NextResponse.json({ success: true, state: "empty" });
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 통과 (신규 파일 관련 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/admin/checkins/toggle/route.ts
git commit -m "feat(admin): add POST /api/admin/checkins/toggle for manual cycle/toggle"
```

---

## Task 2: AdminMealTable 셀 클릭 통합

**Files:**
- Modify: `src/components/AdminMealTable.tsx`

- [ ] **Step 1: `handleToggleType` 제거 및 `handleCellClick` 추가**

`src/components/AdminMealTable.tsx`의 기존 `handleToggleType` 함수(73~84번째 줄 영역)를 다음으로 **대체**한다:

```ts
  // 날짜를 "YYYY-MM-DD" (KST 달력 기준)로 포맷
  function formatDayKey(day: number): string {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  // 셀 클릭: 교사=cycle, 학생=toggle
  async function handleCellClick(userId: number, day: number) {
    const action = isTeacher ? "cycle" : "toggle";
    const res = await fetch("/api/admin/checkins/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date: formatDayKey(day), action }),
    });
    if (res.ok) {
      mutateGrid();
    }
  }
```

- [ ] **Step 2: 셀 렌더링의 onClick/스타일 조건 확장**

`AdminMealTable.tsx`에서 `{Array.from({ length: daysInMonth }, (_, i) => { ... })}` 내부 `<td>` (현재 150~171번째 줄 영역)를 다음으로 **대체**한다:

```tsx
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const checkIn = checkedDaysMap.get(day);
                  const weekend = isWeekend(day);
                  const clickable = !readonly;
                  return (
                    <td
                      key={day}
                      className={`text-center border-b px-0.5 py-1.5 ${
                        checkIn
                          ? isTeacher
                            ? checkIn.type === "WORK"
                              ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-bold"
                              : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                            : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                          : weekend
                            ? "bg-red-50/50 dark:bg-red-950/30"
                            : ""
                      } ${clickable ? "cursor-pointer hover:opacity-70 select-none" : ""}`}
                      title={
                        clickable
                          ? checkIn
                            ? `${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} (클릭하여 ${isTeacher ? "변경" : "삭제"})`
                            : "클릭하여 추가"
                          : checkIn
                            ? new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
                            : undefined
                      }
                      onClick={clickable ? () => handleCellClick(user.id, day) : undefined}
                    >
                      {checkIn ? (isTeacher ? (checkIn.type === "WORK" ? "근" : "개") : "O") : ""}
                    </td>
                  );
                })}
```

주요 차이점:
- `clickable = !readonly` — 교사/학생 모두, 빈 셀/주말 포함 모두 클릭 허용
- 학생 탭도 체크인 시 녹색 배경 유지 (기존과 동일)
- title: 빈 셀은 "클릭하여 추가", 있는 셀은 시각 + "(클릭하여 변경/삭제)"
- onClick은 이제 `handleCellClick(user.id, day)` 단일 경로

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 통과

- [ ] **Step 4: 빌드 검증**

Run: `npm run build`
Expected: 빌드 성공 (경고는 무방)

- [ ] **Step 5: 커밋**

```bash
git add src/components/AdminMealTable.tsx
git commit -m "feat(admin): enable manual cell click to cycle/toggle checkins"
```

---

## Task 3: 로컬/배포 수동 검증

**Files:** (코드 변경 없음)

- [ ] **Step 1: 개발 서버 기동**

Run: `npm run dev`
Expected: `http://localhost:3000` 에서 기동

- [ ] **Step 2: 최고관리자(ENV)로 로그인 → `/admin` 석식확인 탭**

- [ ] **Step 3: 교사 탭 cycle 검증**

당월 임의 교사 한 명 선택 후 빈 셀 클릭:
- 1회 클릭 → `근` (파란색) 표시, 해당 일자 합계 +1, 우측 "근무" 카운트 +1
- 2회 클릭 → `개` (녹색) 표시, "근무" -1 / "개인" +1
- 3회 클릭 → 빈 셀, 합계 복구

- [ ] **Step 4: 학생 탭 toggle 검증**

1학년 탭에서 임의 학생의 빈 셀 클릭:
- 1회 클릭 → `O` 표시, 합계 +1
- 2회 클릭 → 빈 셀, 합계 -1

- [ ] **Step 5: 주말 셀 검증**

주말(빨간색) 셀에서도 위 3·4가 동일하게 동작하는지 확인.

- [ ] **Step 6: 서브관리자 계정으로 재로그인**

- [ ] **Step 7: 서브관리자 readonly 확인**

모든 셀이 클릭 불가 (커서 포인터 없음, 클릭해도 무반응, title은 시각만 표시).

- [ ] **Step 8: 교사-관리자(adminLevel=ADMIN) 계정으로 재로그인**

Step 3·4와 동일하게 동작하는지 확인.

- [ ] **Step 9: 배포**

```bash
git push origin feat/posanmeal-mvp
```

Railway 자동 배포 대기 후 프로덕션에서 Step 3·4·5·7·8 동일 검증.

---

## Task 4: PROJECT_MAP 업데이트

**Files:**
- Modify: `PROJECT_MAP.md` (신규 엔드포인트 항목 추가)

- [ ] **Step 1: PROJECT_MAP에 toggle 엔드포인트 추가**

`PROJECT_MAP.md`의 API Routes 섹션에서 `/api/admin/checkins` 항목 바로 아래에 다음 한 줄을 삽입:

```
| `/api/admin/checkins/toggle` | POST | 관리자(write) | 수기 cycle(교사)/toggle(학생) |
```

(실제 기존 표 포맷에 맞춰 column 정렬 유지. 포맷이 다르면 기존 스타일에 맞춤)

- [ ] **Step 2: 커밋**

```bash
git add PROJECT_MAP.md
git commit -m "docs(map): add /api/admin/checkins/toggle endpoint"
```

---

## Self-Review 체크리스트 결과

- **Spec 커버리지**: 교사 cycle(Task 1·2), 학생 toggle(Task 1·2), 주말 포함(Task 2 Step 2의 `clickable = !readonly`), 권한 게이트(Task 1 `canWriteAdmin`), 서브관리자 readonly(기존 `readonly` prop 유지로 커버) — 모두 태스크에 포함됨.
- **Placeholder 스캔**: TBD/TODO/"적절히" 없음. 모든 코드 블록은 실제 구현 내용.
- **타입 일관성**: `formatDayKey`, `handleCellClick`, state 문자열(`"WORK"|"PERSONAL"|"STUDENT"|"empty"`) 앞뒤 태스크 간 일치.
- **날짜 처리**: Task 1에서 `new Date(\`${date}T00:00:00.000Z\`)`로 UTC 00:00 저장 — 기존 `todayKST()` 경로가 `en-CA` 포맷으로 동일 규칙을 사용하므로 호환됨.
