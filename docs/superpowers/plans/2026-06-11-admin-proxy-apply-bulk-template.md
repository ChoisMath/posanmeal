# 관리자 대리 신청 모달 + 일괄업로드 양식 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/applications/[id]/stats`에서 관리자가 학생 신청 화면과 동일한 모달로 대리 신청(신규/수정)하고, 일괄업로드 양식을 날짜·요일별 O 표기 방식으로 개편한다.

**Architecture:** ① 학생 신청 폼을 `ApplicationApplyForm` 공용 컴포넌트로 추출해 학생 화면과 관리자 모달(`AdminApplyDialog`)이 공유. ② 양식 컬럼 생성↔헤더 역파싱을 `meal-template-columns.ts` 단일 lib로 통일해 다운로드/업로드가 항상 일치. DB 마이그레이션 없음 (`addedBy`/`updatedAt` 기존 필드 활용).

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, exceljs, zod, SWR, vitest

**Spec:** `docs/superpowers/specs/2026-06-11-admin-proxy-apply-bulk-template-design.md`

**배포:** 모든 태스크 완료 후 `feat/posanmeal-mvp` push → main 머지 → 양쪽 push (Task 7).

---

### Task 1: 양식 컬럼 빌더 lib (`meal-template-columns.ts`) — TDD

**Files:**
- Create: `src/lib/meal-template-columns.ts`
- Test: `src/lib/__tests__/meal-template-columns.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/__tests__/meal-template-columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildTemplateColumns,
  columnHeader,
  parseColumnHeader,
  type TemplateColumn,
} from "../meal-template-columns";

describe("buildTemplateColumns", () => {
  it("YN 식사는 단일 컬럼, NONE 식사는 제외", () => {
    const cols = buildTemplateColumns(
      [
        { mealKind: "BREAKFAST", method: "NONE" },
        { mealKind: "DINNER", method: "YN" },
      ],
      { DINNER: ["2026-07-01", "2026-07-02"] },
    );
    expect(cols).toEqual([{ kind: "DINNER", type: "YN" }]);
  });

  it("DATE 식사는 개설일별 컬럼을 날짜순으로 생성", () => {
    const cols = buildTemplateColumns(
      [{ mealKind: "LUNCH", method: "DATE" }],
      { LUNCH: ["2026-07-10", "2026-07-05"] },
    );
    expect(cols).toEqual([
      { kind: "LUNCH", type: "DATE", date: "2026-07-05" },
      { kind: "LUNCH", type: "DATE", date: "2026-07-10" },
    ]);
  });

  it("WEEKDAY 식사는 개설일에 등장하는 요일 합집합을 일~토 순으로 생성", () => {
    // 2026-07-06=월, 2026-07-07=화, 2026-07-13=월
    const cols = buildTemplateColumns(
      [{ mealKind: "BREAKFAST", method: "WEEKDAY" }],
      { BREAKFAST: ["2026-07-13", "2026-07-06", "2026-07-07"] },
    );
    expect(cols).toEqual([
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 1 },
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 2 },
    ]);
  });

  it("식사 순서는 조식→중식→석식", () => {
    const cols = buildTemplateColumns(
      [
        { mealKind: "DINNER", method: "YN" },
        { mealKind: "BREAKFAST", method: "YN" },
      ],
      {},
    );
    expect(cols.map((c) => c.kind)).toEqual(["BREAKFAST", "DINNER"]);
  });
});

describe("columnHeader", () => {
  it("YN → 식사 라벨", () => {
    expect(columnHeader({ kind: "BREAKFAST", type: "YN" })).toBe("조식");
  });
  it("DATE → '중식-7월 5일' 형식", () => {
    expect(columnHeader({ kind: "LUNCH", type: "DATE", date: "2026-07-05" })).toBe(
      "중식-7월 5일",
    );
  });
  it("WEEKDAY → '조식-월요일' 형식", () => {
    expect(columnHeader({ kind: "BREAKFAST", type: "WEEKDAY", weekday: 1 })).toBe(
      "조식-월요일",
    );
  });
});

describe("parseColumnHeader", () => {
  const months = [{ year: 2026, month: 7 }, { year: 2026, month: 8 }];

  it("생성된 모든 헤더는 역파싱으로 원복된다 (왕복)", () => {
    const cols: TemplateColumn[] = [
      { kind: "BREAKFAST", type: "YN" },
      { kind: "LUNCH", type: "DATE", date: "2026-07-05" },
      { kind: "DINNER", type: "DATE", date: "2026-08-31" },
      { kind: "BREAKFAST", type: "WEEKDAY", weekday: 0 },
      { kind: "DINNER", type: "WEEKDAY", weekday: 6 },
    ];
    for (const col of cols) {
      expect(parseColumnHeader(columnHeader(col), months)).toEqual(col);
    }
  });

  it("연도 경계 공고에서 월로 연도를 복원한다", () => {
    const boundary = [{ year: 2026, month: 12 }, { year: 2027, month: 1 }];
    expect(parseColumnHeader("석식-1월 5일", boundary)).toEqual({
      kind: "DINNER",
      type: "DATE",
      date: "2027-01-05",
    });
    expect(parseColumnHeader("석식-12월 25일", boundary)).toEqual({
      kind: "DINNER",
      type: "DATE",
      date: "2026-12-25",
    });
  });

  it("대상 월에 없는 날짜 헤더는 null", () => {
    expect(parseColumnHeader("중식-3월 1일", months)).toBeNull();
  });

  it("인식 불가 헤더는 null", () => {
    expect(parseColumnHeader("이름", months)).toBeNull();
    expect(parseColumnHeader("간식-7월 5일", months)).toBeNull();
    expect(parseColumnHeader("", months)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- meal-template-columns`
Expected: FAIL — `Cannot find module '../meal-template-columns'`

- [ ] **Step 3: 구현**

`src/lib/meal-template-columns.ts`:

