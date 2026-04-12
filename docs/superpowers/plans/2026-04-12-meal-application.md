# 석식 신청 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MealPeriod 기반 단일 기간 관리를 MealApplication + MealRegistration 기반 신청 시스템으로 전환하여, 학생이 직접 석식/조식/기타 신청(서명 포함)을 할 수 있도록 한다.

**Architecture:** 4단계 점진적 마이그레이션. Phase 1에서 신규 테이블과 API를 추가하고(비파괴적), Phase 2에서 UI를 구성하고, Phase 3에서 QR 자격 판단을 전환하고, Phase 4에서 MealPeriod를 완전 제거한다. Phase 3 전까지 기존 기능은 그대로 유지되므로 안전하게 배포 가능.

**Tech Stack:** Next.js 16.2, Prisma 7, React 19, shadcn/ui, Tailwind CSS v4, exceljs, HTML5 Canvas (서명)

**Design Spec:** `docs/superpowers/specs/2026-04-12-meal-application-design.md`

---

## Phase 1: 신규 스키마 + API (비파괴적 추가)

기존 코드를 건드리지 않고, 새 테이블과 API만 추가한다.

### Task 1: Prisma 스키마에 신규 모델 추가

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: User 모델에 registrations 관계 추가**

`mealPeriod MealPeriod?` 아래에 추가:

```prisma
registrations MealRegistration[]
```

- [ ] **Step 2: MealApplication 모델 추가**

`MealPeriod` 모델 뒤에 추가:

```prisma
model MealApplication {
  id          Int       @id @default(autoincrement())
  title       String
  description String?
  type        String    // "DINNER" | "BREAKFAST" | "OTHER"

  applyStart  DateTime  @db.Date
  applyEnd    DateTime  @db.Date

  mealStart   DateTime? @db.Date
  mealEnd     DateTime? @db.Date

  status      String    @default("OPEN") // "OPEN" | "CLOSED"
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  registrations MealRegistration[]

  @@index([status])
  @@index([applyStart, applyEnd])
}
```

- [ ] **Step 3: MealRegistration 모델 추가**

```prisma
model MealRegistration {
  id            Int       @id @default(autoincrement())
  applicationId Int
  userId        Int
  signature     String    @db.Text
  status        String    @default("APPROVED") // "APPROVED" | "CANCELLED"
  createdAt     DateTime  @default(now())
  cancelledAt   DateTime?
  cancelledBy   String?   // "STUDENT" | "ADMIN"
  addedBy       String?   // null = 학생 본인, "ADMIN" = 관리자 추가

  application   MealApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([applicationId, userId])
  @@index([userId])
  @@index([applicationId, status])
}
```

- [ ] **Step 4: 마이그레이션 실행**

Run: `npx prisma migrate dev --name add-meal-application-system`
Expected: 마이그레이션 성공, `MealApplication` + `MealRegistration` 테이블 생성

- [ ] **Step 5: 빌드 확인**

