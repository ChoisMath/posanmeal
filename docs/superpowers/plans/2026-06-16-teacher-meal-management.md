# 담임교사 학생관리·신청현황 개편 + 사진 Volume 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담임교사 페이지의 "학생관리" 탭을 조/중/석 식사별 표(신청 음영 포함)로 재구성하고, "신청현황" 탭을 추가하며, 프로필 사진을 Railway Volume에 저장하도록 수정한다.

**Architecture:** 기존 관리자 `AdminMealTable`·`ApplicationStats` 패턴을 담임용으로 이식한다. 신청 확정일은 `MealRegistrationMealDate`(APPROVED) 단일 진실로 음영·컬럼을 만들고, 사진은 `process.env.UPLOAD_DIR`(볼륨) + `/api/uploads/[filename]` 스트리밍으로 영속화한다. 스키마 변경/마이그레이션 없음.

**Tech Stack:** Next.js 16 App Router(Route Handlers), Prisma 7, React 19, Tailwind v4, SWR, base-ui Dialog.

**Spec:** `docs/superpowers/specs/2026-06-16-teacher-meal-management-design.md`

**검증 방침:** 이 저장소는 vitest 테스트가 `src/lib/` 순수 함수에만 존재한다(라우트·컴포넌트 테스트 인프라 없음). 본 작업은 신규 순수 함수를 만들지 않으므로(컬럼 생성은 기존 `buildMonthlyMealColumns` 재사용), 각 태스크는 `npx tsc --noEmit` 타입체크 + `npm run build` + 수동 검증으로 확인한다. 기존 관행을 따른다.

---

## File Structure

| 파일 | 책임 | 작업 |
|------|------|------|
| `src/app/api/users/me/photo/route.ts` | 사진 업로드/삭제 → 볼륨 저장 | 수정 |
| `src/app/api/uploads/[filename]/route.ts` | 볼륨에서 사진 스트리밍 서빙 | 수정 |
| `src/app/api/teacher/students/route.ts` | 담임 학급 학생 + mealColumns + appliedDates | 수정 |
| `src/hooks/useTeacherStudents.ts` | 위 API SWR 훅 (타입) | 수정 |
| `src/components/StudentTable.tsx` | 담임 학생관리 표 (읽기전용·식사컬럼·음영) | 재작성 |
| `src/app/api/teacher/applications/route.ts` | 전체 공고 목록 (담임용) | 신규 |
| `src/app/api/teacher/applications/[id]/registrations/route.ts` | 공고별 우리 반 APPROVED 신청자 | 신규 |
| `src/components/TeacherApplications.tsx` | 신청현황 탭 (목록↔상세, 서명) | 신규 |
| `src/app/teacher/page.tsx` | 신청현황 탭 추가 | 수정 |

---

### Task 1: 프로필 사진 Volume 저장

**Files:**
- Modify: `src/app/api/users/me/photo/route.ts`
- Modify: `src/app/api/uploads/[filename]/route.ts`

- [ ] **Step 1: 사진 업로드 라우트를 볼륨 경로로 변경**

`src/app/api/users/me/photo/route.ts` 전체를 아래로 교체:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || "5")) * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `파일 크기는 ${process.env.MAX_FILE_SIZE_MB || 5}MB 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const resized = await sharp(buffer)
    .resize(300, 300, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${session.user.dbUserId}.webp`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await writeFile(filepath, resized);

  const photoUrl = `/api/uploads/${filename}?t=${Date.now()}`;
  await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: { photoUrl },
  });

  return NextResponse.json({ photoUrl });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filename = `${session.user.dbUserId}.webp`;
  const filepath = path.join(UPLOAD_DIR, filename);

  await Promise.all([
    unlink(filepath).catch(() => {}),
    prisma.user.update({
      where: { id: session.user.dbUserId },
      data: { photoUrl: null },
    }),
  ]);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 사진 서빙 라우트를 볼륨 스트리밍으로 변경**

`src/app/api/uploads/[filename]/route.ts` 전체를 아래로 교체:

