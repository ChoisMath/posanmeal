# 담임용 학생 QR 일괄 출력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담임교사가 "학생관리" 탭에서 학생을 다중 선택해, 학생별 QR 카드를 A4 한 장(4×4=16개/페이지)에 칸 구분으로 일괄 인쇄한다.

**Architecture:** 카드 QR은 만료 없는 고정 로컬 문자열 `posanmeal:{id}:{qrGeneration}:STUDENT`(4-part, 식사 무관)다. 서버는 `/api/teacher/students` 응답에 `qrString`만 추가하고, 체크인/스캔 로직은 손대지 않는다. 클라이언트는 체크박스 선택 → 미리보기 모달에서 `qrcode`로 이미지 생성 → `window.print()`로 A4 인쇄(`@page A4` + 페이지 분할 CSS).

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · `qrcode` · `@base-ui/react` Dialog · vitest

---

## 파일 구조

**생성**
- `src/lib/qr-card.ts` — `buildCardQrString(id, generation)` + `chunk(items, size)` 순수 유틸 (테스트 대상)
- `src/lib/__tests__/qr-card.test.ts` — 위 유틸 단위 테스트
- `src/components/StudentQRCard.tsx` — 단일 카드 프레젠테이션(mm 고정 치수)
- `src/components/StudentQRPrintDialog.tsx` — 미리보기 모달 + QR 생성 + A4 그리드 + 인쇄

**수정**
- `src/app/api/teacher/students/route.ts` — 응답 student에 `qrString` 추가
- `src/hooks/useTeacherStudents.ts` — `Student.qrString` 타입 추가
- `src/components/StudentTable.tsx` — 체크박스 열·전체선택·툴바·QR출력 버튼·선택 state·모달 연결

**비변경(중요)** — `src/app/api/checkin/route.ts`, `src/app/check/page.tsx`(`parseLocalQR`/`handleLocalScan`)는 기존 4-part 처리로 그대로 동작.

---

### Task 1: QR 문자열·청크 유틸 (`qr-card.ts`) — TDD

**Files:**
- Create: `src/lib/qr-card.ts`
- Test: `src/lib/__tests__/qr-card.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/__tests__/qr-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCardQrString, chunk } from "@/lib/qr-card";

describe("buildCardQrString", () => {
  it("4-part posanmeal 문자열을 만든다 (mealKind 없음)", () => {
    expect(buildCardQrString(42, "3")).toBe("posanmeal:42:3:STUDENT");
  });

  it("check 페이지 parseLocalQR 4-part 계약과 호환된다", () => {
    // parseLocalQR: parts.length === 4, parts[0]==='posanmeal', mealKind=parts[4](undefined)
    const parts = buildCardQrString(7, "1").split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("posanmeal");
    expect(parts[3]).toBe("STUDENT");
    expect(parts[4]).toBeUndefined();
  });
});

describe("chunk", () => {
  it("16개씩 페이지로 분할한다", () => {
    const arr = Array.from({ length: 35 }, (_, i) => i);
    const pages = chunk(arr, 16);
    expect(pages.length).toBe(3);
    expect(pages[0].length).toBe(16);
    expect(pages[1].length).toBe(16);
    expect(pages[2].length).toBe(3);
  });

  it("빈 배열은 빈 결과", () => {
    expect(chunk<number>([], 16)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- qr-card`