Run: `npx prisma generate && npm run build`
Expected: 에러 없이 빌드 성공 (기존 코드 변경 없으므로)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add MealApplication and MealRegistration models"
```

---

### Task 2: SignaturePad 컴포넌트

**Files:**
- Create: `src/components/SignaturePad.tsx`

- [ ] **Step 1: SignaturePad 컴포넌트 작성**

HTML5 Canvas 기반 서명 패드. 터치/마우스 모두 지원. Pointer Events 사용.

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface SignaturePadProps {
  onSignatureChange: (base64: string | null) => void;
  height?: number;
}

export function SignaturePad({ onSignatureChange, height = 150 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [height]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDrawing.current = true;
    hasDrawn.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    canvas.setPointerCapture(e.pointerId);
  }, [getPos]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, [getPos]);

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false;
    if (hasDrawn.current) {
      onSignatureChange(canvasRef.current!.toDataURL("image/png"));
    }
  }, [onSignatureChange]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    onSignatureChange(null);
  }, [onSignatureChange]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 cursor-crosshair"
        style={{ height, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex justify-end mt-2">
        <Button variant="outline" size="sm" onClick={handleClear} className="rounded-lg">
          서명 지우기
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 3: Commit**

```bash
git add src/components/SignaturePad.tsx
git commit -m "feat: add SignaturePad canvas component for meal registration"
```

---

### Task 3: 학생용 신청 API

**Files:**
- Create: `src/app/api/applications/route.ts`
- Create: `src/app/api/applications/[id]/register/route.ts`
- Create: `src/app/api/applications/my/route.ts`

- [ ] **Step 1: GET /api/applications — 활성 공고 목록**

```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date(todayKST());

  const applications = await prisma.mealApplication.findMany({
    where: {
      status: "OPEN",
      applyStart: { lte: today },
      applyEnd: { gte: today },
    },
    include: {
      registrations: {
        where: { userId: session.user.dbUserId },
        select: { id: true, status: true, createdAt: true },
      },
    },
    orderBy: { applyEnd: "asc" },
  });

  return NextResponse.json({ applications });
}
```

- [ ] **Step 2: POST + DELETE /api/applications/[id]/register — 신청/취소**

```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

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
  const { signature } = await request.json();

  if (!signature) {
    return NextResponse.json({ error: "서명이 필요합니다." }, { status: 400 });
  }

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (!app || app.status !== "OPEN" || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json({ error: "신청 기간이 아닙니다." }, { status: 400 });
  }

  try {
    const registration = await prisma.mealRegistration.create({
      data: { applicationId, userId: session.user.dbUserId, signature },
    });
    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const applicationId = parseInt(id);

  const today = new Date(todayKST());
  const app = await prisma.mealApplication.findUnique({ where: { id: applicationId } });

  if (!app || today < app.applyStart || today > app.applyEnd) {
    return NextResponse.json({ error: "신청 취소 기간이 아닙니다." }, { status: 400 });
  }

  const reg = await prisma.mealRegistration.findUnique({
    where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
  });

  if (!reg || reg.status !== "APPROVED") {
    return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });
  }

  await prisma.mealRegistration.update({
    where: { id: reg.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "STUDENT" },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: GET /api/applications/my — 본인 신청 내역**

```typescript
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registrations = await prisma.mealRegistration.findMany({
    where: { userId: session.user.dbUserId },
    include: {
      application: {
        select: {
          id: true, title: true, type: true, description: true,
          applyStart: true, applyEnd: true, mealStart: true, mealEnd: true, status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ registrations });
}
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 성공

- [ ] **Step 5: Commit**

```bash
git add src/app/api/applications/
git commit -m "feat(api): add student-facing meal application APIs"
```

---

### Task 4: 관리자 신청 API

**Files:**
- Create: `src/app/api/admin/applications/route.ts`
- Create: `src/app/api/admin/applications/[id]/route.ts`
- Create: `src/app/api/admin/applications/[id]/close/route.ts`
- Create: `src/app/api/admin/applications/[id]/registrations/route.ts`
- Create: `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`
- Create: `src/app/api/admin/applications/[id]/export/route.ts`

- [ ] **Step 1: GET + POST /api/admin/applications — 공고 목록/생성**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const applications = await prisma.mealApplication.findMany({
    include: {
      _count: {
        select: {
          registrations: { where: { status: "APPROVED" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 취소 수도 별도 카운트
  const appsWithCounts = await Promise.all(
    applications.map(async (app) => {
      const cancelledCount = await prisma.mealRegistration.count({
        where: { applicationId: app.id, status: "CANCELLED" },
      });
      return { ...app, cancelledCount };
    })
  );

  return NextResponse.json({ applications: appsWithCounts });
}

export async function POST(request: Request) {
  const body = await request.json();
  const application = await prisma.mealApplication.create({
    data: {
      title: body.title,
      description: body.description || null,
      type: body.type,
      applyStart: new Date(body.applyStart),
      applyEnd: new Date(body.applyEnd),
      mealStart: body.mealStart ? new Date(body.mealStart) : null,
      mealEnd: body.mealEnd ? new Date(body.mealEnd) : null,
    },
  });
  return NextResponse.json({ application }, { status: 201 });
}
```

- [ ] **Step 2: PUT + DELETE /api/admin/applications/[id] — 수정/삭제**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const application = await prisma.mealApplication.update({
    where: { id: parseInt(id) },
    data: {
      title: body.title,
      description: body.description || null,
      type: body.type,
      applyStart: new Date(body.applyStart),
      applyEnd: new Date(body.applyEnd),
      mealStart: body.mealStart ? new Date(body.mealStart) : null,
      mealEnd: body.mealEnd ? new Date(body.mealEnd) : null,
    },
  });
  return NextResponse.json({ application });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.mealApplication.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: POST /api/admin/applications/[id]/close — 마감**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const application = await prisma.mealApplication.update({
    where: { id: parseInt(id) },
    data: { status: "CLOSED" },
  });
  return NextResponse.json({ application });
}
```

- [ ] **Step 4: GET + POST /api/admin/applications/[id]/registrations — 명단 조회/추가**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const registrations = await prisma.mealRegistration.findMany({
    where: { applicationId: parseInt(id) },
    include: {
      user: {
        select: { id: true, name: true, grade: true, classNum: true, number: true },
      },
    },
    orderBy: [
      { user: { grade: "asc" } },
      { user: { classNum: "asc" } },
      { user: { number: "asc" } },
    ],
  });
  return NextResponse.json({ registrations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await request.json();
  try {
    const registration = await prisma.mealRegistration.create({
      data: {
        applicationId: parseInt(id),
        userId,
        signature: "",
        addedBy: "ADMIN",
      },
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

- [ ] **Step 5: PATCH /api/admin/applications/[id]/registrations/[regId] — 취소/복원**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const { regId } = await params;
  const { status } = await request.json();

  const data: Record<string, unknown> = { status };
  if (status === "CANCELLED") {
    data.cancelledAt = new Date();
    data.cancelledBy = "ADMIN";
  } else {
    data.cancelledAt = null;
    data.cancelledBy = null;
  }

  const registration = await prisma.mealRegistration.update({
    where: { id: parseInt(regId) },
    data,
  });
  return NextResponse.json({ registration });
}
```

- [ ] **Step 6: GET /api/admin/applications/[id]/export — Excel 다운로드**

기존 `src/app/api/admin/export/route.ts`의 exceljs 패턴 재사용.

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const application = await prisma.mealApplication.findUnique({
    where: { id: parseInt(id) },
    include: {
      registrations: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { name: true, grade: true, classNum: true, number: true } },
        },
        orderBy: [
          { user: { grade: "asc" } },
          { user: { classNum: "asc" } },
          { user: { number: "asc" } },
        ],
      },
    },
  });

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet("신청명단");

  sheet.mergeCells(1, 1, 1, 5);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${application.title} 신청명단`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  const headerRow = sheet.getRow(3);
  ["학년", "반", "번호", "이름", "신청일시"].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });

  [6, 6, 6, 12, 20].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  let row = 4;
  for (const reg of application.registrations) {
    const dataRow = sheet.getRow(row++);
    dataRow.getCell(1).value = reg.user.grade;
    dataRow.getCell(2).value = reg.user.classNum;
    dataRow.getCell(3).value = reg.user.number;
    dataRow.getCell(4).value = reg.user.name;
    dataRow.getCell(5).value = reg.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_신청명단.xlsx"`,
    },
  });
}
```

- [ ] **Step 7: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 성공

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin/applications/
git commit -m "feat(api): add admin meal application management APIs"
```

