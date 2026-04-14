# 교사 admin/subadmin 권한 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교사에게 admin/subadmin 관리 권한을 부여해 `/admin` 페이지를 사용할 수 있게 한다. admin은 환경변수 admin과 동일 권한, subadmin은 `/admin` 읽기 + 월별 Excel 다운로드만 허용.

**Architecture:**
- DB: `User.adminLevel` enum (`NONE | SUBADMIN | ADMIN`) 신규 컬럼.
- Auth: NextAuth jwt/session 콜백이 `adminLevel` 토큰에 주입. 환경변수 admin은 `adminLevel: "ADMIN"` 가상 주입.
- 미들웨어: 진입 게이트만 (admin/subadmin 모두 통과). 쓰기 차단은 각 API 핸들러의 `canWriteAdmin(session)` 가드.
- UI: `useAdminPermission()` 훅으로 탭/버튼/컨트롤 조건부 렌더.

**Tech Stack:** Prisma 7 (PostgreSQL), NextAuth v5 (jwt strategy), Next.js 16 App Router, React 19, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-04-14-teacher-admin-roles-design.md`

**Note on testing:** 본 프로젝트는 자동 테스트 인프라가 없음(spec §5.3). 각 task의 검증은 수동 확인(빌드, dev 서버 확인, curl, UI 클릭)으로 수행.

---

## File Structure

**Create:**
- `prisma/migrations/<TIMESTAMP>_add_admin_level/migration.sql` — enum + 컬럼 + 인덱스
- `src/lib/permissions.ts` — 서버 측 권한 헬퍼 (`canWriteAdmin`, `canReadAdmin`, `getEffectiveAdminLevel`)
- `src/hooks/useAdminPermission.ts` — 클라이언트 권한 훅

**Modify:**
- `prisma/schema.prisma` — `AdminLevel` enum, `User.adminLevel` 필드, 인덱스
- `src/types/next-auth.d.ts` — `adminLevel` 타입 augmentation
- `src/auth.ts` — signIn/jwt/session 콜백 확장
- `src/middleware.ts` — admin 진입 게이트 확장
- `src/app/api/admin/users/route.ts` — POST/PUT/DELETE 가드 + adminLevel 검증
- `src/app/api/admin/import/route.ts` — POST 가드
- `src/app/api/admin/applications/route.ts` — GET/POST 가드
- `src/app/api/admin/applications/[id]/route.ts` — PUT/DELETE 가드
- `src/app/api/admin/applications/[id]/close/route.ts` — POST 가드
- `src/app/api/admin/applications/[id]/registrations/route.ts` — GET/POST 가드
- `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` — PATCH 가드
- `src/app/api/admin/applications/[id]/export/route.ts` — GET 가드
- `src/app/api/admin/applications/[id]/import/route.ts` — POST 가드
- `src/app/api/admin/checkins/route.ts` — PATCH 가드 (GET은 미들웨어만으로 충분)
- `src/app/api/system/settings/route.ts` — PUT 가드
- `src/app/api/sync/download/route.ts` — GET 가드
- `src/app/api/sync/upload/route.ts` — POST 가드
- `src/app/teacher/page.tsx` — 헤더에 "관리자 페이지" 버튼
- `src/app/admin/page.tsx` — 헤더(이름·배지·교사페이지 링크), 탭 조건부, 사용자 관리 권한 컬럼·버튼 가드, 당일 현황 교사 토글 가드
- `src/components/AdminMealTable.tsx` — `readonly` prop 추가

---

## Task 1: 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<TIMESTAMP>_add_admin_level/migration.sql`

- [ ] **Step 1: schema.prisma 수정 — AdminLevel enum + 필드 추가**

`prisma/schema.prisma` 의 enum 영역에 추가:

```prisma
enum AdminLevel {
  NONE
  SUBADMIN
  ADMIN
}
```

`User` 모델에 필드와 인덱스 추가:

```prisma
model User {
  // 기존 필드 그대로 유지 …
  adminLevel AdminLevel @default(NONE)

  checkIns      CheckIn[]
  registrations MealRegistration[]

  @@index([role, grade, classNum, number])
  @@index([role, adminLevel])
}
```

- [ ] **Step 2: 마이그레이션 생성 (로컬 DB 필요)**

로컬 PostgreSQL이 떠 있는 상태에서:

```bash
docker compose up -d
npx prisma migrate dev --name add_admin_level
```

생성된 SQL이 아래와 동등한지 확인 (자동 생성됨):