Expected: FAIL — `Failed to resolve import "@/lib/qr-card"` (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

Create `src/lib/qr-card.ts`:

```ts
const CARD_TYPE = "STUDENT";

/** 카드에 인쇄되는 고정 로컬 QR 문자열. mealKind 생략(4-part) → 조/중/석 무관, 스캔 시각으로 식사 판정. */
export function buildCardQrString(studentId: number, generation: string): string {
  return `posanmeal:${studentId}:${generation}:${CARD_TYPE}`;
}

/** items 를 size 개씩 끊어 페이지 배열로. 빈 입력은 빈 배열. */
export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- qr-card`
Expected: PASS (5 assertions)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/qr-card.ts src/lib/__tests__/qr-card.test.ts
git commit -m "feat(teacher): 학생 QR 카드 문자열·청크 유틸 추가"
```

---

### Task 2: 서버 — `/api/teacher/students` 에 `qrString` 추가

**Files:**
- Modify: `src/app/api/teacher/students/route.ts`
- Modify: `src/hooks/useTeacherStudents.ts`

- [ ] **Step 1: 라우트에 import 추가**

`src/app/api/teacher/students/route.ts` 상단 import 블록(현재 1–5행)에 두 줄 추가:

```ts
import { getCachedSettings } from "@/lib/settings-cache";
import { buildCardQrString } from "@/lib/qr-card";
```

- [ ] **Step 2: generation 읽고 studentsOut 에 qrString 추가**

같은 파일에서 `const studentsOut = students.map(...)` 블록(현재 74–81행)을 아래로 교체:

```ts
  const settings = await getCachedSettings();

  const studentsOut = students.map((s) => ({
    id: s.id,
    name: s.name,
    number: s.number,
    photoUrl: s.photoUrl,
    checkIns: s.checkIns,
    appliedDates: appliedByUser.get(s.id) ?? [],
    qrString: buildCardQrString(s.id, settings.qrGeneration),
  }));
```

- [ ] **Step 3: 훅 타입에 qrString 추가**

`src/hooks/useTeacherStudents.ts` 의 `Student` 인터페이스(현재 5–12행) 마지막 필드 뒤에 한 줄 추가:

```ts
interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  checkIns: { date: string; checkedAt: string; type: string; mealKind: MealKind | null }[];
  appliedDates: { date: string; mealKind: MealKind }[];
  qrString: string;
}
```

- [ ] **Step 4: 타입체크/빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(타입 에러 없음). `/api/teacher/students` 가 `qrString` 포함 응답.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/teacher/students/route.ts src/hooks/useTeacherStudents.ts
git commit -m "feat(api): 담임 학생 목록 응답에 qrString(고정 로컬 QR) 추가"
```

---

### Task 3: 단일 카드 컴포넌트 (`StudentQRCard`)

**Files:**
- Create: `src/components/StudentQRCard.tsx`

- [ ] **Step 1: 컴포넌트 작성**

Create `src/components/StudentQRCard.tsx`:

```tsx
interface StudentQRCardProps {
  grade: number;
  classNum: number;
  number: number;
  name: string;
  /** qrcode 로 생성한 data URL. 빈 문자열이면 플레이스홀더. */
  qrDataUrl: string;
}

/** 인쇄용 5×5cm(≈47mm) 학생 QR 카드. 화면 미리보기·인쇄에 동일 사용. 치수는 물리 크기 보장을 위해 mm 고정. */
export function StudentQRCard({ grade, classNum, number, name, qrDataUrl }: StudentQRCardProps) {
  return (
    <div
      style={{ width: "47mm", height: "47mm", padding: "2.5mm", boxSizing: "border-box" }}
      className="flex flex-col items-center justify-between overflow-hidden rounded-[2mm] border border-stone-400 bg-white text-black"
    >
      <div className="flex items-center" style={{ gap: "1.5mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/meal.png" alt="" style={{ width: "5mm", height: "5mm" }} className="object-contain" />
        <span style={{ fontSize: "3.6mm" }} className="font-bold tracking-tight">PosanMeal</span>
      </div>

      <div
        style={{ fontSize: "3mm", maxWidth: "42mm" }}
        className="overflow-hidden font-semibold whitespace-nowrap"
      >
        {grade}학년 {classNum}반 {number}번 {name}
      </div>

      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrDataUrl} alt="" style={{ width: "35mm", height: "35mm" }} />
      ) : (
        <div style={{ width: "35mm", height: "35mm" }} className="bg-stone-100" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/components/StudentQRCard.tsx
git commit -m "feat(teacher): StudentQRCard 카드 컴포넌트 추가(5×5cm mm 고정)"
```

---

### Task 4: 일괄 인쇄 모달 (`StudentQRPrintDialog`)

**Files:**
- Create: `src/components/StudentQRPrintDialog.tsx`

- [ ] **Step 1: 컴포넌트 작성**