---

## Phase 2: UI 구현

### Task 5: 학생 페이지 — 신청 탭 추가

**Files:**
- Modify: `src/app/student/page.tsx`

구현 시 현재 학생 페이지의 최신 코드를 읽고, 기존 탭 구조(QR, 식단, 개인정보, 확인)에 "신청" 탭을 조건부로 추가한다.

- [ ] **Step 1: 현재 student/page.tsx 전체 코드 읽기**

현재 탭 구조, 인터페이스, state 관리 패턴을 파악한다.

- [ ] **Step 2: 신청 관련 state 및 fetch 로직 추가**

```tsx
// 타입
interface MealApplicationItem {
  id: number;
  title: string;
  description: string | null;
  type: string;
  applyStart: string;
  applyEnd: string;
  mealStart: string | null;
  mealEnd: string | null;
  status: string;
  registrations: Array<{ id: number; status: string; createdAt: string }>;
}

// state
const [applications, setApplications] = useState<MealApplicationItem[]>([]);
const [signDialogOpen, setSignDialogOpen] = useState(false);
const [signatureData, setSignatureData] = useState<string | null>(null);
const [selectedApp, setSelectedApp] = useState<MealApplicationItem | null>(null);
const [submitting, setSubmitting] = useState(false);

// fetch 함수
const fetchApplications = async () => {
  try {
    const res = await fetch("/api/applications");
    if (res.ok) {
      const data = await res.json();
      setApplications(data.applications);
    }
  } catch {}
};

// useEffect에서 fetchApplications() 호출
```

- [ ] **Step 3: 조건부 탭 렌더링**

```tsx
const hasApplicationTab = applications.length > 0;
const pendingCount = applications.filter(
  (a) => !a.registrations.some((r) => r.status === "APPROVED")
).length;

// TabsList에 조건부 탭 추가
{hasApplicationTab && (
  <TabsTrigger value="apply" className="rounded-lg relative text-fit-sm">
    신청
    {pendingCount > 0 && (
      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
        {pendingCount}
      </span>
    )}
  </TabsTrigger>
)}
```

- [ ] **Step 4: 신청 탭 콘텐츠 구현**

신청 가능/완료 카드를 렌더링. 공고 종류별 뱃지 색상: 석식=amber, 조식=purple, 기타=gray. 모바일 반응형: `whitespace-nowrap`, `overflow-x-auto`.