```ts
import {
  MEAL_LABEL,
  WEEKDAY_LABELS,
  weekdayOf,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

// 일괄신청 양식 컬럼의 단일 진실 — 다운로드(export)와 업로드(import)가 공유한다.
export type TemplateColumn =
  | { kind: MealKind; type: "YN" }
  | { kind: MealKind; type: "DATE"; date: string } // "YYYY-MM-DD"
  | { kind: MealKind; type: "WEEKDAY"; weekday: number }; // 0=일 ~ 6=토

const MEAL_KINDS_ORDER: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];

export function buildTemplateColumns(
  meals: { mealKind: MealKind; method: MealApplyMethod }[],
  openDatesUnion: Partial<Record<MealKind, string[]>>,
): TemplateColumn[] {
  const cols: TemplateColumn[] = [];
  for (const kind of MEAL_KINDS_ORDER) {
    const meal = meals.find((m) => m.mealKind === kind);
    if (!meal || meal.method === "NONE") continue;
    const open = [...(openDatesUnion[kind] ?? [])].sort();

    if (meal.method === "YN") {
      cols.push({ kind, type: "YN" });
    } else if (meal.method === "DATE") {
      for (const date of open) cols.push({ kind, type: "DATE", date });
    } else {
      const weekdays = [...new Set(open.map(weekdayOf))].sort((a, b) => a - b);
      for (const weekday of weekdays) cols.push({ kind, type: "WEEKDAY", weekday });
    }
  }
  return cols;
}

export function columnHeader(col: TemplateColumn): string {
  const label = MEAL_LABEL[col.kind];
  if (col.type === "YN") return label;
  if (col.type === "DATE") {
    const [, m, d] = col.date.split("-");
    return `${label}-${Number(m)}월 ${Number(d)}일`;
  }
  return `${label}-${WEEKDAY_LABELS[col.weekday]}요일`;
}

const LABEL_TO_KIND = new Map<string, MealKind>(
  (Object.entries(MEAL_LABEL) as [MealKind, string][]).map(([k, v]) => [v, k]),
);

/**
 * 헤더 문자열을 컬럼으로 역파싱. months(공고 대상 월 목록)로 연도를 복원한다.
 * 인식할 수 없는 헤더는 null (해당 컬럼 무시).
 */
export function parseColumnHeader(
  header: string,
  months: { year: number; month: number }[],
): TemplateColumn | null {
  const text = header.trim();
  const dashIdx = text.indexOf("-");

  if (dashIdx === -1) {
    const kind = LABEL_TO_KIND.get(text);
    return kind ? { kind, type: "YN" } : null;
  }

  const kind = LABEL_TO_KIND.get(text.slice(0, dashIdx));
  if (!kind) return null;
  const rest = text.slice(dashIdx + 1).trim();

  const dateMatch = rest.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
  if (dateMatch) {
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    const found = months.find((m) => m.month === month);
    if (!found) return null;
    return {
      kind,
      type: "DATE",
      date: `${found.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }

  const wdMatch = rest.match(/^([일월화수목금토])요일$/);
  if (wdMatch) {
    return { kind, type: "WEEKDAY", weekday: WEEKDAY_LABELS.indexOf(wdMatch[1]) };
  }

  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- meal-template-columns`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/meal-template-columns.ts src/lib/__tests__/meal-template-columns.test.ts
git commit -m "feat(admin): 일괄신청 양식 컬럼 빌더/헤더 파서 lib 추가"
```

---

### Task 2: 양식 다운로드 개편 (`export?template=true`)

**Files:**
- Modify: `src/app/api/admin/applications/[id]/export/route.ts:37-127` (template 분기 전체 교체)

- [ ] **Step 1: import 추가**

파일 상단 import에 추가:

```ts
import { buildTemplateColumns, columnHeader } from "@/lib/meal-template-columns";
import type { MealApplyMethod } from "@/lib/meal-plan";
```

- [ ] **Step 2: template 분기 교체**

기존 `if (isTemplate) { ... }` 블록(37~127행, `MEAL_KINDS_ORDER`/`MEAL_LABEL_KO` 상수 포함)을 아래로 전체 교체:

```ts
    // ── Template mode: 일괄신청 양식 (YN=단일 / DATE=날짜별 / WEEKDAY=요일별 컬럼) ──
    if (isTemplate) {
      const [appMealsConfig, openDateRows, allStudents, approvedRegs] = await Promise.all([
        prisma.mealApplicationMeal.findMany({ where: { applicationId: appId } }),
        prisma.mealApplicationMealDate.findMany({
          where: { applicationId: appId },
          select: { mealKind: true, date: true },
        }),
        prisma.user.findMany({
          where: { role: "STUDENT" },
          select: { id: true, name: true, grade: true, classNum: true, number: true },
          orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }],
        }),
        prisma.mealRegistration.findMany({
          where: { applicationId: appId, status: "APPROVED" },
          include: {
            meals: { select: { mealKind: true, applied: true, weekdaysByMonth: true } },
            mealDates: { select: { mealKind: true, date: true } },
          },
        }),
      ]);

      // 전 학년 합집합 개설일
      const openSets: Partial<Record<MealKind, Set<string>>> = {};
      for (const row of openDateRows) {
        const kind = row.mealKind as MealKind;
        (openSets[kind] ??= new Set()).add(toDateKey(row.date));
      }
      const openDatesUnion: Partial<Record<MealKind, string[]>> = {};
      for (const kind of Object.keys(openSets) as MealKind[]) {
        openDatesUnion[kind] = [...openSets[kind]!].sort();
      }

      const columns = buildTemplateColumns(
        appMealsConfig.map((m) => ({
          mealKind: m.mealKind as MealKind,
          method: m.method as MealApplyMethod,
        })),
        openDatesUnion,
      );

      // userId → 프리필 정보 (YN: applied, DATE: 확정일, WEEKDAY: 월 합집합 요일)
      type Prefill = {
        appliedKinds: Set<MealKind>;
        dateKeys: Set<string>; // "KIND:YYYY-MM-DD"
        weekdays: Set<string>; // "KIND:0..6"
      };
      const prefillByUser = new Map<number, Prefill>();
      for (const reg of approvedRegs) {
        const p: Prefill = { appliedKinds: new Set(), dateKeys: new Set(), weekdays: new Set() };
        for (const m of reg.meals) {
          if (!m.applied) continue;
          p.appliedKinds.add(m.mealKind as MealKind);
          if (m.weekdaysByMonth) {
            const byMonth = JSON.parse(m.weekdaysByMonth) as Record<string, number[]>;
            for (const wds of Object.values(byMonth)) {
              for (const wd of wds) p.weekdays.add(`${m.mealKind}:${wd}`);
            }
          }
        }
        for (const d of reg.mealDates) {
          p.dateKeys.add(`${d.mealKind}:${toDateKey(d.date)}`);
        }
        prefillByUser.set(reg.userId, p);
      }

      const HEADER_FILL: Record<MealKind, string> = {
        BREAKFAST: "FFFFF2CC",
        LUNCH: "FFE2EFDA",
        DINNER: "FFDDEBF7",
      };

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("일괄신청양식");
      const totalCols = 4 + columns.length;

      // 1행: 헤더
      const headerRow = sheet.getRow(1);
      ["학년", "반", "번호", "이름"].forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
      });
      columns.forEach((col, i) => {
        const cell = headerRow.getCell(5 + i);
        cell.value = columnHeader(col);
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER_FILL[col.kind] },
        };
      });

      // 2행: 안내문
      sheet.mergeCells(2, 1, 2, Math.max(totalCols, 7));
      const guideCell = sheet.getCell(2, 1);
      guideCell.value =
        "신청할 날짜/요일에 O 표시. O를 모두 지워도 기존 신청은 취소되지 않습니다 (취소는 신청 명단에서).";
      guideCell.alignment = { horizontal: "left" };
      guideCell.font = { italic: true, color: { argb: "FF888888" } };

      // 열 너비
      [6, 6, 6, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
      columns.forEach((col, i) => {
        sheet.getColumn(5 + i).width = col.type === "YN" ? 8 : 12;
      });

      // 3행~: 학생 목록 + 프리필
      let rowIdx = 3;
      for (const s of allStudents) {
        const r = sheet.getRow(rowIdx++);
        r.getCell(1).value = s.grade;
        r.getCell(2).value = s.classNum;
        r.getCell(3).value = s.number;
        r.getCell(4).value = s.name;
        const p = prefillByUser.get(s.id);
        columns.forEach((col, i) => {
          const cell = r.getCell(5 + i);
          let marked = false;
          if (p) {
            if (col.type === "YN") marked = p.appliedKinds.has(col.kind);
            else if (col.type === "DATE") marked = p.dateKeys.has(`${col.kind}:${col.date}`);
            else marked = p.weekdays.has(`${col.kind}:${col.weekday}`);
          }
          cell.value = marked ? "O" : "";
          cell.alignment = { horizontal: "center" };
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(`${application.title}_일괄신청양식.xlsx`)}"`,
        },
      });
    }
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/[id]/export/route.ts
git commit -m "feat(admin): 일괄신청 양식을 날짜/요일별 컬럼으로 개편 (기존 신청 프리필)"
```

---

### Task 3: 일괄업로드 개편 (`import/route.ts`)

**Files:**
- Modify: `src/app/api/admin/applications/[id]/import/route.ts` (전체 교체)
- Modify: `src/components/meal/ApplicationStats.tsx:502-504` (결과 토스트)

- [ ] **Step 1: import route 전체 교체**

`src/app/api/admin/applications/[id]/import/route.ts` 전체를 아래로 교체:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import {
  resolveRegistrationSelections,
  writeRegistration,
  toDateKey,
} from "@/lib/meal-plan-server";
import { parseColumnHeader, type TemplateColumn } from "@/lib/meal-template-columns";
import {
  monthsOf,
  expandWeekdays,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

function cellText(raw: unknown): string {
  // 혼합 서식 셀은 exceljs가 richText 객체로 반환한다
  if (raw != null && typeof raw === "object" && "richText" in raw) {
    return (raw as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  return String(raw ?? "");
}

function isOMarked(raw: unknown): boolean {
  const v = cellText(raw).trim();
  return v === "O" || v === "o" || v === "ㅇ";
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
  const applicationId = parseInt(id);

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: "시트를 찾을 수 없습니다." }, { status: 400 });
  }

  // 공고 식사 설정 + 학년별 개설일 + 전체 학생 목록 병렬 조회
  const [appMealsConfig, openDateRows, allStudents] = await Promise.all([
    prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
    prisma.mealApplicationMealDate.findMany({
      where: { applicationId },
      select: { mealKind: true, grade: true, date: true },
    }),
    prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, grade: true, classNum: true, number: true },
    }),
  ]);

  const methodByKind = new Map<MealKind, MealApplyMethod>();
  for (const m of appMealsConfig) {
    methodByKind.set(m.mealKind as MealKind, m.method as MealApplyMethod);
  }

  // "{grade}:{kind}" → 해당 학년 개설일 Set
  const openByGradeKind = new Map<string, Set<string>>();
  for (const row of openDateRows) {
    const key = `${row.grade}:${row.mealKind}`;
    let set = openByGradeKind.get(key);
    if (!set) {
      set = new Set();
      openByGradeKind.set(key, set);
    }
    set.add(toDateKey(row.date));
  }

  const startYear = application.startYear ?? new Date().getFullYear();
  const startMonth = application.startMonth ?? new Date().getMonth() + 1;
  const monthCount = application.monthCount ?? 1;
  const months = monthsOf(startYear, startMonth, monthCount);
  const monthKeys = months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);

  // 1행 헤더 파싱 (5열~): colIdx → TemplateColumn
  const headerRow = sheet.getRow(1);
  const columnMap = new Map<number, TemplateColumn>();
  for (let c = 5; c <= sheet.columnCount; c++) {
    const col = parseColumnHeader(cellText(headerRow.getCell(c).value), months);
    if (!col) continue;
    const method = methodByKind.get(col.kind);
    if (!method || method === "NONE") continue;
    columnMap.set(c, col);
  }

  if (columnMap.size === 0) {
    return NextResponse.json(
      { error: "양식 형식이 올바르지 않습니다. 양식을 다시 다운로드해 사용해주세요." },
      { status: 400 },
    );
  }

  // 학년-반-번호 → 학생
  const studentMap = new Map<string, { id: number; grade: number }>();
  for (const s of allStudents) {
    if (s.grade != null && s.classNum != null && s.number != null) {
      studentMap.set(`${s.grade}-${s.classNum}-${s.number}`, { id: s.id, grade: s.grade });
    }
  }

  type MealInput = {
    mealKind: MealKind;
    applied: true;
    exempt: false;
    selectedDates?: string[];
    weekdaysByMonth?: Record<string, number[]>;
  };
  type RowEntry = { userId: number; grade: number; meals: MealInput[] };

  const toProcess: RowEntry[] = [];
  let skippedNotFound = 0;
  let skippedInvalid = 0;
  let ignoredMarks = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;

    // 식사별 O 표시 수집
    const ynMarked = new Set<MealKind>();
    const dateMarks = new Map<MealKind, string[]>();
    const weekdayMarks = new Map<MealKind, Set<number>>();
    let anyMark = false;

    for (const [colIdx, col] of columnMap) {
      if (!isOMarked(row.getCell(colIdx).value)) continue;
      anyMark = true;
      if (col.type === "YN") {
        ynMarked.add(col.kind);
      } else if (col.type === "DATE") {
        let arr = dateMarks.get(col.kind);
        if (!arr) {
          arr = [];
          dateMarks.set(col.kind, arr);
        }
        arr.push(col.date);
      } else {
        let set = weekdayMarks.get(col.kind);
        if (!set) {
          set = new Set();
          weekdayMarks.set(col.kind, set);
        }
        set.add(col.weekday);
      }
    }

    // O가 하나도 없으면 건너뜀 (기존 신청 유지)
    if (!anyMark) return;

    const grade = row.getCell(1).value;
    const classNum = row.getCell(2).value;
    const number = row.getCell(3).value;
    const found = studentMap.get(`${grade}-${classNum}-${number}`);
    if (!found) {
      skippedNotFound++;
      return;
    }

    const markedKinds = new Set<MealKind>([
      ...ynMarked,
      ...dateMarks.keys(),
      ...weekdayMarks.keys(),
    ]);
    const meals: MealInput[] = [];

    for (const kind of markedKinds) {
      const method = methodByKind.get(kind);
      if (!method || method === "NONE") continue;
      const open = openByGradeKind.get(`${found.grade}:${kind}`) ?? new Set<string>();

      if (method === "YN") {
        meals.push({ mealKind: kind, applied: true, exempt: false });
        continue;
      }

      if (method === "DATE") {
        const marks = dateMarks.get(kind) ?? [];
        const valid = marks.filter((d) => open.has(d));
        ignoredMarks += marks.length - valid.length;
        if (valid.length === 0) continue; // 유효 날짜 없음 → 이 식사만 제외
        meals.push({ mealKind: kind, applied: true, exempt: false, selectedDates: valid.sort() });
        continue;
      }

      // WEEKDAY: 표시된 요일을 모든 대상 월에 동일 적용
      const wds = [...(weekdayMarks.get(kind) ?? [])].sort((a, b) => a - b);
      const expanded = expandWeekdays([...open].sort(), wds);
      if (wds.length === 0 || expanded.length === 0) {
        ignoredMarks += wds.length;
        continue;
      }
      const weekdaysByMonth: Record<string, number[]> = {};
      for (const mk of monthKeys) weekdaysByMonth[mk] = wds;
      meals.push({ mealKind: kind, applied: true, exempt: false, weekdaysByMonth });
    }

    if (meals.length === 0) {
      skippedInvalid++;
      return;
    }
    toProcess.push({ userId: found.id, grade: found.grade, meals });
  });

  let added = 0;
  let updated = 0;

  for (const entry of toProcess) {
    const resolved = await resolveRegistrationSelections(applicationId, entry.grade, entry.meals);
    if (!resolved.ok) {
      skippedInvalid++;
      continue;
    }

    try {
      const result = await prisma.$transaction((tx) =>
        writeRegistration(tx, applicationId, entry.userId, "(관리자 일괄등록)", resolved.resolved, "ADMIN"),
      );
      if (result.created) {
        added++;
      } else {
        updated++;
      }
    } catch {
      skippedInvalid++;
    }
  }

  return NextResponse.json({
    added,
    updated,
    skippedNotFound,
    skippedInvalid,
    ignoredMarks,
    total: toProcess.length + skippedNotFound,
  });
}
```