```ts
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
const SAFE_UPLOAD_NAME = /^[A-Za-z0-9._-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safeName = path.basename(filename);

  if (safeName !== filename || !SAFE_UPLOAD_NAME.test(safeName)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  try {
    const data = await readFile(path.join(UPLOAD_DIR, safeName));
    const contentType =
      CONTENT_TYPES[path.extname(safeName).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    // 볼륨에 없으면 구 정적 경로로 폴백 (구 photoUrl 호환)
    return NextResponse.redirect(new URL(`/uploads/${safeName}`, request.url));
  }
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 신규 에러 없음 (PASS)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/users/me/photo/route.ts src/app/api/uploads/[filename]/route.ts
git commit -m "fix(uploads): 프로필 사진을 Railway Volume에 저장·스트리밍 서빙"
```

> **배포 메모(코드 아님):** Railway test·prod 서비스 모두 `UPLOAD_DIR` 환경변수 값과 동일 경로에 Volume이 마운트돼 있어야 한다. 실행 단계에서 `railway-deploy-advisor` 에이전트로 검수. 구 photoUrl(`/uploads/...`)은 정적 서빙으로 폴백되어 즉시 깨지지 않는다.

---

### Task 2: 담임 학생 API — mealColumns + appliedDates

**Files:**
- Modify: `src/app/api/teacher/students/route.ts`

- [ ] **Step 1: 라우트 전체 교체**

`src/app/api/teacher/students/route.ts` 전체를 아래로 교체:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildMonthDateRange } from "@/lib/date-range";
import { buildMonthlyMealColumns, getDateDayKey, type MealKind } from "@/lib/meal-columns";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });

  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const { startDate, endDate } = buildMonthDateRange(year, month);

  const [students, appliedRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: "STUDENT", grade, classNum },
      select: {
        id: true, name: true, number: true, photoUrl: true,
        checkIns: {
          where: { date: { gte: startDate, lte: endDate } },
          select: { date: true, checkedAt: true, type: true, mealKind: true },
          orderBy: [{ date: "asc" }, { mealKind: "asc" }],
        },
      },
      orderBy: { number: "asc" },
    }),
    prisma.mealRegistrationMealDate.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        registration: {
          status: "APPROVED",
          user: { role: "STUDENT", grade, classNum },
        },
      },
      select: {
        date: true,
        mealKind: true,
        registration: { select: { userId: true } },
      },
    }),
  ]);

  const appliedByUser = new Map<number, { date: string; mealKind: MealKind }[]>();
  for (const row of appliedRows) {
    const userId = row.registration.userId;
    const list = appliedByUser.get(userId) ?? [];
    list.push({ date: getDateDayKey(row.date), mealKind: row.mealKind });
    appliedByUser.set(userId, list);
  }

  const mealColumns = buildMonthlyMealColumns(year, month, {
    BREAKFAST: appliedRows.filter((r) => r.mealKind === "BREAKFAST").map((r) => r.date),
    LUNCH: appliedRows.filter((r) => r.mealKind === "LUNCH").map((r) => r.date),
  });

  const studentsOut = students.map((s) => ({
    id: s.id,
    name: s.name,
    number: s.number,
    photoUrl: s.photoUrl,
    checkIns: s.checkIns,
    appliedDates: appliedByUser.get(s.id) ?? [],
  }));

  return NextResponse.json({ students: studentsOut, grade, classNum, mealColumns });
}
```

> 근거: `MealRegistrationMealDate` 행은 `applied=true` 식사에 대해서만 생성되고 CANCELLED는 행이 보존되므로 `registration.status="APPROVED"` 필터만으로 "신청 확정"을 의미한다(관리자 `/api/admin/checkins` 와 동일 규칙).

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 신규 에러 없음 (PASS) — `useTeacherStudents`/`StudentTable` 타입 에러는 Task 3에서 해소되므로, 이 단계에서는 이 라우트 파일 자체에 에러가 없는지만 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/teacher/students/route.ts
git commit -m "feat(teacher): 학생 API에 식사 컬럼·신청 확정일(appliedDates) 추가"
```

---

### Task 3: StudentTable 재작성 + 훅 타입

**Files:**
- Modify: `src/hooks/useTeacherStudents.ts`
- Modify: `src/components/StudentTable.tsx`