```tsx
<TabsContent value="apply">
  <div className="space-y-3">
    {applications.map((app) => {
      const myReg = app.registrations.find((r) => r.status === "APPROVED");
      const isApplied = !!myReg;
      const typeBadge = app.type === "DINNER" ? "석식" : app.type === "BREAKFAST" ? "조식" : "기타";
      const typeBgClass = app.type === "DINNER" ? "bg-amber-500" : app.type === "BREAKFAST" ? "bg-purple-500" : "bg-gray-500";

      return (
        <div key={app.id} className={`card-elevated rounded-2xl p-4 ${isApplied ? "border border-gray-200 bg-gray-50 dark:bg-gray-900" : "border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20"}`}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className={`${typeBgClass} text-white text-xs px-2 py-0.5 rounded font-bold`}>{typeBadge}</span>
              <h3 className="font-semibold mt-1 text-fit-base">{app.title}</h3>
            </div>
            <span className={`text-xs px-2 py-1 rounded-lg font-bold whitespace-nowrap ${isApplied ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300" : "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300"}`}>
              {isApplied ? "신청 완료" : "신청 가능"}
            </span>
          </div>
          {app.description && <p className="text-sm text-muted-foreground mb-2">{app.description}</p>}
          <div className="text-xs text-muted-foreground space-y-0.5 whitespace-nowrap">
            <div>신청기간: {new Date(app.applyStart).toLocaleDateString("ko-KR")} ~ {new Date(app.applyEnd).toLocaleDateString("ko-KR")}</div>
            {app.mealStart ? (
              <div>식사기간: {new Date(app.mealStart).toLocaleDateString("ko-KR")} ~ {new Date(app.mealEnd!).toLocaleDateString("ko-KR")}</div>
            ) : (
              <div className="text-purple-500">명단 수합용 (별도 식사기간 없음)</div>
            )}
          </div>
          {isApplied ? (
            <Button
              variant="outline"
              className="w-full mt-3 rounded-xl border-red-400 text-red-500 hover:bg-red-50"
              onClick={() => handleCancel(app.id)}
            >
              신청 취소
            </Button>
          ) : (
            <Button
              className="w-full mt-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => { setSelectedApp(app); setSignDialogOpen(true); setSignatureData(null); }}
            >
              신청하기
            </Button>
          )}
        </div>
      );
    })}
  </div>
</TabsContent>
```

- [ ] **Step 5: 서명 다이얼로그 구현**

```tsx
import { SignaturePad } from "@/components/SignaturePad";

// Dialog
<Dialog open={signDialogOpen} onOpenChange={setSignDialogOpen}>
  <DialogContent className="rounded-2xl max-w-sm">
    <DialogHeader>
      <DialogTitle className="text-center">{selectedApp?.title}</DialogTitle>
      <p className="text-center text-sm text-muted-foreground">아래에 서명해주세요</p>
    </DialogHeader>
    <div className="space-y-3">
      <div className="text-sm space-y-1 border-b pb-3">
        <div className="flex justify-between"><span>이름</span><span className="font-bold">{user.name}</span></div>
        <div className="flex justify-between"><span>학년/반/번호</span><span className="font-bold">{user.grade}학년 {user.classNum}반 {user.number}번</span></div>
        {selectedApp?.mealStart && (
          <div className="flex justify-between"><span>식사기간</span><span className="font-bold">{new Date(selectedApp.mealStart).toLocaleDateString("ko-KR")} ~ {new Date(selectedApp.mealEnd!).toLocaleDateString("ko-KR")}</span></div>
        )}
      </div>
      <SignaturePad onSignatureChange={setSignatureData} />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 rounded-xl" onClick={() => setSignDialogOpen(false)}>취소</Button>
        <Button
          className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
          disabled={!signatureData || submitting}
          onClick={handleRegister}
        >
          {submitting ? "처리중..." : "신청 완료"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: 신청/취소 핸들러 구현**

```tsx
const handleRegister = async () => {
  if (!selectedApp || !signatureData) return;
  setSubmitting(true);
  try {
    const res = await fetch(`/api/applications/${selectedApp.id}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: signatureData }),
    });
    if (res.ok) {
      toast.success("신청이 완료되었습니다.");
      setSignDialogOpen(false);
      fetchApplications();
    } else {
      const data = await res.json();
      toast.error(data.error || "신청에 실패했습니다.");
    }
  } catch {
    toast.error("네트워크 오류가 발생했습니다.");
  } finally {
    setSubmitting(false);
  }
};