- [ ] **Step 2: ApplicationStats 결과 토스트에 무시 건수 추가**

`src/components/meal/ApplicationStats.tsx`의 `handleImport` 내 `toast.success(...)` 호출을 교체:

```ts
      toast.success(
        `추가 ${json.added ?? 0} · 갱신 ${json.updated ?? 0} · 미발견 ${json.skippedNotFound ?? 0} · 오류 ${json.skippedInvalid ?? 0} · 무시된 표시 ${json.ignoredMarks ?? 0}`,
      );
```

- [ ] **Step 3: 타입체크 + 기존 테스트**

Run: `npx tsc --noEmit; npm test`
Expected: 에러 없음, 테스트 전체 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/[id]/import/route.ts src/components/meal/ApplicationStats.tsx
git commit -m "feat(admin): 일괄업로드를 헤더 파싱 기반 날짜/요일별 O 표기로 개편"
```

---

### Task 4: 신청 상세 GET API (`registrations/[regId]`)

**Files:**
- Modify: `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` (GET 추가)

- [ ] **Step 1: import 수정**

```ts
import { canWriteAdmin, canReadAdmin } from "@/lib/permissions";
import { resolveRegistrationSelections, toDateKey } from "@/lib/meal-plan-server";
```

(기존 `canWriteAdmin`, `resolveRegistrationSelections` import 줄을 위처럼 확장)

- [ ] **Step 2: GET 핸들러 추가**

파일의 `PATCH` 함수 위에 추가:

```ts
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> },
) {
  const session = await auth();
  if (!canReadAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, regId } = await params;
  const applicationId = parseInt(id, 10);
  const registrationId = parseInt(regId, 10);
  if (Number.isNaN(applicationId) || Number.isNaN(registrationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { id: registrationId },
    include: {
      user: { select: { id: true, name: true, grade: true, classNum: true, number: true } },
      meals: true,
      mealDates: { orderBy: { date: "asc" } },
    },
  });

  if (!reg || reg.applicationId !== applicationId) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    registration: {
      id: reg.id,
      status: reg.status,
      addedBy: reg.addedBy,
      createdAt: reg.createdAt,
      updatedAt: reg.updatedAt,
      user: reg.user,
      meals: reg.meals.map((rm) => ({
        mealKind: rm.mealKind,
        applied: rm.applied,
        exempt: rm.exempt,
        weekdaysByMonth: rm.weekdaysByMonth
          ? (JSON.parse(rm.weekdaysByMonth) as Record<string, number[]>)
          : null,
        selectedDates: reg.mealDates
          .filter((d) => d.mealKind === rm.mealKind)
          .map((d) => toDateKey(d.date)),
      })),
    },
  });
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add "src/app/api/admin/applications/[id]/registrations/[regId]/route.ts"
git commit -m "feat(admin): 신청 상세 GET API 추가 (selectedDates·weekdaysByMonth 포함)"
```

---

### Task 5: 공용 신청 폼 추출 + 학생 화면 래퍼화 + 대리 신청 표시

**Files:**
- Create: `src/components/meal/ApplicationApplyForm.tsx`
- Modify: `src/components/meal/StudentApplicationView.tsx` (전체 교체)
- Modify: `src/app/api/applications/[id]/route.ts:87` (myRegistration에 addedBy/updatedAt)

- [ ] **Step 1: ApplicationApplyForm 작성**

`src/components/meal/ApplicationApplyForm.tsx` (StudentApplicationView에서 식사별 선택 UI·상태·금액 계산을 이동):

```tsx
"use client";

import { useCallback, useState, type ReactNode } from "react";
import { StudentMealCalendar } from "./StudentMealCalendar";
import { MEAL_THEME } from "./meal-ui";
import {
  MEAL_LABEL,
  METHOD_LABEL,
  monthsOf,
  monthKeyOf,
  weekdayOf,
  calcMealFee,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

// 서버(resolveRegistrationSelections)와 동일하게 월별 요일 선택을 날짜로 전개
function expandWeekdaysPerMonth(
  openDates: string[],
  weekdays: Record<string, Set<number>>,
): string[] {
  return openDates
    .filter((d) => weekdays[monthKeyOf(d)]?.has(weekdayOf(d)) ?? false)
    .sort();
}

export interface ApplyFormMeal {
  mealKind: MealKind;
  price: number;
  exemptionSelectable: boolean;
  method: MealApplyMethod;
  openDates: string[];
}

export interface ApplyFormApplication {
  startYear: number;
  startMonth: number;
  monthCount: number;
  meals: ApplyFormMeal[];
}

export interface InitialRegistrationMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  weekdaysByMonth: Record<string, number[]> | null;
  selectedDates: string[];
}

export interface RegistrationMealBody {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  selectedDates?: string[];
  weekdaysByMonth?: Record<string, number[]>;
}

interface MealState {
  applied: boolean;
  exempt: boolean;
  dates: Set<string>;
  weekdays: Record<string, Set<number>>;
}

function buildInitialMealState(
  meal: ApplyFormMeal,
  existing?: InitialRegistrationMeal,
): MealState {
  if (!existing) {
    return {
      applied: meal.method === "YN",
      exempt: false,
      dates: new Set(),
      weekdays: {},
    };
  }

  const weekdays: Record<string, Set<number>> = {};
  if (existing.weekdaysByMonth) {
    for (const [mk, wds] of Object.entries(existing.weekdaysByMonth)) {
      weekdays[mk] = new Set(wds);
    }
  }

  return {
    applied: existing.applied,
    exempt: existing.exempt,
    dates: new Set(existing.selectedDates),
    weekdays,
  };
}