- [ ] **Step 1: 훅 타입 갱신**

`src/hooks/useTeacherStudents.ts` 전체를 아래로 교체:

```ts
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { MealColumn, MealKind } from "@/lib/meal-columns";

interface Student {
  id: number;
  name: string;
  number: number;
  photoUrl: string | null;
  checkIns: { date: string; checkedAt: string; type: string; mealKind: MealKind | null }[];
  appliedDates: { date: string; mealKind: MealKind }[];
}

export function useTeacherStudents(year: number, month: number) {
  const { data, error, isLoading } = useSWR(
    `/api/teacher/students?year=${year}&month=${month}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    students: (data?.students ?? []) as Student[],
    mealColumns: (data?.mealColumns ?? []) as MealColumn[],
    grade: data?.grade as number | undefined,
    classNum: data?.classNum as number | undefined,
    error,
    isLoading,
  };
}
```

- [ ] **Step 2: StudentTable 재작성 (읽기전용·식사컬럼·음영)**

`src/components/StudentTable.tsx` 전체를 아래로 교체:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTeacherStudents } from "@/hooks/useTeacherStudents";
import { buildMonthlyMealColumns, getDateDayKey, type MealColumn } from "@/lib/meal-columns";

export function StudentTable() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { students, mealColumns: fetchedColumns, grade = 0, classNum = 0, error } =
    useTeacherStudents(year, month);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const mealColumns: MealColumn[] =
    fetchedColumns.length > 0 ? fetchedColumns : buildMonthlyMealColumns(year, month);

  const weekendSet = useMemo(() => {
    const set = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) set.add(d);
    }
    return set;
  }, [year, month, daysInMonth]);
  const isWeekend = (day: number) => weekendSet.has(day);

  const dailyTotals = useMemo(
    () =>
      mealColumns.map((col) =>
        students.filter((s) =>
          s.checkIns.some((c) => `${getDateDayKey(c.date)}:${c.mealKind ?? "DINNER"}` === col.key),
        ).length,
      ),
    [students, mealColumns],
  );
  const grandTotal = useMemo(
    () => students.reduce((sum, s) => sum + s.checkIns.length, 0),
    [students],
  );

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground text-sm mb-2">데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-fit-base">
          {grade}학년 {classNum}반 — {year}년 {month}월
        </h3>
        <Button variant="ghost" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-auto max-h-[70vh] border rounded-lg">
        <table className="text-xs border-collapse w-full whitespace-nowrap">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r min-w-[90px] text-fit-sm">
                번호 이름
              </th>
              {mealColumns.map((column) => {
                const weekend = isWeekend(column.day);
                const mealHeaderClass =
                  column.mealKind === "BREAKFAST"
                    ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                    : column.mealKind === "LUNCH"
                      ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : "bg-muted text-muted-foreground";
                return (
                  <th
                    key={column.key}
                    className={`px-1 py-2 text-center font-medium border-b min-w-[28px] ${
                      weekend
                        ? "bg-red-50 text-red-400 dark:bg-red-950 dark:text-red-400"
                        : mealHeaderClass
                    }`}
                    title={column.label}
                  >
                    <span>{column.day}</span>
                    <span className="block text-[10px] leading-none opacity-70">{column.shortLabel}</span>
                  </th>
                );
              })}
              <th className="sticky right-0 z-30 bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b border-l min-w-[44px] text-fit-sm">
                합계
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const checkInMap = new Map(
                student.checkIns.map((c) => [`${getDateDayKey(c.date)}:${c.mealKind ?? "DINNER"}`, c]),
              );
              const appliedSet = new Set(student.appliedDates.map((a) => `${a.date}:${a.mealKind}`));
              return (
                <tr key={student.id} className="hover:bg-muted/50">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <div className="flex items-center gap-1 text-fit-sm">
                      <span className="font-semibold">{student.number}</span>
                      <span>{student.name}</span>
                    </div>
                  </td>
                  {mealColumns.map((column) => {
                    const checkIn = checkInMap.get(column.key);
                    const applied = appliedSet.has(column.key);
                    const cellClass = checkIn
                      ? column.mealKind === "BREAKFAST"
                        ? "bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 font-bold"
                        : column.mealKind === "LUNCH"
                          ? "bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 font-bold"
                          : "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 font-bold"
                      : applied
                        ? "bg-background"
                        : "bg-muted/60";
                    return (
                      <td
                        key={column.key}
                        className={`text-center border-b px-0.5 py-1.5 ${cellClass}`}
                        title={
                          checkIn
                            ? `${column.label} ${new Date(checkIn.checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                            : applied
                              ? `${column.label} 신청`
                              : `${column.label} 미신청`
                        }
                      >
                        {checkIn ? "O" : ""}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-background text-center border-b border-l px-2 py-1.5 font-medium">
                    {student.checkIns.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td className="sticky left-0 z-30 bg-muted px-2 py-1.5 border-t border-r font-bold text-fit-sm">합계</td>
              {dailyTotals.map((count, i) => (
                <td
                  key={mealColumns[i]?.key ?? i}
                  className={`text-center border-t px-0.5 py-1.5 font-bold bg-muted ${count > 0 ? "" : "opacity-30"}`}
                >
                  {count || ""}
                </td>
              ))}
              <td className="sticky right-0 z-30 bg-muted text-center border-t border-l px-2 py-1.5 font-bold">
                {grandTotal}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

> 음영 규칙: 체크인 있음 → 식사색 + "O" / 신청함·체크인 없음 → 흰색(`bg-background`) / 미신청 → 회색(`bg-muted/60`). 주말은 헤더에만 적색 틴트.

- [ ] **Step 3: 타입체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (PASS)

- [ ] **Step 4: 커밋**

```bash
git add src/hooks/useTeacherStudents.ts src/components/StudentTable.tsx
git commit -m "feat(teacher): 학생관리 표를 식사별 컬럼+신청 음영으로 재구성 (읽기전용)"
```

---

### Task 4: 담임 공고 목록 API

**Files:**
- Create: `src/app/api/teacher/applications/route.ts`

- [ ] **Step 1: 라우트 생성**

`src/app/api/teacher/applications/route.ts` 신규 작성:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });
  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const applications = await prisma.mealApplication.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      startYear: true,
      startMonth: true,
      monthCount: true,
      applyStartAt: true,
      applyEndAt: true,
      meals: { select: { mealKind: true, method: true } },
    },
  });

  return NextResponse.json({ applications });
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (PASS)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/teacher/applications/route.ts
git commit -m "feat(teacher): 담임용 전체 공고 목록 API"
```

---

### Task 5: 담임 공고별 우리 반 신청자 API

**Files:**
- Create: `src/app/api/teacher/applications/[id]/registrations/route.ts`

- [ ] **Step 1: 라우트 생성**

`src/app/api/teacher/applications/[id]/registrations/route.ts` 신규 작성:

```ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });
  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { id } = await params;
  const applicationId = parseInt(id, 10);
  if (Number.isNaN(applicationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      title: true,
      meals: { select: { mealKind: true, method: true, exemptionSelectable: true } },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const registrationRows = await prisma.mealRegistration.findMany({
    where: {
      applicationId,
      status: "APPROVED",
      user: { role: "STUDENT", grade, classNum },
    },
    select: {
      id: true,
      createdAt: true,
      addedBy: true,
      signature: true,
      user: { select: { number: true, name: true } },
      meals: { select: { mealKind: true, applied: true, exempt: true } },
    },
    orderBy: { user: { number: "asc" } },
  });

  const regIds = registrationRows.map((r) => r.id);
  const dayCounts =
    regIds.length > 0
      ? await prisma.mealRegistrationMealDate.groupBy({
          by: ["registrationId", "mealKind"],
          where: { registrationId: { in: regIds } },
          _count: { date: true },
        })
      : [];
  const dayCountMap = new Map<string, number>();
  for (const row of dayCounts) {
    dayCountMap.set(`${row.registrationId}:${row.mealKind}`, row._count.date);
  }

  const registrations = registrationRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    addedBy: r.addedBy,
    signature: r.signature,
    user: r.user,
    meals: r.meals.map((m) => ({
      mealKind: m.mealKind,
      applied: m.applied,
      exempt: m.exempt,
      dayCount: dayCountMap.get(`${r.id}:${m.mealKind}`) ?? 0,
    })),
  }));

  return NextResponse.json({ application, registrations });
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (PASS)

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/teacher/applications/[id]/registrations/route.ts"
git commit -m "feat(teacher): 공고별 우리 반 승인 신청자(서명 포함) API"
```

---

### Task 6: TeacherApplications 컴포넌트 (신청현황 탭)

**Files:**
- Create: `src/components/TeacherApplications.tsx`

- [ ] **Step 1: 컴포넌트 생성**

`src/components/TeacherApplications.tsx` 신규 작성:

```tsx
"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MEAL_SHORT, type MealKind } from "@/lib/meal-plan";
import { MEAL_THEME } from "@/components/meal/meal-ui";
import { formatDateTimeKST } from "@/lib/timezone";