const handleCancel = async (applicationId: number) => {
  if (!confirm("신청을 취소하시겠습니까?")) return;
  try {
    const res = await fetch(`/api/applications/${applicationId}/register`, { method: "DELETE" });
    if (res.ok) {
      toast.success("신청이 취소되었습니다.");
      fetchApplications();
    } else {
      const data = await res.json();
      toast.error(data.error || "취소에 실패했습니다.");
    }
  } catch {
    toast.error("네트워크 오류가 발생했습니다.");
  }
};
```

- [ ] **Step 7: 개발 서버에서 학생 화면 테스트**

Run: `npm run dev`
테스트:
1. 관리자로 로그인하여 공고 생성 (API로 직접 또는 다음 Task에서 UI 구현 후)
2. 학생으로 로그인 → "신청" 탭 확인
3. 신청하기 → 서명 → 신청 완료 확인
4. 신청 취소 확인
5. 공고 없을 때 신청 탭 미표시 확인

- [ ] **Step 8: Commit**

```bash
git add src/app/student/page.tsx
git commit -m "feat(student): add meal application tab with signature dialog"
```

---

### Task 6: 관리자 페이지 — 신청관리 탭 추가

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 현재 admin/page.tsx 전체 코드 읽기**

현재 탭 구조, state 관리, Dialog 패턴을 파악한다.

- [ ] **Step 2: 신청관리 관련 타입과 state 추가**

```tsx
interface MealApplication {
  id: number;
  title: string;
  description: string | null;
  type: string;
  applyStart: string;
  applyEnd: string;
  mealStart: string | null;
  mealEnd: string | null;
  status: string;
  _count: { registrations: number };
  cancelledCount: number;
}

interface Registration {
  id: number;
  userId: number;
  status: string;
  createdAt: string;
  addedBy: string | null;
  user: { id: number; name: string; grade: number; classNum: number; number: number };
}

// state
const [apps, setApps] = useState<MealApplication[]>([]);
const [appDialogOpen, setAppDialogOpen] = useState(false);
const [editingApp, setEditingApp] = useState<MealApplication | null>(null);
const [regDialogOpen, setRegDialogOpen] = useState(false);
const [selectedAppForReg, setSelectedAppForReg] = useState<MealApplication | null>(null);
const [registrations, setRegistrations] = useState<Registration[]>([]);
const [addStudentDialogOpen, setAddStudentDialogOpen] = useState(false);
const [gradeFilter, setGradeFilter] = useState<number | null>(null);

const emptyAppForm = { title: "", description: "", type: "DINNER", applyStart: "", applyEnd: "", mealStart: "", mealEnd: "" };
const [appForm, setAppForm] = useState(emptyAppForm);
```

- [ ] **Step 3: fetch 함수 추가**

```tsx
const fetchApps = async () => {
  const res = await fetch("/api/admin/applications");
  if (res.ok) {
    const data = await res.json();
    setApps(data.applications);
  }
};

const fetchRegistrations = async (appId: number) => {
  const res = await fetch(`/api/admin/applications/${appId}/registrations`);
  if (res.ok) {
    const data = await res.json();
    setRegistrations(data.registrations);
  }
};
```

- [ ] **Step 4: TabsTrigger에 "신청관리" 추가**

기존 탭 grid를 `grid-cols-5`로 변경 (또는 기존 수 + 1). 기존 탭 순서를 유지하면서 "신청관리"를 두 번째 위치에 삽입.

```tsx
<TabsTrigger value="applications" className="rounded-lg text-fit-sm whitespace-nowrap">신청관리</TabsTrigger>
```

- [ ] **Step 5: 신청관리 TabsContent 구현**

"+공고" 버튼, 공고 카드 리스트 (진행중/마감 구분), 각 카드에 명단/Excel/수정/마감 버튼. 모바일 반응형: `whitespace-nowrap`, 버튼 크기 조정.

- [ ] **Step 6: 공고 생성/수정 Dialog 구현**

종류 토글(석식/조식/기타), 제목, 설명, 신청기간, 식사기간(선택) 입력 폼. 기존 addDialog 패턴 따르기.

- [ ] **Step 7: 명단 Dialog 구현**

학년 필터, 테이블(학년/반/번호/이름/신청일/상태/관리), "+학생 추가" 버튼, Excel 다운로드 버튼. 테이블은 `overflow-x-auto` 래퍼로 가로 스크롤 지원.

- [ ] **Step 8: 학생 추가 Dialog 구현**

현재 등록된 STUDENT 목록에서 검색/선택하여 관리자가 직접 추가하는 Dialog.

- [ ] **Step 9: 핸들러 구현**

공고 CRUD, 마감, 명단 취소/복원, 학생 추가, Excel 다운로드 핸들러.

- [ ] **Step 10: 사용자 관리 탭에서 MealPeriod 관련 코드 제거**

- 사용자 편집 Dialog에서 `startDate`/`endDate` 입력 필드 제거
- `handleEditUser`에서 `/api/admin/meal-periods` API 호출 제거
- 사용자 테이블에서 "신청기간" 컬럼 제거 (또는 현재 활성 신청 수로 변경)
- `emptyForm`에서 `startDate`, `endDate` 제거

- [ ] **Step 11: 개발 서버에서 관리자 화면 테스트**

Run: `npm run dev`
테스트:
1. 관리자 로그인 → 신청관리 탭 확인
2. "+공고" → 공고 생성 (석식/조식/기타, 식사기간 있음/없음)
3. 명단 확인 → 학년 필터 → 학생 추가 → 취소/복원
4. Excel 다운로드 → 파일 열기 확인
5. 공고 마감 → 상태 변경 확인
6. 사용자 편집에서 mealPeriod 필드 없어진 것 확인

- [ ] **Step 12: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): add meal application management tab"
```