```sql
CREATE TYPE "AdminLevel" AS ENUM ('NONE', 'SUBADMIN', 'ADMIN');
ALTER TABLE "User" ADD COLUMN "adminLevel" "AdminLevel" NOT NULL DEFAULT 'NONE';
CREATE INDEX "User_role_adminLevel_idx" ON "User"("role", "adminLevel");
```

- [ ] **Step 3: Prisma 클라이언트 재생성 확인**

```bash
npx prisma generate
```

기대: `src/generated/prisma/client` 에 `AdminLevel` enum이 export됨. 다음 명령으로 확인:

```bash
grep -r "AdminLevel" src/generated/prisma | head -5
```

기대 결과: `enum AdminLevel` 정의가 보임.

- [ ] **Step 4: 빌드 통과 확인**

```bash
npm run build
```

기대: 에러 없이 빌드 완료.

- [ ] **Step 5: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add AdminLevel enum and User.adminLevel column"
```

---

## Task 2: NextAuth 타입 augmentation

**Files:**
- Modify: `src/types/next-auth.d.ts`

- [ ] **Step 1: 타입 정의 확장**

`src/types/next-auth.d.ts` 전체를 다음으로 교체:

```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
      role: string;
      dbUserId: number;
      adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
    };
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    dbUserId?: number;
    adminLevel?: "NONE" | "SUBADMIN" | "ADMIN";
  }
}
```

- [ ] **Step 2: 타입체크 통과 확인**

```bash
npx tsc --noEmit
```

기대: 에러 없음 (또는 기존부터 있던 무관 에러만).

- [ ] **Step 3: 커밋**

```bash
git add src/types/next-auth.d.ts
git commit -m "feat(types): add adminLevel to Session/JWT augmentation"
```

---

## Task 3: auth.ts — adminLevel 토큰 주입

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: signIn / jwt / session 콜백 수정**

`src/auth.ts` 의 `callbacks` 객체를 다음으로 교체 (기존 callbacks 영역 전체):

```ts
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, role: true, adminLevel: true },
        });
        if (!dbUser) return false;
        (user as any).dbUserId = dbUser.id;
        (user as any).dbRole = dbUser.role;
        (user as any).dbAdminLevel = dbUser.adminLevel;
        return true;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user) {
        token.dbUserId = (user as any).dbUserId;
        token.role = (user as any).dbRole;
        token.adminLevel = (user as any).dbAdminLevel ?? "NONE";
      }
      if (account?.provider === "admin-login") {
        token.role = "ADMIN";
        token.dbUserId = 0;
        token.adminLevel = "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role as string;
      session.user.dbUserId = token.dbUserId as number;
      session.user.adminLevel =
        (token.adminLevel as "NONE" | "SUBADMIN" | "ADMIN") ?? "NONE";
      return session;
    },
  },
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npm run build
```

기대: 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/auth.ts
git commit -m "feat(auth): inject adminLevel into JWT and session"
```

---

## Task 4: 서버 권한 헬퍼 — `src/lib/permissions.ts`

**Files:**
- Create: `src/lib/permissions.ts`

- [ ] **Step 1: 헬퍼 파일 생성**

`src/lib/permissions.ts`:

```ts
import type { Session } from "next-auth";

export type EffectiveLevel = "NONE" | "SUBADMIN" | "ADMIN";

export function getEffectiveAdminLevel(
  session: Session | null
): EffectiveLevel {
  if (!session?.user) return "NONE";
  if (session.user.role === "ADMIN") return "ADMIN";
  return (session.user.adminLevel ?? "NONE") as EffectiveLevel;
}

export function canWriteAdmin(session: Session | null): boolean {
  return getEffectiveAdminLevel(session) === "ADMIN";
}

export function canReadAdmin(session: Session | null): boolean {
  const lvl = getEffectiveAdminLevel(session);
  return lvl === "ADMIN" || lvl === "SUBADMIN";
}
```

- [ ] **Step 2: 빌드 통과 확인**

```bash
npm run build
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/permissions.ts
git commit -m "feat(lib): add server-side admin permission helpers"
```

---

## Task 5: 미들웨어 — admin 진입 게이트 확장

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: 미들웨어 함수 본문 교체**

`src/middleware.ts` 의 `auth((req) => { ... })` 함수 본문을 다음으로 교체:

```ts
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  const publicExact = new Set(["/", "/check", "/admin/login"]);
  const publicPrefixes = [
    "/api/auth", "/api/checkin", "/api/uploads",
    "/api/system/settings", "/api/sync", "/api/meals",
    "/_next", "/uploads",
  ];

  if (publicExact.has(pathname) || publicPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  const role = session.user?.role;
  const adminLevel = (session.user?.adminLevel ?? "NONE") as
    | "NONE" | "SUBADMIN" | "ADMIN";

  const isAdminAccess =
    role === "ADMIN" ||
    (role === "TEACHER" && (adminLevel === "ADMIN" || adminLevel === "SUBADMIN"));

  if (pathname.startsWith("/student") && role !== "STUDENT") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (pathname.startsWith("/teacher") && role !== "TEACHER") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    pathname.startsWith("/admin") &&
    !pathname.startsWith("/admin/login") &&
    !isAdminAccess
  ) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  if (pathname.startsWith("/api/admin") && !isAdminAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pathname.startsWith("/api/teacher") && role !== "TEACHER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
});
```

(이 외 `runtime` 및 `config` export는 유지)

- [ ] **Step 2: 빌드 통과**

```bash
npm run build
```

- [ ] **Step 3: 커밋**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): allow subadmin/admin teachers into /admin gate"
```

---

## Task 6: `/api/admin/users` — 가드 + adminLevel 변경 로직

**Files:**
- Modify: `src/app/api/admin/users/route.ts`

- [ ] **Step 1: 파일 전체 교체**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role") as "STUDENT" | "TEACHER" | null;
  const where = role ? { role } : {};
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true,
      grade: true, classNum: true, number: true,
      subject: true, homeroom: true, position: true,
      adminLevel: true,
    },
    orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      email: body.email, name: body.name, role: body.role,
      grade: body.grade || null, classNum: body.classNum || null, number: body.number || null,
      subject: body.subject || null, homeroom: body.homeroom || null, position: body.position || null,
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // adminLevel 변경 요청 검증
  if (body.adminLevel !== undefined) {
    const allowed = ["NONE", "SUBADMIN", "ADMIN"] as const;
    if (!allowed.includes(body.adminLevel)) {
      return NextResponse.json(
        { error: "Bad Request", reason: "유효하지 않은 권한 값입니다." },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: body.id },
      select: { id: true, role: true, adminLevel: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "Bad Request", reason: "대상 사용자를 찾을 수 없습니다." },
        { status: 400 }
      );
    }

    if (target.role === "STUDENT" && body.adminLevel !== "NONE") {
      return NextResponse.json(
        { error: "Bad Request", reason: "학생에게는 관리자 권한을 부여할 수 없습니다." },
        { status: 400 }
      );
    }

    const callerDbUserId = session?.user?.dbUserId ?? 0;
    if (
      callerDbUserId !== 0 &&
      callerDbUserId === target.id &&
      target.adminLevel === "ADMIN" &&
      body.adminLevel !== "ADMIN"
    ) {
      return NextResponse.json(
        { error: "Bad Request", reason: "본인의 관리자 권한은 직접 변경할 수 없습니다." },
        { status: 400 }
      );
    }
  }

  const user = await prisma.user.update({
    where: { id: body.id },
    data: {
      email: body.email, name: body.name,
      grade: body.grade, classNum: body.classNum, number: body.number,
      subject: body.subject, homeroom: body.homeroom, position: body.position,
      ...(body.adminLevel !== undefined ? { adminLevel: body.adminLevel } : {}),
    },
  });
  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "0");
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 빌드 통과**

```bash
npm run build
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/admin/users/route.ts
git commit -m "feat(api): guard /api/admin/users writes and validate adminLevel updates"
```

---

## Task 7: `/api/admin/import` 가드

**Files:**
- Modify: `src/app/api/admin/import/route.ts`

- [ ] **Step 1: 파일 상단 import 추가**

파일 맨 위 import 영역에 추가:

```ts
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
```

- [ ] **Step 2: POST 핸들러 도입부에 가드 추가**

`export async function POST(request: Request) {` 직후 한 줄 들여서:

```ts
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

(다른 메서드는 없음)

- [ ] **Step 3: 빌드 + 커밋**

```bash
npm run build
git add src/app/api/admin/import/route.ts
git commit -m "feat(api): guard /api/admin/import (write only)"
```

---

## Task 8: `/api/admin/applications/**` 전체 가드

신청 관리 전체가 subadmin에게 차단되므로, GET 포함 모든 핸들러에 `canWriteAdmin` 가드 적용.

**Files:**
- Modify:
  - `src/app/api/admin/applications/route.ts`
  - `src/app/api/admin/applications/[id]/route.ts`
  - `src/app/api/admin/applications/[id]/close/route.ts`
  - `src/app/api/admin/applications/[id]/registrations/route.ts`
  - `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`
  - `src/app/api/admin/applications/[id]/export/route.ts`
  - `src/app/api/admin/applications/[id]/import/route.ts`

- [ ] **Step 1: 위 7개 파일 각각의 모든 핸들러 도입부에 가드 추가**

각 파일의 import 영역에:

```ts
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
```

(이미 NextResponse가 import되어 있는지 확인)

각 export된 HTTP 핸들러(`GET`, `POST`, `PUT`, `DELETE`, `PATCH` 모두) 함수 본문 첫 줄에:

```ts
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

- [ ] **Step 2: 빌드 통과**

```bash
npm run build
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/admin/applications
git commit -m "feat(api): guard all /api/admin/applications endpoints (admin-only)"
```

---

## Task 9: `/api/admin/checkins` PATCH 가드 (GET은 미들웨어로 충분)

**Files:**
- Modify: `src/app/api/admin/checkins/route.ts`

- [ ] **Step 1: import 추가 + PATCH 핸들러에만 가드**

파일 import 영역에 추가:

```ts
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
```

`export async function PATCH(...)` 본문 첫 줄에:

```ts
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

GET 핸들러는 수정하지 않음 (subadmin 허용).

- [ ] **Step 2: 빌드 + 커밋**

```bash
npm run build
git add src/app/api/admin/checkins/route.ts
git commit -m "feat(api): guard PATCH /api/admin/checkins (work/personal toggle)"
```

---

## Task 10: `/api/system/settings` PUT 가드

**Files:**
- Modify: `src/app/api/system/settings/route.ts`

- [ ] **Step 1: import + PUT 가드**

import 영역에:

```ts
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
```

`export async function PUT(...)` 본문 첫 줄에:

```ts
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

GET 핸들러는 그대로 (공개).

- [ ] **Step 2: 빌드 + 커밋**

```bash
npm run build
git add src/app/api/system/settings/route.ts
git commit -m "feat(api): guard PUT /api/system/settings (admin-only)"
```

---

## Task 11: `/api/sync/**` 가드

**Files:**
- Modify:
  - `src/app/api/sync/download/route.ts`
  - `src/app/api/sync/upload/route.ts`

- [ ] **Step 1: 두 파일 모두 import + 모든 핸들러에 가드**

각 파일 import 영역에:

```ts
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
```

각 export된 핸들러 본문 첫 줄에:

```ts
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

- [ ] **Step 2: 빌드 + 커밋**

```bash
npm run build
git add src/app/api/sync
git commit -m "feat(api): guard /api/sync endpoints (admin-only)"
```

---

## Task 12: 클라이언트 권한 훅 — `useAdminPermission`

**Files:**
- Create: `src/hooks/useAdminPermission.ts`

- [ ] **Step 1: 훅 파일 생성**

`src/hooks/useAdminPermission.ts`:

```ts
"use client";
import { useSession } from "next-auth/react";

export function useAdminPermission() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const adminLevel = (session?.user?.adminLevel ?? "NONE") as
    | "NONE" | "SUBADMIN" | "ADMIN";

  const isEnvAdmin = role === "ADMIN";
  const isTeacherAdmin = role === "TEACHER" && adminLevel === "ADMIN";
  const isSubadmin = role === "TEACHER" && adminLevel === "SUBADMIN";

  return {
    canWrite: isEnvAdmin || isTeacherAdmin,
    canRead: isEnvAdmin || isTeacherAdmin || isSubadmin,
    isSubadmin,
    isTeacher: role === "TEACHER",
    isEnvAdmin,
    displayName: session?.user?.name ?? "",
    badgeLabel: isEnvAdmin
      ? "최고관리자"
      : isTeacherAdmin
      ? "관리자"
      : isSubadmin
      ? "서브관리자"
      : "",
    dbUserId: session?.user?.dbUserId ?? 0,
  };
}
```

- [ ] **Step 2: 빌드 + 커밋**

```bash
npm run build
git add src/hooks/useAdminPermission.ts
git commit -m "feat(hooks): add useAdminPermission for client gating"
```

---

## Task 13: `/teacher` 헤더 — "관리자 페이지" 버튼

**Files:**
- Modify: `src/app/teacher/page.tsx`

- [ ] **Step 1: 현재 헤더 구조 파악**

```bash
grep -n "ThemeToggle\|signOut\|header\|로그아웃" src/app/teacher/page.tsx
```

위 결과로 헤더 우측 액션 영역(테마/로그아웃 버튼 묶음)의 위치를 확인.

- [ ] **Step 2: import 추가**

파일 상단 import 영역에:

```ts
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAdminPermission } from "@/hooks/useAdminPermission";
```

(이미 있는 것은 중복 추가하지 않음)

- [ ] **Step 3: 컴포넌트 함수 본문 상단에 훅 호출**

함수 컴포넌트 본문 (state/hook 영역) 어딘가에:

```ts
const { canRead: isAnyAdmin, isTeacher } = useAdminPermission();
```

- [ ] **Step 4: 헤더 우측 액션 영역에 버튼 추가**

테마 토글 / 로그아웃 버튼이 모여있는 영역(Step 1에서 확인한 위치)의 그 두 버튼 **앞에** 추가:

```tsx
{isAnyAdmin && isTeacher && (
  <Link href="/admin">
    <Button variant="outline" size="sm" className="rounded-xl">
      관리자 페이지
    </Button>
  </Link>
)}
```

- [ ] **Step 5: dev 서버에서 시각 확인**

```bash
npm run dev
```

브라우저에서 일반 교사 계정으로 `/teacher` 진입 → 버튼 없음 확인. (admin/subadmin 부여는 Task 14~15 이후 가능)

- [ ] **Step 6: 빌드 + 커밋**

```bash
npm run build
git add src/app/teacher/page.tsx
git commit -m "feat(teacher): show admin link in header for admin/subadmin teachers"
```

---

## Task 14: `/admin` 헤더 — 이름·배지·교사페이지 링크

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 현재 헤더 위치 파악**

```bash
grep -n "ThemeToggle\|signOut\|로그아웃\|<header\|header-gradient" src/app/admin/page.tsx | head -20
```

- [ ] **Step 2: import 추가**

```ts
import Link from "next/link";
import { useAdminPermission } from "@/hooks/useAdminPermission";
```

(이미 있으면 중복 X)

- [ ] **Step 3: 컴포넌트 함수 본문에 훅 호출**

```ts
const adminPerm = useAdminPermission();
```

- [ ] **Step 4: 헤더 영역에 사용자 정보 + 배지 + 링크 추가**

헤더 우측 액션 영역(로그아웃 버튼 근처)에 다음을 추가:

```tsx
{adminPerm.badgeLabel && (
  <span className="hidden sm:inline text-sm text-muted-foreground whitespace-nowrap">
    {adminPerm.displayName} · <span className="font-medium">{adminPerm.badgeLabel}</span>
  </span>
)}
{adminPerm.isTeacher && (
  <Link href="/teacher">
    <Button variant="outline" size="sm" className="rounded-xl">
      교사 페이지로
    </Button>
  </Link>
)}
```

(테마/로그아웃 버튼 앞 또는 적절한 위치, 이미 있는 헤더 레이아웃에 맞춰 배치)

- [ ] **Step 5: 빌드 + 커밋**

```bash
npm run build
git add src/app/admin/page.tsx
git commit -m "feat(admin): show user name, badge, and teacher-page link in header"
```

---

## Task 15: `/admin` 탭 조건부 렌더 (신청관리/설정 숨김)

**Files:**
- Modify: `src/app/admin/page.tsx` (line ~493)

- [ ] **Step 1: 기본 탭 결정 로직 추가**

컴포넌트 본문에 (이미 `defaultValue="users"` 같은 게 있으면 그대로 두되, subadmin도 "users"는 보이므로 변경 불필요. 단 활성 탭 state가 있다면 subadmin이 신청관리/설정으로 진입할 수 없게 처리)

`useState` 형태로 관리 중이라면 (예: `const [tab, setTab] = useState("users")`):
- subadmin이 직접 URL이나 코드로 "applications" 또는 "settings"로 가지 못하도록 `useEffect` 추가:

```ts
useEffect(() => {
  if (adminPerm.isSubadmin && (tab === "applications" || tab === "settings")) {
    setTab("users");
  }
}, [adminPerm.isSubadmin, tab]);
```

(만약 `<Tabs defaultValue="users">` 만 쓰고 state가 없다면 이 단계 생략)

- [ ] **Step 2: TabsList 조건부 렌더**

기존 (line ~493):

```tsx
<TabsList className="grid w-full grid-cols-5 rounded-xl h-11 max-w-2xl shrink-0">
  <TabsTrigger value="users" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">사용자 관리</TabsTrigger>
  <TabsTrigger value="applications" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">신청관리</TabsTrigger>
  <TabsTrigger value="meals" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">석식 확인</TabsTrigger>
  <TabsTrigger value="dashboard" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">당일 현황</TabsTrigger>
  <TabsTrigger value="settings" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">설정</TabsTrigger>
</TabsList>
```

다음으로 교체:

```tsx
<TabsList
  className={`grid w-full ${adminPerm.isSubadmin ? "grid-cols-3" : "grid-cols-5"} rounded-xl h-11 max-w-2xl shrink-0`}
>
  <TabsTrigger value="users" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">사용자 관리</TabsTrigger>
  {!adminPerm.isSubadmin && (
    <TabsTrigger value="applications" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">신청관리</TabsTrigger>
  )}
  <TabsTrigger value="meals" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">석식 확인</TabsTrigger>
  <TabsTrigger value="dashboard" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">당일 현황</TabsTrigger>
  {!adminPerm.isSubadmin && (
    <TabsTrigger value="settings" className="rounded-lg text-xs sm:text-sm whitespace-nowrap">설정</TabsTrigger>
  )}
</TabsList>
```

- [ ] **Step 3: TabsContent도 subadmin인 경우 렌더 안 함**

`<TabsContent value="applications">` 와 `<TabsContent value="settings">` 블록을 각각:

```tsx
{!adminPerm.isSubadmin && (
  <TabsContent value="applications" ...>
    {/* 기존 내용 */}
  </TabsContent>
)}
```

같은 식으로 감싸기.

- [ ] **Step 4: 빌드 + 커밋**

```bash
npm run build
git add src/app/admin/page.tsx
git commit -m "feat(admin): hide applications/settings tabs for subadmin"
```

---

## Task 16: `/admin` 사용자 관리 — 권한 컬럼 + 버튼 가드

**Files:**
- Modify: `src/app/admin/page.tsx`

이 task는 사용자 관리 탭 내부의 변경이 큼. 단계별로 진행.

- [ ] **Step 1: User 타입 확장 (interface나 type 정의가 있다면)**

`src/app/admin/page.tsx` 상단의 User 타입에 `adminLevel` 추가:

```ts
type AdminUser = {
  id: number;
  email: string;
  name: string;
  role: "STUDENT" | "TEACHER";
  grade: number | null;
  classNum: number | null;
  number: number | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
};
```

(기존 타입 명칭이 다르면 그에 맞춰 필드만 추가)

- [ ] **Step 2: "Sheet 연결" 및 "+추가" 버튼 가드**

해당 버튼들을 `{adminPerm.canWrite && ( ... )}` 으로 감싸기. grep으로 위치 확인:

```bash
grep -n "Sheet 연결\|sheet연결\|추가\|+ 추가" src/app/admin/page.tsx
```

각 버튼 JSX를 다음으로 감싸기:

```tsx
{adminPerm.canWrite && (
  <Button ...>Sheet 연결</Button>
)}
{adminPerm.canWrite && (
  <Button ...>+ 추가</Button>
)}
```

- [ ] **Step 3: 행의 수정/삭제 버튼 가드**

행 액션 영역에서:

```tsx
{adminPerm.canWrite && (
  <>
    <Button onClick={...}>수정</Button>
    <Button onClick={...}>삭제</Button>
  </>
)}
```

- [ ] **Step 4: 권한 컬럼 헤더 추가**

테이블 `<thead>` 영역에 마지막 컬럼으로 추가:

```tsx
<TableHead className="whitespace-nowrap">권한</TableHead>
```

- [ ] **Step 5: 권한 컬럼 셀 렌더링 (행)**

테이블 `<tbody>` 의 각 행 마지막에 셀 추가:

```tsx
<TableCell className="whitespace-nowrap">
  {user.role === "STUDENT" ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <select
      value={user.adminLevel}
      disabled={
        !adminPerm.canWrite ||
        (adminPerm.dbUserId === user.id && user.adminLevel === "ADMIN")
      }
      onChange={(e) => handleAdminLevelChange(user, e.target.value as "NONE" | "SUBADMIN" | "ADMIN")}
      className="rounded-md border px-2 py-1 text-sm bg-background disabled:opacity-60"
    >
      <option value="NONE">일반</option>
      <option value="SUBADMIN">서브관리자</option>
      <option value="ADMIN">관리자</option>
    </select>
  )}