Create `src/components/StudentQRPrintDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudentQRCard } from "@/components/StudentQRCard";
import { chunk } from "@/lib/qr-card";

export interface PrintStudent {
  id: number;
  name: string;
  number: number;
  qrString: string;
}

interface StudentQRPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: PrintStudent[];
  grade: number;
  classNum: number;
}

const CARDS_PER_PAGE = 16; // 4열 × 4행

export function StudentQRPrintDialog({
  open,
  onOpenChange,
  students,
  grade,
  classNum,
}: StudentQRPrintDialogProps) {
  const [qrMap, setQrMap] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // students 는 부모 filter 로 매 렌더 새 배열 → id 목록 키로 재생성 제어.
  const idsKey = students.map((s) => s.id).join(",");

  useEffect(() => {
    if (!open || students.length === 0) {
      setQrMap({});
      return;
    }
    let cancelled = false;
    setGenerating(true);
    (async () => {
      const entries = await Promise.all(
        students.map(async (s) => {
          const url = await QRCode.toDataURL(s.qrString, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#000000", light: "#ffffff" },
          });
          return [s.id, url] as const;
        }),
      );
      if (!cancelled) {
        setQrMap(Object.fromEntries(entries));
        setGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  const pages = chunk(students, CARDS_PER_PAGE);
  const handlePrint = () => window.print();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[92vw] sm:max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="whitespace-nowrap">
                QR 카드 출력 — {students.length}명
              </DialogTitle>
              <Button
                size="sm"
                className="rounded-xl"
                onClick={handlePrint}
                disabled={generating || students.length === 0}
              >
                <Printer className="mr-1 h-4 w-4" />
                {generating ? "준비 중..." : "인쇄"}
              </Button>
            </div>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-auto rounded-lg bg-muted/40 p-2">
            <div className="flex flex-wrap justify-center gap-2">
              {students.map((s) => (
                <StudentQRCard
                  key={s.id}
                  grade={grade}
                  classNum={classNum}
                  number={s.number}
                  name={s.name}
                  qrDataUrl={qrMap[s.id] ?? ""}
                />
              ))}
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            A4 한 장에 최대 16명(4×4)씩 인쇄됩니다.
          </p>
        </DialogContent>
      </Dialog>

      {/* 인쇄 전용 루트: 화면에선 숨김, 인쇄 시 이 영역만 노출(@page A4). body 직속 포털이라 fixed 모달과 위치 충돌 없음. */}
      {open &&
        mounted &&
        createPortal(
          <div className="qr-print-root" style={{ display: "none" }}>
            <style>{`
@media print {
  body > *:not(.qr-print-root) { display: none !important; }
  .qr-print-root { display: block !important; }
  .qr-print-page { break-after: page; }
  .qr-print-page:last-child { break-after: auto; }
  @page { size: A4; margin: 8mm; }
}
            `}</style>
            {pages.map((page, pageIndex) => (
              <div
                key={pageIndex}
                className="qr-print-page"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 47mm)",
                  gap: "2mm",
                  justifyContent: "center",
                  alignContent: "start",
                }}
              >
                {page.map((s) => (
                  <StudentQRCard
                    key={s.id}
                    grade={grade}
                    classNum={classNum}
                    number={s.number}
                    name={s.name}
                    qrDataUrl={qrMap[s.id] ?? ""}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(타입 에러 없음).

- [ ] **Step 3: 커밋**

```bash
git add src/components/StudentQRPrintDialog.tsx
git commit -m "feat(teacher): StudentQRPrintDialog A4 일괄 인쇄 모달 추가"
```

---

### Task 5: StudentTable — 체크박스 선택 · QR출력 버튼 · 모달 연결

**Files:**
- Modify: `src/components/StudentTable.tsx`

- [ ] **Step 1: import·아이콘·모달 추가**

`src/components/StudentTable.tsx` 상단 import(현재 1–7행)를 아래로 교체:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useTeacherStudents } from "@/hooks/useTeacherStudents";
import { buildMonthlyMealColumns, getDateDayKey, type MealColumn } from "@/lib/meal-columns";
import { StudentQRPrintDialog, type PrintStudent } from "@/components/StudentQRPrintDialog";
```

- [ ] **Step 2: 선택 state·파생값 추가**

`useTeacherStudents(...)` 호출 직후(현재 13–14행 다음)에 추가:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);

  const toggleOne = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleIds = students.map((s) => s.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const selectedPrintStudents: PrintStudent[] = students
    .filter((s) => selectedIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, number: s.number, qrString: s.qrString }));
```

- [ ] **Step 3: 월 이동 헤더 아래 툴바 추가**

월 이동 헤더 `</div>`(현재 73행) 바로 다음, 표 래퍼 `<div className="overflow-auto ...">`(현재 75행) 바로 앞에 삽입:

```tsx
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {selectedIds.size}명 선택
        </span>
        <Button
          size="sm"
          className="rounded-xl whitespace-nowrap"
          disabled={selectedIds.size === 0}
          onClick={() => setPrintOpen(true)}
        >
          <Printer className="mr-1 h-4 w-4" />
          QR출력
        </Button>
      </div>
```

- [ ] **Step 4: 헤더 첫 셀에 전체선택 체크박스**

`thead` 의 sticky 첫 셀(현재 79–81행, "번호 이름")을 아래로 교체:

```tsx
              <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[110px] text-fit-sm">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-amber-600"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={toggleAll}
                  />
                  <span>번호 이름</span>
                </label>
              </th>