---

## Phase 3: QR 자격 판단 전환

기존 MealPeriod 기반 → MealRegistration 기반으로 전환. 이 Phase의 모든 변경은 함께 배포해야 한다.

### Task 7: QR 및 체크인 API 전환

**Files:**
- Modify: `src/app/api/qr/token/route.ts`
- Modify: `src/app/api/checkin/route.ts`
- Modify: `src/app/api/sync/upload/route.ts`
- Modify: `src/app/api/users/me/route.ts`

- [ ] **Step 1: QR Token 라우트 변경**

`src/app/api/qr/token/route.ts`에서 MealPeriod 조회를 MealRegistration 조회로 교체:

```typescript
// 기존 mealPeriod 조회 블록을 다음으로 교체
if (role === "STUDENT") {
  const today = new Date(todayKST());
  const activeReg = await prisma.mealRegistration.findFirst({
    where: {
      userId,
      status: "APPROVED",
      application: {
        mealStart: { not: null, lte: today },
        mealEnd: { not: null, gte: today },
      },
    },
  });

  if (!activeReg) {
    return NextResponse.json(
      { error: "현재 석식 신청 기간이 없습니다." },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 2: 체크인 라우트 변경**

`src/app/api/checkin/route.ts`에서 Promise.all 내 mealPeriod 조회를 교체:

```typescript
const [activeReg, existing, user] = await Promise.all([
  payload.role === "STUDENT"
    ? prisma.mealRegistration.findFirst({
        where: {
          userId: payload.userId,
          status: "APPROVED",
          application: {
            mealStart: { not: null, lte: todayDate },
            mealEnd: { not: null, gte: todayDate },
          },
        },
      })
    : Promise.resolve(null),
  // existing, user 쿼리는 기존 그대로
]);

// 검증 부분에서 mealPeriod → activeReg로 교체
if (payload.role === "STUDENT" && !activeReg) {
  return NextResponse.json(
    { success: false, error: "석식 신청 기간이 아닙니다.", errorCode: "NO_MEAL_PERIOD" },
    { status: 400 }
  );
}
```

- [ ] **Step 3: Sync Upload 라우트 변경**

`src/app/api/sync/upload/route.ts`에서 mealPeriod 검증 교체 (STUDENT 체크인의 서버 재검증 부분):

```typescript
if (user.role === "STUDENT") {
  const dateObj = new Date(ci.date);
  const activeReg = await prisma.mealRegistration.findFirst({
    where: {
      userId: ci.userId,
      status: "APPROVED",
      application: {
        mealStart: { not: null, lte: dateObj },
        mealEnd: { not: null, gte: dateObj },
      },
    },
  });
  if (!activeReg) {
    rejected.push({ userId: ci.userId, date: ci.date, reason: "NO_MEAL_PERIOD" });
    continue;
  }
}
```

- [ ] **Step 4: Users/Me 라우트 변경**

`src/app/api/users/me/route.ts`에서 mealPeriod select를 registrations로 교체:

```typescript
// 기존: mealPeriod: { select: { startDate: true, endDate: true } }
// 변경:
registrations: {
  where: { status: "APPROVED" },
  select: {
    id: true,
    createdAt: true,
    application: {
      select: { id: true, title: true, type: true, mealStart: true, mealEnd: true },
    },
  },
  orderBy: { createdAt: "desc" as const },
},
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 성공

- [ ] **Step 6: Commit**

```bash
git add src/app/api/qr/token/route.ts src/app/api/checkin/route.ts src/app/api/sync/upload/route.ts src/app/api/users/me/route.ts
git commit -m "feat(api): switch QR eligibility from MealPeriod to MealRegistration"
```

---

### Task 8: 로컬 모드 전환

**Files:**
- Modify: `src/lib/local-db.ts`
- Modify: `src/app/api/sync/download/route.ts`
- Modify: `src/app/check/page.tsx`
- Modify: `src/app/admin/page.tsx` (sync 부분)

- [ ] **Step 1: Sync Download API 변경**

`src/app/api/sync/download/route.ts`에서 mealPeriods를 eligibleUserIds로 교체:

```typescript
import { todayKST } from "@/lib/timezone";

// Promise.all 내 mealPeriods 쿼리를 교체:
const today = new Date(todayKST());

const [settings, users, eligibleRegs] = await Promise.all([
  prisma.systemSetting.findMany(),
  prisma.user.findMany({
    select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
  }),
  prisma.mealRegistration.findMany({
    where: {
      status: "APPROVED",
      application: {
        mealStart: { not: null, lte: today },
        mealEnd: { not: null, gte: today },
      },
    },
    select: { userId: true },
    distinct: ["userId"],
  }),
]);

// 응답에서:
// 기존: mealPeriods: mealPeriods.map(...)
// 변경:
eligibleUserIds: eligibleRegs.map((r) => r.userId),
```