</TableCell>
```

- [ ] **Step 6: handleAdminLevelChange 핸들러 추가**

컴포넌트 함수 본문 (handlers 영역)에:

```ts
const labelOf = (lvl: "NONE" | "SUBADMIN" | "ADMIN") =>
  lvl === "ADMIN" ? "관리자" : lvl === "SUBADMIN" ? "서브관리자" : "일반";

const handleAdminLevelChange = async (
  user: AdminUser,
  newLevel: "NONE" | "SUBADMIN" | "ADMIN"
) => {
  if (newLevel === user.adminLevel) return;
  const ok = window.confirm(
    `"${user.name}"의 권한을 "${labelOf(newLevel)}"(으)로 변경하시겠습니까?`
  );
  if (!ok) return;

  const res = await fetch("/api/admin/users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      grade: user.grade,
      classNum: user.classNum,
      number: user.number,
      subject: user.subject,
      homeroom: user.homeroom,
      position: user.position,
      adminLevel: newLevel,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast.error(data?.reason ?? "권한 변경에 실패했습니다.");
    return;
  }
  toast.success(
    "권한 변경 완료. 대상자가 다음 로그인/페이지 새로고침 시 적용됩니다."
  );
  // SWR mutate (useAdminUsers 사용 시)
  mutateUsers?.();
};
```

(`toast`는 `sonner`에서 import: `import { toast } from "sonner";`. `mutateUsers`는 `useAdminUsers()` 훅의 `mutate` 결과. 이미 import/구조분해되어 있는지 확인 후 필요하면 추가.)

- [ ] **Step 7: 빌드 + dev 시각 확인**

```bash
npm run build
npm run dev
```

브라우저에서:
1. 환경변수 admin 로그인 → 사용자 관리 탭 → 권한 컬럼 보임, 교사 행에 드롭다운 활성, Sheet/추가/수정/삭제 버튼 모두 표시
2. 임의 교사를 SUBADMIN으로 변경 후 그 교사로 로그인 → `/teacher`에 "관리자 페이지" 버튼 보임 → `/admin` 진입 → 권한 컬럼 드롭다운이 disabled, Sheet/추가 버튼 안 보임

- [ ] **Step 8: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): add adminLevel column with role dropdown and write guards"
```