interface AppMeal {
  mealKind: MealKind;
  method: string;
}
interface AppListItem {
  id: number;
  title: string;
  status: string;
  startYear: number | null;
  startMonth: number | null;
  monthCount: number | null;
  applyStartAt: string | null;
  applyEndAt: string | null;
  meals: AppMeal[];
}

interface RegMeal {
  mealKind: MealKind;
  applied: boolean;
  exempt: boolean;
  dayCount: number;
}
interface Registration {
  id: number;
  createdAt: string;
  addedBy: string | null;
  signature: string;
  user: { number: number | null; name: string };
  meals: RegMeal[];
}
interface DetailData {
  application: {
    id: number;
    title: string;
    meals: { mealKind: MealKind; method: string; exemptionSelectable: boolean }[];
  };
  registrations: Registration[];
}

function targetMonthLabel(app: AppListItem): string {
  if (app.startYear == null || app.startMonth == null) return "대상월 미설정";
  const count = app.monthCount ?? 1;
  if (count <= 1) return `${app.startYear}년 ${app.startMonth}월`;
  return `${app.startYear}년 ${app.startMonth}월부터 ${count}개월`;
}

function isImageSignature(sig: string): boolean {
  return sig.startsWith("data:image");
}

export function TeacherApplications() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  if (selectedId == null) {
    return <ApplicationList onSelect={setSelectedId} />;
  }
  return <ApplicationDetail applicationId={selectedId} onBack={() => setSelectedId(null)} />;
}