- [ ] **Step 2: local-db.ts 변경**

DB_VERSION을 3으로 올리고, mealPeriods → eligibleUsers로 교체:

```typescript
const DB_VERSION = 3;

// onupgradeneeded에서:
if (oldVersion < 3) {
  if (db.objectStoreNames.contains("mealPeriods")) {
    db.deleteObjectStore("mealPeriods");
  }
}
if (!db.objectStoreNames.contains("eligibleUsers")) {
  db.createObjectStore("eligibleUsers", { keyPath: "userId" });
}

// 기존 함수 삭제: LocalMealPeriod interface, getMealPeriod(), replaceAllMealPeriods()
// 새 함수 추가:
export async function isEligible(userId: number): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleUsers", "readonly");
    const req = tx.objectStore("eligibleUsers").get(userId);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function replaceAllEligibleUsers(userIds: number[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("eligibleUsers", "readwrite");
    const store = tx.objectStore("eligibleUsers");
    store.clear();
    for (const userId of userIds) {
      store.put({ userId });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// clearAllData에서 "mealPeriods" → "eligibleUsers"로 변경
```

- [ ] **Step 3: check/page.tsx 변경**

```typescript
// import 변경
// 기존: import { getMealPeriod, replaceAllMealPeriods } from "@/lib/local-db"
// 변경: import { isEligible, replaceAllEligibleUsers } from "@/lib/local-db"

// performSync에서:
// 기존: await replaceAllMealPeriods(data.mealPeriods)
// 변경: await replaceAllEligibleUsers(data.eligibleUserIds)

// handleLocalScan에서 MealPeriod 검증 교체:
if (user.role === "STUDENT") {
  const eligible = await isEligible(parsed.userId);
  if (!eligible) {
    setResult({ success: false, error: "오늘은 석식 대상이 아닙니다.", errorCode: "NO_MEAL_PERIOD" });
    playDoubleBeep();
    return;
  }
}
```

- [ ] **Step 4: admin/page.tsx sync 코드 변경**

```typescript
// handleAdminSync에서:
// 기존: const { ..., replaceAllMealPeriods, ... } = await import("@/lib/local-db")
// 변경: const { ..., replaceAllEligibleUsers, ... } = await import("@/lib/local-db")

// 기존: await replaceAllMealPeriods(data.mealPeriods)
// 변경: await replaceAllEligibleUsers(data.eligibleUserIds)

// 메시지 변경:
// 기존: `석식기간 ${data.mealPeriods.length}건`
// 변경: `자격자 ${data.eligibleUserIds.length}명`
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 성공

- [ ] **Step 6: 로컬 모드 테스트**

1. 관리자 → 설정 → 로컬 모드 전환
2. 동기화 실행
3. 자격 있는 학생 QR 스캔 → 성공
4. 자격 없는 학생 QR 스캔 → 실패
5. 온라인 모드로 복구

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-db.ts src/app/api/sync/download/route.ts src/app/check/page.tsx src/app/admin/page.tsx
git commit -m "feat(local): switch local mode from MealPeriod to eligibleUserIds"
```

---

### Task 9: 학생 QR 탭 MealPeriod 참조 제거

**Files:**
- Modify: `src/app/student/page.tsx`

- [ ] **Step 1: UserProfile 인터페이스 변경**

```typescript
// 기존: mealPeriod?: { startDate: string; endDate: string }
// 변경:
registrations?: Array<{
  id: number;
  createdAt: string;
  application: { id: number; title: string; type: string; mealStart: string | null; mealEnd: string | null };
}>;
```

- [ ] **Step 2: QR 탭의 mealPeriod 로직 변경**

```tsx
// 기존: const hasMealPeriod = !!user.mealPeriod
// 변경:
const activeRegistrations = (user.registrations || []).filter((r) => {
  if (!r.application.mealStart || !r.application.mealEnd) return false;
  const today = new Date().toISOString().slice(0, 10);
  return today >= r.application.mealStart.slice(0, 10) && today <= r.application.mealEnd.slice(0, 10);
});
const hasMealPeriod = activeRegistrations.length > 0;

// 기간 표시 변경:
// 기존: {user.mealPeriod.startDate} ~ {user.mealPeriod.endDate}
// 변경: 활성 신청 목록 표시
{activeRegistrations.map((r) => (
  <div key={r.id} className="text-xs text-muted-foreground whitespace-nowrap">
    {r.application.title}: {new Date(r.application.mealStart!).toLocaleDateString("ko-KR")} ~ {new Date(r.application.mealEnd!).toLocaleDateString("ko-KR")}
  </div>
))}
```