---

## Task 17: `AdminMealTable` — `readonly` prop으로 셀 토글 비활성

**Files:**
- Modify: `src/components/AdminMealTable.tsx`
- Modify: `src/app/admin/page.tsx` (AdminMealTable 사용처)

- [ ] **Step 1: AdminMealTable 컴포넌트에 prop 추가**

`src/components/AdminMealTable.tsx` 의 props 타입에 `readonly?: boolean` 추가:

```ts
type Props = {
  refreshKey?: number;
  readonly?: boolean;
};

export default function AdminMealTable({ refreshKey, readonly = false }: Props) {
```

- [ ] **Step 2: 교사 셀 클릭 핸들러를 readonly로 가드**

기존 셀 onClick 핸들러를 찾아서:

```bash
grep -n "PATCH\|toggleType\|onClick.*teacher\|WORK\|PERSONAL" src/components/AdminMealTable.tsx
```

해당 onClick 핸들러를 다음과 같이 변경:

```tsx
onClick={readonly ? undefined : () => handleToggle(...)}
className={`... ${readonly ? "cursor-default" : "cursor-pointer hover:..."} ...`}
```

(기존 hover:bg-... 클래스도 readonly 시 제거)

- [ ] **Step 3: admin/page.tsx에서 readonly prop 전달**