function ApplicationList({ onSelect }: { onSelect: (id: number) => void }) {
  const { data, error } = useSWR<{ applications: AppListItem[] }>(
    "/api/teacher/applications",
    fetcher,
    { revalidateOnFocus: false },
  );
  if (error) {
    return <p className="text-center text-muted-foreground py-8 text-sm">데이터를 불러올 수 없습니다.</p>;
  }
  const applications = data?.applications ?? [];
  if (applications.length === 0) {
    return <p className="text-center text-muted-foreground py-8 text-sm">공고가 없습니다.</p>;
  }
  return (
    <div className="space-y-2">
      {applications.map((app) => (
        <button
          key={app.id}
          onClick={() => onSelect(app.id)}
          className="w-full text-left card-elevated rounded-xl border-0 p-3 hover:bg-muted/40 transition-colors min-h-11"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate whitespace-nowrap">{app.title}</span>
            <Badge variant={app.status === "OPEN" ? "default" : "secondary"} className="shrink-0">
              {app.status === "OPEN" ? "진행중" : "마감"}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
            <span>{targetMonthLabel(app)}</span>
            <span className="flex gap-1">
              {app.meals
                .filter((m) => m.method !== "NONE")
                .map((m) => (
                  <span
                    key={m.mealKind}
                    className={`px-1 rounded ${MEAL_THEME[m.mealKind].cell} ${MEAL_THEME[m.mealKind].text}`}
                  >
                    {MEAL_SHORT[m.mealKind]}
                  </span>
                ))}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ApplicationDetail({
  applicationId,
  onBack,
}: {
  applicationId: number;
  onBack: () => void;
}) {
  const { data, error, isLoading } = useSWR<DetailData>(
    `/api/teacher/applications/${applicationId}/registrations`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [zoomSig, setZoomSig] = useState<string | null>(null);

  const application = data?.application;
  const registrations = data?.registrations ?? [];
  const activeMeals = application?.meals.filter((m) => m.method !== "NONE") ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="min-h-11 px-2">
          <ChevronLeft className="h-4 w-4 mr-1" /> 목록
        </Button>
        <h3 className="font-semibold text-sm truncate whitespace-nowrap">
          {application?.title ?? "신청 현황"}
        </h3>
      </div>

      {error ? (
        <p className="text-center text-muted-foreground py-8 text-sm">데이터를 불러올 수 없습니다.</p>
      ) : isLoading ? (
        <p className="text-center text-muted-foreground py-8 text-sm">불러오는 중...</p>
      ) : registrations.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">우리 반 신청자가 없습니다.</p>
      ) : (
        <div className="overflow-auto max-h-[70vh] border rounded-lg">
          <table className="text-xs border-collapse w-full whitespace-nowrap">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b border-r">
                  번호 이름
                </th>
                <th className="bg-muted px-2 py-2 text-left font-medium text-muted-foreground border-b">신청시간</th>
                {activeMeals.map((m) => (
                  <th
                    key={m.mealKind}
                    className={`px-2 py-2 text-center font-medium border-b ${MEAL_THEME[m.mealKind].head} ${MEAL_THEME[m.mealKind].text}`}
                  >
                    {MEAL_SHORT[m.mealKind]}
                  </th>
                ))}
                <th className="bg-muted px-2 py-2 text-center font-medium text-muted-foreground border-b">서명</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((reg) => (
                <tr key={reg.id} className="hover:bg-muted/50">
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-b border-r">
                    <span className="font-semibold">{reg.user.number}</span> <span>{reg.user.name}</span>
                    {reg.addedBy === "ADMIN" && (
                      <span className="ml-1 inline-flex items-center px-1 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                        관리자
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 border-b text-muted-foreground tabular-nums">
                    {formatDateTimeKST(new Date(reg.createdAt))}
                  </td>
                  {activeMeals.map((m) => {
                    const rm = reg.meals.find((x) => x.mealKind === m.mealKind);
                    const theme = MEAL_THEME[m.mealKind];
                    return (
                      <td key={m.mealKind} className={`px-2 py-1.5 text-center border-b ${theme.cell}`}>
                        {rm?.applied ? (rm.exempt ? "면제" : `${rm.dayCount}일`) : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center border-b">
                    {isImageSignature(reg.signature) ? (
                      <button type="button" onClick={() => setZoomSig(reg.signature)} className="inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={reg.signature} alt="서명" className="h-9 w-auto bg-white rounded border" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{reg.signature || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={zoomSig != null} onOpenChange={(open) => { if (!open) setZoomSig(null); }}>
        <DialogContent className="sm:max-w-md">
          {zoomSig && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={zoomSig} alt="서명 확대" className="w-full bg-white rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> 서명: `data:image` 로 시작하면 `<img>` 썸네일(클릭 시 확대), 아니면 텍스트(관리자 대리 등록의 `(관리자 등록)` 등). base-ui `Dialog` 는 `open`/`onOpenChange` 사용(기존 `AdminApplyDialog`·`admin/page.tsx` 패턴과 동일). 프로필 사진이 아닌 base64 인라인이라 `next/image` 대신 `<img>` 사용(lint 주석으로 명시).

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (PASS)

- [ ] **Step 3: 커밋**

```bash
git add src/components/TeacherApplications.tsx
git commit -m "feat(teacher): 신청현황 컴포넌트 (공고 목록↔우리 반 신청자·서명)"
```

---

### Task 7: 담임 페이지에 "신청현황" 탭 추가

**Files:**
- Modify: `src/app/teacher/page.tsx`

- [ ] **Step 1: import 추가**

`src/app/teacher/page.tsx` 의 `import { StudentTable } ...` 줄 아래에 추가:

```tsx
import { TeacherApplications } from "@/components/TeacherApplications";
```

- [ ] **Step 2: TabsList 컬럼 수 + 트리거 추가**

기존:

```tsx
          <TabsList className={`grid w-full max-w-md mx-auto rounded-xl h-11 ${isHomeroom ? "grid-cols-5" : "grid-cols-4"}`}>
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm">식단</TabsTrigger>
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm">QR</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm">학생관리</TabsTrigger>}
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm">개인정보</TabsTrigger>
          </TabsList>
```

교체:

```tsx
          <TabsList className={`grid w-full max-w-md mx-auto rounded-xl h-11 ${isHomeroom ? "grid-cols-6" : "grid-cols-4"}`}>
            <TabsTrigger value="meal" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">식단</TabsTrigger>
            <TabsTrigger value="qr" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">QR</TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">확인</TabsTrigger>
            {isHomeroom && <TabsTrigger value="students" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">학생관리</TabsTrigger>}
            {isHomeroom && <TabsTrigger value="applications" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">신청현황</TabsTrigger>}
            <TabsTrigger value="profile" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">개인정보</TabsTrigger>
          </TabsList>
```

- [ ] **Step 3: TabsContent 추가**

기존 학생관리 `TabsContent` 블록:

```tsx
          {isHomeroom && (
            <TabsContent value="students">
              <Card className="card-elevated rounded-2xl border-0">
                <CardContent className="pt-6"><StudentTable /></CardContent>
              </Card>
            </TabsContent>
          )}
```

바로 아래에 추가:

```tsx
          {isHomeroom && (
            <TabsContent value="applications">
              <Card className="card-elevated rounded-2xl border-0">
                <CardContent className="pt-6"><TeacherApplications /></CardContent>
              </Card>
            </TabsContent>
          )}
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 빌드 성공(PASS). NFT 경고(uploads readFile)는 무해, 무시.

- [ ] **Step 5: 커밋**

```bash
git add src/app/teacher/page.tsx
git commit -m "feat(teacher): 담임 신청현황 탭 추가 (6탭)"
```

---

### Task 8: 반응형 검수 + 수동 검증

**Files:** (없음 — 검수 단계)

- [ ] **Step 1: responsive-ui-reviewer 에이전트 실행**

변경된 UI 파일(`StudentTable.tsx`, `TeacherApplications.tsx`, `teacher/page.tsx`)에 대해 `responsive-ui-reviewer` 에이전트로 줄바꿈 금지·sticky 배경·터치 타겟·`overflow-x-auto` 점검. 지적사항 반영 후 커밋.

- [ ] **Step 2: railway-deploy-advisor 에이전트 실행**

사진 Volume 저장 변경(`UPLOAD_DIR` 의존)에 대해 `railway-deploy-advisor` 로 양 서비스 Volume 마운트 경로·환경변수 검수.

- [ ] **Step 3: test 배포 후 수동 검증**

`feat/posanmeal-mvp` push → `posanmeal.up.railway.app` 에서 담임 계정으로:
- 학생관리: 조/중/석 컬럼, 미신청=회색·신청=흰색·체크인=식사색 "O" 표시.
- 신청현황: 공고 목록 → 제목 클릭 → 우리 반 승인 신청자 명단·신청시간·서명 이미지(클릭 확대) 표시.
- 개인정보: 사진 업로드 → 표시 정상, (가능하면) 재배포 후 유지 확인.

- [ ] **Step 4: PROJECT_MAP 갱신**

`project-map-updater` 에이전트로 신규 라우트(`/api/teacher/applications*`)·컴포넌트(`TeacherApplications`)·교사 API 변경 반영.

---

## Self-Review 결과

- **Spec coverage**: #1(Task 2·3) · #2(Task 2·3 음영) · #3(Task 4·5·6·7) · #4(Task 1) 모두 매핑됨.
- **Placeholder scan**: 모든 코드 블록은 실제 코드. TBD/TODO 없음.
- **Type consistency**: `MealColumn`/`MealKind`(meal-columns), `appliedDates {date,mealKind}`, `Registration.signature:string`, Dialog `open`/`onOpenChange` 일관. API 응답 키(`students/mealColumns/grade/classNum`, `applications`, `application/registrations`)가 훅·컴포넌트와 일치.
- **마이그레이션**: 없음(기존 테이블 조회만).