- [ ] **Step 3: 빌드 및 테스트**

Run: `npm run build`
학생 QR 탭에서 기간 표시가 올바른지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/app/student/page.tsx
git commit -m "feat(student): replace mealPeriod with registrations in QR tab"
```

---

## Phase 4: MealPeriod 완전 제거

### Task 10: MealPeriod 참조 전면 제거

**Files:**
- Modify: `prisma/schema.prisma`
- Delete: `src/app/api/admin/meal-periods/route.ts`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/admin/checkins/route.ts`
- Modify: `src/app/api/teacher/students/route.ts`
- Modify: `src/app/api/admin/import/route.ts`
- Modify: `src/components/AdminMealTable.tsx`
- Modify: `src/components/StudentTable.tsx`

- [ ] **Step 1: Schema에서 MealPeriod 모델 제거**

`prisma/schema.prisma`에서:
- `model MealPeriod { ... }` 전체 삭제
- `User` 모델에서 `mealPeriod MealPeriod?` 라인 삭제

- [ ] **Step 2: 마이그레이션 실행**

Run: `npx prisma migrate dev --name remove-meal-period`

- [ ] **Step 3: meal-periods API 삭제**

`src/app/api/admin/meal-periods/route.ts` 파일 삭제.

- [ ] **Step 4: admin/users API에서 mealPeriod 제거**

`src/app/api/admin/users/route.ts`:
- GET: `mealPeriod: { select: ... }` 제거
- POST: `prisma.mealPeriod.create(...)` 블록 제거

- [ ] **Step 5: admin/checkins API에서 mealPeriod 제거**

`src/app/api/admin/checkins/route.ts`: `mealPeriod: { select: ... }` 라인 제거

- [ ] **Step 6: teacher/students API에서 mealPeriod 제거**

`src/app/api/teacher/students/route.ts`: `mealPeriod: { select: ... }` 라인 제거

- [ ] **Step 7: admin/import API에서 mealPeriod 제거**

`src/app/api/admin/import/route.ts`: mealPeriod upsert 관련 코드 블록 전체 삭제

- [ ] **Step 8: AdminMealTable 컴포넌트에서 mealPeriod 제거**

`src/components/AdminMealTable.tsx`:
- `UserRecord` 인터페이스에서 `mealPeriod` 필드 제거
- "미신청"/"미" 뱃지 표시 로직 제거 또는 registration 기반으로 변경

- [ ] **Step 9: StudentTable 컴포넌트에서 mealPeriod 제거**

`src/components/StudentTable.tsx`:
- `Student` 인터페이스에서 `mealPeriod` 필드 제거
- "미" 표시 로직 제거 또는 변경

- [ ] **Step 10: local-db.ts 최종 정리**

`src/lib/local-db.ts`에서 `LocalMealPeriod` 인터페이스, `getMealPeriod`, `replaceAllMealPeriods` 함수가 아직 남아있다면 제거.

- [ ] **Step 11: admin/page.tsx 최종 정리**

사용자 관리 탭의 User 인터페이스에서 `mealPeriod` 제거, emptyForm에서 `startDate`/`endDate` 제거, 사용자 테이블에서 mealPeriod 컬럼 제거.

- [ ] **Step 12: 전체 빌드 및 MealPeriod 참조 검색**

Run:
```bash
npx prisma generate && npm run build
```

그 다음 MealPeriod 참조가 남아있는지 확인:
```bash
grep -r "mealPeriod\|MealPeriod\|meal-periods\|meal_period" src/ --include="*.ts" --include="*.tsx"
```
Expected: 결과 없음 (migration SQL은 제외)

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: remove MealPeriod table and all references, replaced by MealApplication system"
```

---

## Verification Checklist

Phase 완료 후 전체 기능 테스트:

1. **관리자 공고 관리**: 생성 → 수정 → 명단 확인 → Excel → 마감 → 삭제
2. **학생 신청**: 공고 확인 → 서명 → 신청 → 취소 → 재신청
3. **QR 자격**: 신청 O → QR 생성 성공 / 신청 X → QR 생성 실패
4. **체크인**: QR 스캔 → 체크인 성공/실패
5. **로컬 모드**: 동기화 → 오프라인 스캔 → 자격 확인
6. **명단 수합용**: 식사기간 없는 공고 → QR 영향 없음 확인
7. **관리자 추가/취소**: 신청기간 외 관리자 직접 추가/취소
8. **모바일**: 모든 화면 모바일에서 줄바꿈 없이 표시, 테이블 가로 스크롤
9. **기존 기능**: 석식 확인 탭, 당일 현황, 교사 학생관리 정상 동작