`<AdminMealTable ... />` 사용처에:

```tsx
<AdminMealTable refreshKey={...} readonly={adminPerm.isSubadmin} />
```

- [ ] **Step 4: 빌드 + 시각 확인**

```bash
npm run build
npm run dev
```

브라우저에서 subadmin 교사로 `/admin` → 석식 확인 탭 → 교사 셀 클릭해도 변화 없음, hover 효과 없음. Excel 다운로드 버튼은 보이고 동작.

- [ ] **Step 5: 커밋**

```bash
git add src/components/AdminMealTable.tsx src/app/admin/page.tsx
git commit -m "feat(admin-meal-table): add readonly mode disabling teacher cell toggle"
```

---

## Task 18: 당일 현황 — 교사 개인/근무 토글 비활성

**Files:**
- Modify: `src/app/admin/page.tsx`

`/admin`의 dashboard 탭에서 교사 체크인 행의 "근무/개인" 변경 컨트롤을 subadmin이면 비활성화.

- [ ] **Step 1: 위치 파악**

```bash
grep -n "dashboard\|teacherRecords\|WORK\|PERSONAL" src/app/admin/page.tsx | head -30
```

당일 현황 탭(`<TabsContent value="dashboard">`) 내부에서 교사 type 변경 컨트롤(셀렉트 또는 버튼)이 있는 위치 확인.