interface ApplicationApplyFormProps {
  application: ApplyFormApplication;
  initialMeals?: InitialRegistrationMeal[];
  disabled?: boolean;
  footer: (ctx: {
    buildMealsBody: () => RegistrationMealBody[];
    totalFee: number;
  }) => ReactNode;
}

export function ApplicationApplyForm({
  application,
  initialMeals,
  disabled = false,
  footer,
}: ApplicationApplyFormProps) {
  const [mealStates, setMealStates] = useState<Record<string, MealState>>(() => {
    const states: Record<string, MealState> = {};
    for (const meal of application.meals) {
      const existing = initialMeals?.find((m) => m.mealKind === meal.mealKind);
      states[meal.mealKind] = buildInitialMealState(meal, existing);
    }
    return states;
  });

  const updateMealState = useCallback(
    (kind: MealKind, patch: Partial<MealState>) => {
      setMealStates((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], ...patch },
      }));
    },
    [],
  );

  const handleToggleDate = useCallback((kind: MealKind, dateKey: string) => {
    setMealStates((prev) => {
      const cur = prev[kind];
      const next = new Set(cur.dates);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return { ...prev, [kind]: { ...cur, dates: next } };
    });
  }, []);

  const handleToggleWeekday = useCallback(
    (kind: MealKind, monthKey: string, weekday: number) => {
      setMealStates((prev) => {
        const cur = prev[kind];
        const monthWds = new Set(cur.weekdays[monthKey] ?? []);
        if (monthWds.has(weekday)) monthWds.delete(weekday);
        else monthWds.add(weekday);
        return {
          ...prev,
          [kind]: {
            ...cur,
            weekdays: { ...cur.weekdays, [monthKey]: monthWds },
          },
        };
      });
    },
    [],
  );

  const buildMealsBody = useCallback((): RegistrationMealBody[] => {
    return application.meals.map((meal) => {
      const st = mealStates[meal.mealKind];
      if (!st) return { mealKind: meal.mealKind, applied: false, exempt: false };

      if (meal.method === "YN") {
        return {
          mealKind: meal.mealKind,
          applied: st.applied,
          exempt: st.exempt,
        };
      }

      if (meal.method === "WEEKDAY") {
        const weekdaysByMonth: Record<string, number[]> = {};
        for (const [mk, wds] of Object.entries(st.weekdays)) {
          weekdaysByMonth[mk] = [...wds];
        }
        return {
          mealKind: meal.mealKind,
          applied: Object.values(weekdaysByMonth).some((wds) => wds.length > 0),
          exempt: st.exempt,
          weekdaysByMonth,
        };
      }

      if (meal.method === "DATE") {
        return {
          mealKind: meal.mealKind,
          applied: st.dates.size > 0,
          exempt: st.exempt,
          selectedDates: [...st.dates].sort(),
        };
      }

      return { mealKind: meal.mealKind, applied: false, exempt: false };
    });
  }, [application.meals, mealStates]);

  const months = monthsOf(application.startYear, application.startMonth, application.monthCount);

  let totalFee = 0;
  for (const meal of application.meals) {
    const st = mealStates[meal.mealKind];
    if (!st || !st.applied) continue;
    let dayCount = 0;
    if (meal.method === "YN") {
      dayCount = meal.openDates.length;
    } else if (meal.method === "DATE") {
      dayCount = st.dates.size;
    } else if (meal.method === "WEEKDAY") {
      dayCount = expandWeekdaysPerMonth(meal.openDates, st.weekdays).length;
    }
    totalFee += calcMealFee(meal.price, dayCount, st.exempt);
  }

  return (
    <div className="space-y-3">
      {application.meals.map((meal) => {
        const theme = MEAL_THEME[meal.mealKind];
        const st = mealStates[meal.mealKind];
        if (!st) return null;

        const openDatesSet = new Set(meal.openDates);

        let dayCount = 0;
        let derivedSelectedDates = new Set<string>();

        if (meal.method === "YN") {
          dayCount = st.applied ? meal.openDates.length : 0;
          if (st.applied) derivedSelectedDates = openDatesSet;
        } else if (meal.method === "DATE") {
          dayCount = st.dates.size;
          derivedSelectedDates = st.dates;
        } else if (meal.method === "WEEKDAY") {
          const expanded = expandWeekdaysPerMonth(meal.openDates, st.weekdays);
          dayCount = expanded.length;
          derivedSelectedDates = new Set(expanded);
        }

        const fee = calcMealFee(meal.price, dayCount, st.exempt);

        return (
          <div key={meal.mealKind} className="card-elevated rounded-2xl border-0 overflow-hidden">
            {/* 섹션 헤더 */}
            <div className={`px-4 py-3 flex flex-wrap items-center gap-2 ${theme.side}`}>
              <span className={`font-semibold text-sm whitespace-nowrap ${theme.text}`}>
                {MEAL_LABEL[meal.mealKind]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${theme.head} ${theme.text}`}>
                {METHOD_LABEL[meal.method]}
              </span>
              {meal.method === "YN" && (
                <div className="flex items-center gap-3 ml-auto">
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={st.applied}
                      disabled={disabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: true })}
                      className="h-4 w-4"
                    />
                    신청함
                  </label>
                  <label className={`inline-flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name={`yn-${meal.mealKind}`}
                      checked={!st.applied}
                      disabled={disabled}
                      onChange={() => updateMealState(meal.mealKind, { applied: false })}
                      className="h-4 w-4"
                    />
                    신청안함
                  </label>
                </div>
              )}
            </div>

            <div className={`p-3 space-y-3 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
              {/* 달력 */}
              {months.map(({ year, month }) => {
                const mk = `${year}-${String(month).padStart(2, "0")}`;
                const selectedWdsForMonth = st.weekdays[mk] ?? new Set<number>();

                return (
                  <StudentMealCalendar
                    key={mk}
                    year={year}
                    month={month}
                    mealKind={meal.mealKind}
                    openDates={openDatesSet}
                    mode={
                      meal.method === "WEEKDAY"
                        ? "weekday"
                        : meal.method === "DATE"
                          ? "date"
                          : "readonly"
                    }
                    selectedDates={derivedSelectedDates}
                    selectedWeekdays={selectedWdsForMonth}
                    onToggleDate={(d) => handleToggleDate(meal.mealKind, d)}
                    onToggleWeekday={(wd) => handleToggleWeekday(meal.mealKind, mk, wd)}
                  />
                );
              })}

              {/* 면제 체크박스 */}
              {meal.exemptionSelectable && (
                <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={st.exempt}
                    onChange={(e) => updateMealState(meal.mealKind, { exempt: e.target.checked })}
                  />
                  <span className="whitespace-nowrap">면제 대상입니다</span>
                </label>
              )}

              {/* 금액 줄 */}
              <p className="text-sm font-medium whitespace-nowrap">
                총 급식비 : {fee.toLocaleString()}원
                {meal.method !== "YN" && (
                  <span className="text-muted-foreground font-normal">
                    {" "}({meal.price.toLocaleString()}원×{dayCount}일)
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}

      {/* 합계 + footer (서명/안내 + 버튼은 호출측이 렌더링) */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-4">
        <p className="text-base font-bold whitespace-nowrap">
          총 납부 금액 : {totalFee.toLocaleString()}원
        </p>
        {footer({ buildMealsBody, totalFee })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 학생 API에 addedBy/updatedAt 추가**

`src/app/api/applications/[id]/route.ts`의 `myRegistrationResult` 객체에 두 필드 추가:

```ts
  let myRegistrationResult = null;
  if (myRegistration) {
    myRegistrationResult = {
      status: myRegistration.status,
      addedBy: myRegistration.addedBy,
      updatedAt: myRegistration.updatedAt,
      meals: myRegistration.meals.map((rm) => {
```

(이하 기존 코드 동일)

- [ ] **Step 3: StudentApplicationView 전체 교체**

`src/components/meal/StudentApplicationView.tsx` 전체를 아래로 교체 (폼 로직은 ApplicationApplyForm으로 이동, fetch·서명·제출·대리 신청 안내만 남김):

```tsx
"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/SignaturePad";
import {
  ApplicationApplyForm,
  type ApplyFormMeal,
  type InitialRegistrationMeal,
  type RegistrationMealBody,
} from "./ApplicationApplyForm";
import { studentNumberOf } from "@/lib/meal-plan";
import { formatDateTimeKST } from "@/lib/timezone";
import { useUser } from "@/hooks/useUser";

interface ApplicationDetail {
  id: number;
  title: string;
  description: string | null;
  startYear: number;
  startMonth: number;
  monthCount: number;
  applyStartAt: string;
  applyEndAt: string;
  status: string;
  meals: ApplyFormMeal[];
}

interface MyRegistration {
  status: string;
  addedBy: string | null;
  updatedAt: string;
  meals: InitialRegistrationMeal[];
}

interface StudentApplicationViewProps {
  applicationId: number;
  onBack: () => void;
  onSubmitted: () => void;
}

function formatApplyDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}시${min}분`;
}

export function StudentApplicationView({
  applicationId,
  onBack,
  onSubmitted,
}: StudentApplicationViewProps) {
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [myReg, setMyReg] = useState<MyRegistration | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/applications/${applicationId}`);
        if (!res.ok) {
          toast.error("공고를 불러오지 못했습니다.");
          onBack();
          return;
        }
        const json = await res.json();
        setApplication(json.application);
        setRegistrationCount(json.registrationCount ?? 0);
        setMyReg(json.myRegistration ?? null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [applicationId, onBack]);

  const hasExisting = myReg?.status === "APPROVED";

  const handleCancel = async () => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("신청이 취소되었습니다.");
        onSubmitted();
        onBack();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "취소에 실패했습니다.");
      }
    } catch {
      toast.error("취소 중 오류가 발생했습니다.");
    }
  };

  const handleSubmit = async (mealsBody: RegistrationMealBody[]) => {
    if (!signature) {
      toast.error("서명을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, meals: mealsBody }),
      });

      if (res.ok) {
        toast.success(
          hasExisting ? "신청이 수정되었습니다." : "신청이 완료되었습니다.",
        );
        onSubmitted();
        onBack();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "신청에 실패했습니다.");
      }
    } catch {
      toast.error("신청 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !application) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-sm">불러오는 중...</p>
      </div>
    );
  }

  const now = new Date();
  const isApplyOpen =
    application.status === "OPEN" &&
    now >= new Date(application.applyStartAt) &&
    now <= new Date(application.applyEndAt);

  const studentNumber =
    user?.grade && user?.classNum && user?.number
      ? studentNumberOf(user.grade, user.classNum, user.number)
      : null;

  return (
    <div className="space-y-3">
      {/* 뒤로가기 버튼 */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm min-h-11"
      >
        <ChevronLeft className="size-4" />
        <span>목록으로</span>
      </button>

      {/* 상단 정보 표 */}
      <div className="card-elevated rounded-2xl border-0 p-4 space-y-3">
        <h2 className="font-bold text-base whitespace-nowrap overflow-hidden text-ellipsis" title={application.title}>{application.title}</h2>
        {application.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {application.description}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap w-24">신청 기간</td>
                <td className="py-2 font-medium whitespace-nowrap">
                  {formatApplyDateTime(application.applyStartAt)} ~ {formatApplyDateTime(application.applyEndAt)}
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">신청 인원</td>
                <td className="py-2 font-medium whitespace-nowrap">{registrationCount}명</td>
              </tr>
              {user && (
                <>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">이름</td>
                    <td className="py-2 font-medium whitespace-nowrap">{user.name}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">학번</td>
                    <td className="py-2 font-medium whitespace-nowrap">
                      {studentNumber != null ? studentNumber : `${user.grade}학년 ${user.classNum}반 ${user.number}번`}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        {hasExisting && myReg?.addedBy === "ADMIN" && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            이 신청은 관리자가 대리 신청했습니다 ({formatDateTimeKST(new Date(myReg.updatedAt))})
          </div>
        )}
        {!isApplyOpen && (
          <p className="text-sm text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
            {application.status !== "OPEN"
              ? "마감된 공고입니다."
              : "신청 기간이 아닙니다."}
          </p>
        )}
      </div>

      {/* 식사별 신청 폼 (공용 컴포넌트) */}
      <ApplicationApplyForm
        key={applicationId}
        application={application}
        initialMeals={myReg?.meals}
        disabled={!isApplyOpen}
        footer={({ buildMealsBody }) =>
          isApplyOpen ? (
            <>
              <div>
                <p className="text-sm font-medium mb-2">서명</p>
                <SignaturePad onSignatureChange={setSignature} />
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  className="rounded-lg min-h-11 whitespace-nowrap"
                  onClick={onBack}
                >
                  목록으로
                </Button>
                {hasExisting && (
                  <Button
                    variant="outline"
                    className="rounded-lg min-h-11 whitespace-nowrap text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={handleCancel}
                  >
                    신청 취소
                  </Button>
                )}
                <Button
                  className="rounded-lg min-h-11 whitespace-nowrap"
                  disabled={!signature || submitting}
                  onClick={() => handleSubmit(buildMealsBody())}
                >
                  {submitting ? "처리 중..." : hasExisting ? "신청 수정" : "신청하기"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="outline"
                className="rounded-lg min-h-11 whitespace-nowrap"
                onClick={onBack}
              >
                목록으로
              </Button>
            </div>
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: 타입체크 + 테스트**

Run: `npx tsc --noEmit; npm test`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/meal/ApplicationApplyForm.tsx src/components/meal/StudentApplicationView.tsx "src/app/api/applications/[id]/route.ts"
git commit -m "refactor(meal): 신청 폼을 ApplicationApplyForm으로 추출, 관리자 대리 신청 학생 안내 추가"
```

---

### Task 6: AdminApplyDialog + ApplicationStats 통합

**Files:**
- Create: `src/components/meal/AdminApplyDialog.tsx`
- Modify: `src/components/meal/ApplicationStats.tsx` (AddDialog 제거, 행 클릭, 배지)

- [ ] **Step 1: AdminApplyDialog 작성**

`src/components/meal/AdminApplyDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApplicationApplyForm,
  type ApplyFormApplication,
  type InitialRegistrationMeal,
  type RegistrationMealBody,
} from "./ApplicationApplyForm";
import type { MealKind, MealApplyMethod } from "@/lib/meal-plan";
import { formatDateTimeKST } from "@/lib/timezone";
import { fetcher } from "@/lib/fetcher";

interface TargetUser {
  id: number;
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
}

export type AdminApplyMode =
  | { type: "add" }
  | { type: "edit"; registrationId: number; user: TargetUser };

interface AppDetailResponse {
  application: {
    startYear: number;
    startMonth: number;
    monthCount: number;
    meals: {
      mealKind: MealKind;
      price: number;
      exemptionSelectable: boolean;
      method: MealApplyMethod;
      dates: { grade: number; date: string }[];
    }[];
  };
}

interface RegDetailResponse {
  registration: {
    id: number;
    updatedAt: string;
    addedBy: string | null;
    meals: InitialRegistrationMeal[];
  };
}

interface AdminApplyDialogProps {
  applicationId: number;
  mode: AdminApplyMode | null; // null = 닫힘
  existingUserIds: Set<number>;
  onClose: () => void;
  onSaved: () => void;
}

export function AdminApplyDialog({
  applicationId,
  mode,
  existingUserIds,
  onClose,
  onSaved,
}: AdminApplyDialogProps) {
  const [pickedUser, setPickedUser] = useState<TargetUser | null>(null);
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");
  const [saving, setSaving] = useState(false);

  const open = mode !== null;
  const isEdit = mode?.type === "edit";
  const targetUser = isEdit ? mode.user : pickedUser;

  const { data: appData } = useSWR<AppDetailResponse>(
    open ? `/api/admin/applications/${applicationId}` : null,
    fetcher,
  );

  const { data: usersData } = useSWR<{ users: TargetUser[] }>(
    open && mode?.type === "add" ? `/api/admin/users?role=STUDENT` : null,
    fetcher,
  );

  const { data: regData } = useSWR<RegDetailResponse>(
    open && isEdit
      ? `/api/admin/applications/${applicationId}/registrations/${mode.registrationId}`
      : null,
    fetcher,
  );

  function reset() {
    setPickedUser(null);
    setFilterGrade("all");
    setFilterClass("all");
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      onClose();
    }
  }

  // 대상 학생 학년 기준 폼 데이터 구성
  let formApplication: ApplyFormApplication | null = null;
  if (appData?.application && targetUser?.grade != null) {
    const grade = targetUser.grade;
    formApplication = {
      startYear: appData.application.startYear,
      startMonth: appData.application.startMonth,
      monthCount: appData.application.monthCount,
      meals: appData.application.meals
        .filter((m) => m.method !== "NONE")
        .map((m) => ({
          mealKind: m.mealKind,
          price: m.price,
          exemptionSelectable: m.exemptionSelectable,
          method: m.method,
          openDates: m.dates.filter((d) => d.grade === grade).map((d) => d.date),
        })),
    };
  }

  const initialMeals = isEdit ? regData?.registration.meals : undefined;
  const formReady = formApplication !== null && (!isEdit || initialMeals !== undefined);
  const showPicker = mode?.type === "add" && pickedUser === null;

  async function handleSubmit(mealsBody: RegistrationMealBody[]) {
    if (!targetUser) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUser.id, meals: mealsBody }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "등록에 실패했습니다.");
        return;
      }
      toast.success(isEdit ? "신청이 수정되었습니다." : "신청이 등록되었습니다.");
      reset();
      onClose();
      onSaved();
    } catch {
      toast.error("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // ── 학생 선택 단계 (add 모드) ──
  const allStudents = usersData?.users ?? [];
  const gradeOptions = [...new Set(allStudents.map((u) => u.grade).filter((g): g is number => g != null))].sort();
  const classOptions = filterGrade === "all"
    ? []
    : [...new Set(allStudents.filter((u) => u.grade === Number(filterGrade)).map((u) => u.classNum).filter((c): c is number => c != null))].sort();
  const filteredStudents = allStudents.filter((u) => {
    if (filterGrade !== "all" && u.grade !== Number(filterGrade)) return false;
    if (filterClass !== "all" && u.classNum !== Number(filterClass)) return false;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="whitespace-nowrap overflow-hidden text-ellipsis">
            {showPicker
              ? "신청 추가 — 학생 선택"
              : `${targetUser?.name ?? ""} 대리 신청`}
          </DialogTitle>
        </DialogHeader>

        {showPicker ? (
          <div className="space-y-3">
            {/* 학년/반 필터 */}
            <div className="flex gap-2">
              <Select value={filterGrade} onValueChange={(v) => { setFilterGrade(v ?? "all"); setFilterClass("all"); }}>
                <SelectTrigger className="w-24">
                  <SelectValue placeholder="학년">{(v: string) => (v === "all" ? "전체" : `${v}학년`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {gradeOptions.map((g) => (
                    <SelectItem key={g} value={String(g)}>{g}학년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filterGrade !== "all" && (
                <Select value={filterClass} onValueChange={(v) => setFilterClass(v ?? "all")}>
                  <SelectTrigger className="w-20">
                    <SelectValue placeholder="반">{(v: string) => (v === "all" ? "전체" : `${v}반`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    {classOptions.map((c) => (
                      <SelectItem key={c} value={String(c)}>{c}반</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 학생 목록 */}
            <div className="border rounded-xl overflow-y-auto max-h-64">
              {filteredStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">학생 없음</p>
              ) : (
                <ul>
                  {filteredStudents.map((u) => {
                    const alreadyRegistered = existingUserIds.has(u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => !alreadyRegistered && setPickedUser(u)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors min-h-11 ${
                            alreadyRegistered ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                          }`}
                          disabled={alreadyRegistered}
                        >
                          <span className="text-muted-foreground min-w-12 whitespace-nowrap">
                            {u.grade}{u.classNum?.toString().padStart(2, "0")}{u.number?.toString().padStart(2, "0")}
                          </span>
                          <span className="whitespace-nowrap">{u.name}</span>
                          {alreadyRegistered && (
                            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">이미 신청 — 명단에서 행을 클릭해 수정</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : !formReady ? (
          <p className="text-sm text-muted-foreground py-8 text-center">불러오는 중...</p>
        ) : (
          <ApplicationApplyForm
            key={`${applicationId}:${targetUser!.id}`}
            application={formApplication!}
            initialMeals={initialMeals}
            footer={({ buildMealsBody }) => (
              <>
                {/* 서명 대신 관리자 대리 신청 안내 */}
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 space-y-0.5">
                  <p className="font-medium whitespace-nowrap">관리자 대리 신청으로 등록됩니다.</p>
                  {isEdit && regData && (
                    <p className="whitespace-nowrap">
                      신청 시각: {formatDateTimeKST(new Date(regData.registration.updatedAt))}
                      {regData.registration.addedBy === "ADMIN" && " (관리자 등록)"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    className="rounded-lg min-h-11 whitespace-nowrap"
                    onClick={() => handleOpenChange(false)}
                  >
                    취소
                  </Button>
                  <Button
                    className="rounded-lg min-h-11 whitespace-nowrap"
                    disabled={saving}
                    onClick={() => handleSubmit(buildMealsBody())}
                  >
                    {saving ? "처리 중..." : isEdit ? "신청 수정" : "신청 등록"}
                  </Button>
                </div>
              </>
            )}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: ApplicationStats에서 AddDialog 제거 및 통합**

`src/components/meal/ApplicationStats.tsx` 수정:

2-1. **import 정리** — `AddDialog` 전용이던 import 제거/추가:

```tsx
// 제거: Label, Dialog 관련 import (Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter)
// 제거: MEAL_LABEL, METHOD_LABEL (AddDialog에서만 사용 — MEAL_SHORT는 유지)
// 추가:
import { AdminApplyDialog, type AdminApplyMode } from "./AdminApplyDialog";
```

> 주의: 제거 전에 해당 식별자가 본문 다른 곳에서 쓰이지 않는지 확인. `MEAL_LABEL`은 하단 합계 표에서 사용 중이므로 **유지**. 실제 제거 대상은 `Label`, Dialog 계열, `METHOD_LABEL`.

2-2. **`AddDialog` 함수와 `AddDialogProps`, `AppDetail`, `AdminUser` 인터페이스 전체 삭제** (125~410행 영역).

2-3. **메인 컴포넌트에 모달 상태 추가** (`fileInputRef` 선언 근처):

```tsx
  const [dialogMode, setDialogMode] = useState<AdminApplyMode | null>(null);
```

2-4. **`<AddDialog ... />` 사용처를 버튼으로 교체** (상단 액션 영역):

```tsx
              <Button
                variant="default"
                size="sm"
                className="min-h-11 whitespace-nowrap"
                onClick={() => setDialogMode({ type: "add" })}
              >
                신청 추가
              </Button>
```

2-5. **본문 표의 행을 클릭 가능하게** — `filtered.map((reg, idx) => {` 내부 `<tr>`을 수정:

```tsx
                      <tr
                        key={reg.id}
                        onClick={() =>
                          setDialogMode({ type: "edit", registrationId: reg.id, user: reg.user })
                        }
                        className={`border-b last:border-0 cursor-pointer ${rowCls}`}
                      >
```

2-6. **관리 셀 버튼에 전파 차단** — `handleStatusToggle`/`handleDelete` 버튼의 onClick 수정:

```tsx
                              onClick={(e) => { e.stopPropagation(); handleStatusToggle(reg); }}
```

```tsx
                              onClick={(e) => { e.stopPropagation(); handleDelete(reg); }}
```

2-7. **이름 셀에 관리자 배지** — 이름 `<td>` 내용 수정:

```tsx
                        <td className={`sticky left-0 z-30 px-2 py-1.5 whitespace-nowrap font-medium ${isCancelled ? "bg-muted/40" : "bg-background"}`}>
                          {reg.user.name}
                          {reg.addedBy === "ADMIN" && (
                            <span className="ml-1 inline-flex items-center px-1 py-0 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium whitespace-nowrap">관리자</span>
                          )}
                        </td>
```

2-8. **모달 렌더링** — 컴포넌트 return의 최상위 `<div className="h-dvh ...">` 닫는 태그 직전에 추가:

```tsx
      <AdminApplyDialog
        applicationId={applicationId}
        mode={dialogMode}
        existingUserIds={existingUserIds}
        onClose={() => setDialogMode(null)}
        onSaved={() => mutate()}
      />
```

- [ ] **Step 3: 타입체크 + 테스트 + 빌드**

Run: `npx tsc --noEmit; npm test`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/meal/AdminApplyDialog.tsx src/components/meal/ApplicationStats.tsx
git commit -m "feat(admin): 학생 신청 화면과 동일한 관리자 대리 신청 모달 (행 클릭 수정 + 신청 추가)"
```

---

### Task 7: 최종 검증 + 배포 (test → main 동시 반영)

**Files:** 없음 (검증·배포·문서)

- [ ] **Step 1: 전체 테스트 + 프로덕션 빌드**

Run: `npm test; npm run build`
Expected: 테스트 전체 PASS, 빌드 성공

- [ ] **Step 2: responsive-ui-reviewer 에이전트 실행**

변경된 UI 파일(`ApplicationApplyForm.tsx`, `AdminApplyDialog.tsx`, `StudentApplicationView.tsx`, `ApplicationStats.tsx`)에 대해 `responsive-ui-reviewer` 에이전트로 반응형 규칙 점검. 위반 발견 시 수정 후 `fix(ui)` 커밋.

- [ ] **Step 3: project-map-updater 에이전트 실행**

신규 파일 3개(컴포넌트 2, lib 1)와 API 변경(GET 추가, import/export 개편)을 PROJECT_MAP.md에 반영. `docs(project-map)` 커밋.

- [ ] **Step 4: test 브랜치 push 및 검증**

```bash
git push origin feat/posanmeal-mvp
```

`https://posanmeal.up.railway.app` 배포 후 수동 검증 (스펙 §6):
1. stats 페이지 명단 행 클릭 → 모달에서 기존 신청 내용(날짜/요일) 표시 확인, 수정 저장
2. 신청 추가 → 학생 선택 → DATE/WEEKDAY 날짜 선택 신규 등록
3. 양식 다운로드 → 날짜/요일 컬럼·프리필 확인 → O 수정 → 업로드 → 결과 메시지·명단 반영 확인
4. 학생 계정으로 해당 공고 진입 → "관리자가 대리 신청했습니다" 안내 확인
5. 학생 본인 신청/수정 플로우 회귀 확인

- [ ] **Step 5: main 머지 및 push (prod 반영)**

```bash
git checkout main
git pull origin main
git merge feat/posanmeal-mvp
git push origin main
git checkout feat/posanmeal-mvp
```

`https://meal.posan.kr` 반영 확인.

---

## Self-Review 결과

- **스펙 커버리지**: §3.1→Task 5, §3.2→Task 6, §3.3→Task 6(배지), §3.4→Task 5, §3.5→Task 1, §3.6→Task 2, §3.7→Task 3, §5 에러 처리→Task 3(헤더 인식 불가 400)·Task 6(로딩/실패 토스트), §6 테스트→Task 1(단위)·Task 7(수동). 누락 없음.
- **타입 일관성**: `TemplateColumn`/`columnHeader`/`parseColumnHeader`(Task 1↔2↔3), `ApplyFormApplication`/`InitialRegistrationMeal`/`RegistrationMealBody`(Task 5↔6), GET 응답 `registration.meals` 형태(Task 4)와 `InitialRegistrationMeal`(Task 5) 일치 확인.
- **플레이스홀더**: 없음 — 모든 코드 블록 완성형.