```

- [ ] **Step 5: 본문 첫 셀을 체크박스 토글 라벨로**

`tbody` 의 sticky 첫 셀(현재 118–123행)을 아래로 교체:

```tsx
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-fit-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-amber-600"
                        checked={selectedIds.has(student.id)}
                        onChange={() => toggleOne(student.id)}
                      />
                      <span className="font-semibold">{student.number}</span>
                      <span>{student.name}</span>
                    </label>
                  </td>
```

- [ ] **Step 6: 모달 렌더 (최상위 wrapper 닫기 직전)**

컴포넌트 반환 JSX의 가장 바깥 `</div>`(현재 178행, `return (` 의 최상위 `<div>` 짝) **직전**에 삽입:

```tsx
      <StudentQRPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        students={selectedPrintStudents}
        grade={grade}
        classNum={classNum}
      />
```

- [ ] **Step 7: 빌드·테스트 확인**

Run: `npm run build && npm test`
Expected: 빌드 성공 + 전체 테스트 PASS.

- [ ] **Step 8: 커밋**

```bash
git add src/components/StudentTable.tsx
git commit -m "feat(teacher): 학생관리 체크박스 선택·전체선택·QR출력 버튼 연결"
```

---

### Task 6: 통합 검증 · 수동 확인 · 맵 갱신

**Files:** (검증 전용, 코드 변경 없음 → 발견 시 해당 Task로 회귀 수정)

- [ ] **Step 1: 전체 빌드·테스트**

Run: `npm run build && npm test`
Expected: 빌드 성공, 모든 vitest PASS.

- [ ] **Step 2: 수동 동작 확인 (`npm run dev`)**

`/teacher` → 학생관리 탭에서 점검:
- 체크박스로 학생 선택, 전체선택(헤더) 토글, "N명 선택" 갱신.
- 선택 0명이면 QR출력 비활성, 1명 이상이면 활성.
- QR출력 클릭 → 모달에 카드 미리보기(로고·"PosanMeal"·`{학년}학년 {반}반 {번호}번 {이름}` 한 줄·QR) 표시.
- "인쇄" → 브라우저 인쇄 미리보기가 **A4**에 카드 격자(최대 4×4)로 나오는지, 17명 이상 시 2페이지 분할 확인.
- (가능 시) 인쇄물 실측 ≈47mm, 로컬 모드 태블릿에서 스캔 → 체크인 동작.

- [ ] **Step 3: 반응형 UI 검토**

`responsive-ui-reviewer` 에이전트로 `StudentTable.tsx`·`StudentQRCard.tsx`·`StudentQRPrintDialog.tsx` 점검(줄바꿈 금지/sticky 배경/터치 타깃). 위반 시 회귀 수정 후 재커밋.

- [ ] **Step 4: PROJECT_MAP 갱신**

`project-map-updater`(또는 `project-map-keeper`) 에이전트 호출 — 신규 컴포넌트 2종(`StudentQRCard`, `StudentQRPrintDialog`), 신규 lib(`qr-card.ts`), `/api/teacher/students` 응답에 `qrString` 추가를 §5/§7/§8에 반영.

- [ ] **Step 5: (선택) 최종 커밋**

검토 수정이 있었다면:

```bash
git add -A
git commit -m "chore(teacher): QR 출력 반응형·맵 검토 반영"
```

---

## Self-Review (작성자 점검 완료)

- **스펙 커버리지**: ①QR 문자열=Task1·2 · ②서버 qrString=Task2 · ③체크박스/전체선택/툴바=Task5 · ④단일 카드(로고·한줄·큰 QR, 학교명 없음)=Task3 · ⑤A4 4×4 인쇄/페이지분할=Task4 · ⑥제약(미변경 체크인/강제갱신 무효화)=비변경 명시. 누락 없음.
- **Placeholder 스캔**: TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함.
- **타입 일관성**: `buildCardQrString`/`chunk`(Task1) ↔ 사용처(Task2 server, Task4 dialog) 일치. `PrintStudent`(Task4 export) ↔ Task5 import 일치. `qrString` 필드 server(Task2)·hook(Task2)·StudentTable 파생(Task5)·Dialog props(Task4) 일치. `StudentQRCard` props(grade/classNum/number/name/qrDataUrl) 호출부(Task4 2곳) 일치.
- **주의**: 카드/그리드 치수는 mm 단위(인쇄 물리 크기). 인쇄 격리는 `body > *:not(.qr-print-root)` 숨김 + body 직속 포털로 fixed 모달과 위치 충돌 방지. `qrcode`·`Printer`·native checkbox 가용 확인됨(체크박스 UI 컴포넌트 없음 → native input).