- [ ] **Step 2: 컨트롤을 가드**

해당 컨트롤(예: select/button)에 `disabled={adminPerm.isSubadmin}` 추가, onClick에 `if (adminPerm.isSubadmin) return;` 가드 추가:

```tsx
<select
  value={record.type}
  disabled={adminPerm.isSubadmin}
  onChange={(e) => {
    if (adminPerm.isSubadmin) return;
    handleTypeChange(record.id, e.target.value);
  }}
  className="... disabled:opacity-60 disabled:cursor-not-allowed"
>
  ...
</select>
```

(실제 컨트롤 형태에 맞춰 구현)

- [ ] **Step 3: 빌드 + 시각 확인**

```bash
npm run build
npm run dev
```

subadmin 계정으로 `/admin` → 당일 현황 → 교사 행의 type 컨트롤 disabled.

- [ ] **Step 4: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin-dashboard): disable teacher type toggle for subadmin"
```

---

## Task 19: 통합 수동 검증

자동 테스트가 없으므로 마지막에 spec §10 체크리스트를 모두 수행.

- [ ] **Step 1: dev 서버 + 시드 데이터 준비**

```bash
docker compose up -d
npx prisma migrate deploy
npm run dev
```

테스트용 사용자가 부족하면 `/admin`에서 환경변수 admin으로 교사 2명 추가 (한 명은 admin 권한 부여 예정, 다른 한 명은 subadmin 부여 예정).

- [ ] **Step 2: 체크리스트 수행**

브라우저에서 각각 확인:

1. 일반 교사 로그인 → `/teacher`에 "관리자 페이지" 버튼 **없음**
2. Admin 교사 로그인 → 버튼 있음 → `/admin` 진입 → 5개 탭 + 모든 버튼/컬럼 노출
3. Subadmin 교사 로그인 → 버튼 있음 → `/admin` 진입 → 탭 3개(사용자관리/석식확인/당일현황), 사용자 관리 탭에 Sheet/추가/수정/삭제 버튼 없음, 권한 드롭다운 disabled, 석식확인 셀 클릭 무반응, 당일현황 교사 토글 disabled
4. Subadmin 세션에서 curl 호출 차단 확인 (브라우저 DevTools 또는 터미널):

   ```bash
   # 브라우저 쿠키를 가져온 후
   curl -X POST http://localhost:3000/api/admin/users \
     -H "Content-Type: application/json" \
     -H "Cookie: <세션쿠키>" \
     -d '{"email":"x@x","name":"x","role":"STUDENT"}' \
     -i
   ```
   기대: HTTP/1.1 403 Forbidden

5. Admin 본인 권한 강등 시도: 본인 행의 드롭다운 disabled. DevTools에서 직접 PUT 호출 → 400 + reason "본인의 관리자 권한은…"
6. Admin이 학생 행에 드롭다운 시도: 학생 행에는 `—` 표시. DevTools에서 직접 PUT 호출 (학생 id + adminLevel: "ADMIN") → 400 + reason "학생에게는…"
7. 환경변수 admin 로그인: 5개 탭 모두 노출, 헤더에 "최고관리자" 배지, "교사 페이지로" 링크 **없음**
8. Admin이 교사 A를 SUBADMIN→ADMIN 변경 → 교사 A 세션 새로고침 → 모든 탭 노출 확인

- [ ] **Step 3: 모든 항목 통과 확인 후 최종 정리 커밋 (변경 사항 없으면 skip)**

체크리스트 진행 중 발견된 사소한 수정만 추가 커밋. 큰 문제는 해당 task로 돌아가 수정.

---

## 마지막 단계: 배포 흐름

1. main 브랜치에 모든 커밋 push:

   ```bash
   git push origin main
   ```

2. Railway test 환경(만약 main 연결돼 있다면)에서 동작 확인. (현재 운영은 `feat/posanmeal-mvp`, main은 테스트로 역할 교체됨.)

3. 안정화 후 `feat/posanmeal-mvp`로 머지하여 운영에 반영:

   ```bash
   git checkout feat/posanmeal-mvp
   git pull
   git merge main
   git push origin feat/posanmeal-mvp
   ```

   Railway가 `prisma migrate deploy` 자동 실행하여 운영 DB에 enum + 컬럼 추가. 기본값 `NONE`이므로 기존 사용자 영향 없음.

4. 첫 admin 교사 부여: 환경변수 admin으로 운영 `/admin` 로그인 → 사용자 관리에서 대상 교사를 ADMIN으로 변경.
