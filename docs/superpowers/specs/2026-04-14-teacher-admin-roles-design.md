# 교사 관리자/서브관리자 권한 — 설계 스펙

- **작성일**: 2026-04-14
- **상태**: 승인됨 (구현 대기)
- **대상 브랜치**: `main` (테스트), 안정화 후 `feat/posanmeal-mvp`(운영) 머지
- **관련 PROJECT_MAP 섹션**: §6 Schema, §9 Auth & Middleware, §4 Pages, §5 API

## 1. 배경 및 목표

현재 PosanMeal의 권한 모델:
- `Role` enum: `STUDENT | TEACHER` (DB), 세션 role: `STUDENT | TEACHER | ADMIN`
- `ADMIN`은 환경변수(`ADMIN_USERNAME`/`ADMIN_PASSWORD`) credentials provider 전용 — DB 표현 없음
- 교사 내부 분기: `User.homeroom` 유무로 담임/비담임만 구분

요구: **교사에게 admin/subadmin 관리 권한을 부여**하여 `/admin` 페이지를 사용할 수 있게 한다.
- **admin (교사)**: 환경변수 admin과 동일한 모든 권한
- **subadmin (교사)**: `/admin` 진입 가능, 단 데이터 읽기 + 월별 Excel 다운로드까지만 허용. 모든 쓰기 차단.

환경변수 admin은 그대로 유지되며(공존), 비상복구/최고관리자 역할.

## 2. 데이터 모델

### 2.1 스키마 변경 (`prisma/schema.prisma`)

```prisma
enum AdminLevel {
  NONE       // 일반 (default)
  SUBADMIN   // 서브관리자: /admin 읽기 + Excel 다운로드
  ADMIN      // 관리자: /admin 전체 권한
}

model User {
  // 기존 필드 …
  adminLevel AdminLevel @default(NONE)

  @@index([role, grade, classNum, number])
  @@index([role, adminLevel])
}
```

### 2.2 마이그레이션

- 새 마이그레이션 파일: `<timestamp>_add_admin_level_to_user/migration.sql`
  - `CREATE TYPE "AdminLevel" AS ENUM ('NONE', 'SUBADMIN', 'ADMIN');`
  - `ALTER TABLE "User" ADD COLUMN "adminLevel" "AdminLevel" NOT NULL DEFAULT 'NONE';`
  - `CREATE INDEX "User_role_adminLevel_idx" ON "User"("role", "adminLevel");`
- 기존 모든 사용자는 `NONE`으로 기본 채워짐 → 호환 안전.

### 2.3 무결성 규칙 (애플리케이션 레벨)

- `role === "STUDENT"` 인 사용자에게 `adminLevel ∈ {SUBADMIN, ADMIN}` 부여 시도 → API 400 거부.
- DB CHECK 제약은 추가하지 않음 (단순화).
- 환경변수 admin은 DB 행 없음 → 세션 콜백에서 가상 `adminLevel: "ADMIN"` 주입.

## 3. 인증 / 세션 / 미들웨어

### 3.1 세션 토큰 구조

```ts
// JWT token / session.user
{
  role: "STUDENT" | "TEACHER" | "ADMIN",
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN",
  dbUserId: number,
}
```

### 3.2 `src/auth.ts`

- **`signIn` (Google)**: `prisma.user.findUnique`의 `select`에 `adminLevel` 포함:
  ```ts
  select: { id: true, role: true, adminLevel: true }
  ```
  → `(user as any).dbAdminLevel = dbUser.adminLevel`
- **`jwt` 콜백**:
  - Google 로그인 시: `token.adminLevel = (user as any).dbAdminLevel`
  - admin-login(환경변수) 시: `token.adminLevel = "ADMIN"`
  - **권한 변경 즉시 반영하지 않음** — 세션 캐시 사용. 대상자가 다음 페이지 새로고침/이동 시 새 토큰 발급되며 반영(NextAuth 기본 동작).
- **`session` 콜백**: `session.user.adminLevel = token.adminLevel`

### 3.3 타입 (`src/types/next-auth.d.ts` 또는 동등)

```ts
declare module "next-auth" {
  interface Session {
    user: {
      role: string;
      dbUserId: number;
      adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
    } & DefaultSession["user"];
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

### 3.4 `src/middleware.ts`

```ts
const role = session.user?.role;
const adminLevel = session.user?.adminLevel ?? "NONE";

const isAdminAccess =
  role === "ADMIN" ||
  (role === "TEACHER" && (adminLevel === "ADMIN" || adminLevel === "SUBADMIN"));

// /admin 페이지 게이트
if (
  pathname.startsWith("/admin") &&
  !pathname.startsWith("/admin/login") &&
  !isAdminAccess
) {
  return NextResponse.redirect(new URL("/admin/login", req.url));
}

// /api/admin API 게이트 (subadmin 진입은 허용, 쓰기는 각 핸들러에서 차단)
if (pathname.startsWith("/api/admin") && !isAdminAccess) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

- 기존 STUDENT/TEACHER 게이트는 변경 없음.
- 미들웨어는 진입(read)만 게이트. 쓰기 차단은 각 API 핸들러에서.

### 3.5 권한 헬퍼 — `src/lib/permissions.ts` (신규)

```ts
import type { Session } from "next-auth";

export type EffectiveLevel = "NONE" | "SUBADMIN" | "ADMIN";

export function getEffectiveAdminLevel(session: Session | null): EffectiveLevel {
  if (!session?.user) return "NONE";
  if (session.user.role === "ADMIN") return "ADMIN"; // 환경변수 admin
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

### 3.6 클라이언트 권한 훅 — `src/hooks/useAdminPermission.ts` (신규)

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

## 4. API 권한 매트릭스

| 메서드 + 경로 | env admin / 교사 admin | 교사 subadmin |
|---|:---:|:---:|
| `GET /api/admin/users` | ✅ | ✅ |
| `POST /api/admin/users` | ✅ | ❌ 403 |
| `PUT /api/admin/users` | ✅ | ❌ 403 |
| `DELETE /api/admin/users` | ✅ | ❌ 403 |
| `POST /api/admin/import` | ✅ | ❌ 403 |
| `GET /api/admin/applications` | ✅ | ❌ 403 |
| `POST /api/admin/applications` | ✅ | ❌ 403 |
| `PUT /api/admin/applications/[id]` | ✅ | ❌ 403 |
| `DELETE /api/admin/applications/[id]` | ✅ | ❌ 403 |
| `POST /api/admin/applications/[id]/close` | ✅ | ❌ 403 |
| `GET /api/admin/applications/[id]/registrations` | ✅ | ❌ 403 |
| `POST /api/admin/applications/[id]/registrations` | ✅ | ❌ 403 |
| `PATCH /api/admin/applications/[id]/registrations/[regId]` | ✅ | ❌ 403 |
| `GET /api/admin/applications/[id]/export` | ✅ | ❌ 403 |
| `POST /api/admin/applications/[id]/import` | ✅ | ❌ 403 |
| `GET /api/admin/checkins` | ✅ | ✅ |
| `PATCH /api/admin/checkins` | ✅ | ❌ 403 |
| `GET /api/admin/dashboard` | ✅ | ✅ |
| `GET /api/admin/export` (월별 Excel) | ✅ | ✅ |
| `PUT /api/system/settings` | ✅ | ❌ 403 |
| `GET /api/sync/download` | ✅ | ❌ 403 |
| `POST /api/sync/upload` | ✅ | ❌ 403 |

각 핸들러 도입부 패턴:

```ts
const session = await auth();
if (!canWriteAdmin(session)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**가드 적용 규칙** — 위 매트릭스에서 ✅/❌가 admin/subadmin 간 갈리는 모든 엔드포인트에 `canWriteAdmin` 가드를 명시적으로 추가한다. HTTP 메서드와 무관하게 매트릭스가 단일 진실 소스. 미들웨어는 진입 게이트(admin/subadmin 모두 통과)만 담당.

구체적으로 subadmin이 ❌인 GET 엔드포인트도 핸들러에서 `canWriteAdmin` 가드가 필요하다:
- `GET /api/admin/applications`
- `GET /api/admin/applications/[id]/registrations`
- `GET /api/admin/applications/[id]/export`
- `GET /api/sync/download`

subadmin이 ✅인 엔드포인트(`GET /api/admin/users`, `GET /api/admin/checkins`, `GET /api/admin/dashboard`, `GET /api/admin/export`)는 미들웨어 `isAdminAccess` 게이트만으로 충분.

### 4.1 `PUT /api/admin/users` 의 `adminLevel` 변경 검증

요청 본문에 `adminLevel` 필드가 포함된 경우:

1. **호출자 권한**: `canWriteAdmin(session)` 통과해야 함 (subadmin 막힘)
2. **대상이 학생이면 거부**: 대상 User의 `role === "STUDENT"` 이고 새 `adminLevel !== "NONE"` 이면 400
3. **자기 자신 강등 금지**: `session.user.dbUserId === targetUserId` 이고 호출자가 현재 ADMIN(`canWriteAdmin` 통과)인데 새 값이 NONE 또는 SUBADMIN이면 400
   - 환경변수 admin은 `dbUserId === 0` 이라 본인 자신이 DB에 없으므로 자동 면제
4. **마지막 admin 보호 미적용**: 환경변수 admin이 안전망

400 응답 형식: `{ error: "Bad Request", reason: "<한국어 메시지>" }`

## 5. UI 변경

### 5.1 `/teacher` 헤더

`adminLevel !== "NONE"` 인 교사에게 "관리자 페이지" 버튼 노출 (`useAdminPermission().canRead && isTeacher`). 클릭 시 `/admin` 이동.

### 5.2 `/admin` 헤더

```
[BrandMark]   {displayName} · {badgeLabel}    [교사 페이지로]? [테마] [로그아웃]
```

- `displayName` + `badgeLabel`: `useAdminPermission()` 사용
- "교사 페이지로 돌아가기" 링크: `isTeacher === true` 인 경우만 노출 (환경변수 admin은 숨김)
- 로그아웃: 기존 동작 (`/`로 이동, 세션 종료)

### 5.3 `/admin` 탭 가시성

| 탭 | env admin / 교사 admin | 교사 subadmin |
|---|:---:|:---:|
| 사용자 관리 | ✅ (전체) | ✅ (제한 모드) |
| 신청 관리 | ✅ | ❌ 숨김 |
| 석식 확인 | ✅ | ✅ (셀 토글 비활성) |
| 당일 현황 | ✅ | ✅ (교사 토글 비활성) |
| 설정 | ✅ | ❌ 숨김 |

`<TabsList>` 에서 권한별 조건부 렌더. 기본 활성 탭은 가시 탭 중 첫 번째.

### 5.4 사용자 관리 탭

**Admin 모드**:
- 새 컬럼 "권한" (교사 행만 드롭다운, 학생 행은 `—`)
  - 옵션: `일반` / `서브관리자` / `관리자`
  - 변경 시 confirm 다이얼로그: `"[홍길동]" 의 권한을 "[관리자]"로 변경하시겠습니까?`
  - 확인 시 `PUT /api/admin/users` 호출 (`{ id, adminLevel }`)
  - 성공 toast: `권한 변경 완료. 대상자가 다음 로그인/페이지 새로고침 시 적용됩니다.`
  - 실패(400/403) toast: 서버 reason 표시 + 드롭다운 원복
- **자기 자신 행의 드롭다운은 disabled** (`useAdminPermission().dbUserId === user.id` 인 경우)
- 환경변수 admin은 DB 없으므로 목록에 등장하지 않음 (정상)

**Subadmin 모드**:
- "Sheet 연결", "+추가" 버튼 숨김
- 행의 "수정"/"삭제" 버튼 숨김
- 권한 컬럼 드롭다운: `disabled` (값만 표시)

### 5.5 석식 확인 탭

- `AdminMealTable` 컴포넌트에 `readonly?: boolean` prop 추가 (또는 `useAdminPermission` 직접 호출)
- `readonly === true` (subadmin) 시:
  - 교사 셀의 onClick 핸들러 no-op
  - cursor 기본값 (pointer 제거)
  - 시각적 호버 효과 제거
- Excel 다운로드 버튼: 항상 표시

### 5.6 당일 현황 탭

- 교사의 "근무/개인" 변경 컨트롤 (현재 admin/page.tsx 내 dashboard 섹션에 위치)
- subadmin 시 컨트롤을 disabled 또는 정적 텍스트로 렌더

## 6. 에러 처리

- **API 403**: `{ error: "Forbidden" }` — 클라이언트는 toast 후 페이지 유지(redirect 없음)
- **API 400 (권한 변경 검증 실패)**: `{ error: "Bad Request", reason: "<한국어>" }` — toast 표시 + UI 원복
- **권한 변경 즉시 반영 안 됨**: 의도된 동작. admin에게 toast로 "다음 로그인/새로고침 시 적용" 안내.

## 7. 엣지케이스

| 상황 | 처리 |
|---|---|
| Admin 교사가 본인을 강등 시도 | 드롭다운 disabled (UI). API에서도 400 거부 (서버). |
| Admin이 학생에게 권한 부여 시도 | 학생 행에 권한 컬럼 미노출 (UI). API에서도 400 거부. |
| Admin이 다른 admin 교사를 강등 | 허용. (마지막 admin 보호 없음 — 환경변수 admin이 안전망) |
| Subadmin이 권한 변경 API 직접 호출 | 403. |
| 권한 변경 후 대상자가 현재 로그인 중 | 다음 페이지 이동/새로고침 시 자동 반영. |
| Subadmin이 URL 직접 입력으로 `/admin` 진입 | 미들웨어 통과 → 페이지 진입 OK. 탭/버튼이 숨겨진 모드로 표시. |
| Subadmin이 신청관리 URL fragment 직접 진입 | 탭 자체 미렌더 → 첫 가시 탭으로 fallback. |

## 8. 변경 파일 요약

**Schema/Migration**
- `prisma/schema.prisma`
- `prisma/migrations/<ts>_add_admin_level/migration.sql`

**Auth/Permissions**
- `src/auth.ts`
- `src/middleware.ts`
- `src/types/next-auth.d.ts` (또는 동등 위치)
- `src/lib/permissions.ts` (신규)
- `src/hooks/useAdminPermission.ts` (신규)

**API 핸들러 (쓰기 가드 추가)**
- `src/app/api/admin/users/route.ts` — POST/PUT/DELETE 가드 + adminLevel 검증
- `src/app/api/admin/import/route.ts`
- `src/app/api/admin/applications/route.ts`
- `src/app/api/admin/applications/[id]/route.ts`
- `src/app/api/admin/applications/[id]/close/route.ts`
- `src/app/api/admin/applications/[id]/registrations/route.ts`
- `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`
- `src/app/api/admin/applications/[id]/export/route.ts`
- `src/app/api/admin/applications/[id]/import/route.ts`
- `src/app/api/admin/checkins/route.ts` — PATCH만 가드
- `src/app/api/system/settings/route.ts` — PUT 가드
- `src/app/api/sync/download/route.ts`
- `src/app/api/sync/upload/route.ts`

**UI**
- `src/app/admin/page.tsx` — 헤더(이름·배지·교사페이지 링크), 탭 조건부, 사용자 관리 권한 컬럼, 버튼 조건부
- `src/app/teacher/page.tsx` — 헤더에 "관리자 페이지" 버튼
- `src/components/AdminMealTable.tsx` — `readonly` prop 추가, 셀 토글 비활성

## 9. 마이그레이션 / 배포 순서

1. 로컬에서 마이그레이션 적용 → 빌드/수동 테스트
2. main(테스트 환경)에 푸시 → Railway test 배포 자동 → 검증
3. 안정화 후 feat/posanmeal-mvp(운영)로 머지 → Railway 운영 배포 → `prisma migrate deploy` 자동 실행
4. 첫 admin 교사: 환경변수 admin이 로그인하여 사용자 관리에서 부여

## 10. 수동 검증 체크리스트

1. 일반 교사: `/teacher`에 "관리자 페이지" 버튼 없음
2. Admin 교사: 버튼 있음 → `/admin` 진입 → 모든 탭/버튼 노출
3. Subadmin 교사: 버튼 있음 → `/admin` 진입 → 신청관리/설정 탭 없음, 사용자 관리에 Sheet/추가/수정/삭제 버튼 없음, 셀 클릭 무반응
4. Subadmin이 curl로 `POST /api/admin/users` 호출 → 403
5. Admin이 본인 권한 강등 시도 → 드롭다운 disabled / 강제 호출 시 400
6. Admin이 학생에게 admin 부여 시도 → 컬럼 미노출 / 강제 호출 시 400
7. 환경변수 admin 로그인: 모든 권한, "교사 페이지로" 링크 없음
8. 권한 변경 후 대상자 새로고침 → 새 권한 반영

## 11. 비포함 (YAGNI)

- 권한 변경 감사 로그
- 마지막 admin 보호 (환경변수 admin이 안전망)
- DB CHECK 제약
- subadmin 세부 권한 커스터마이즈 (단일 프리셋만)
- 자동 테스트 스위트 (현재 프로젝트에 인프라 없음)
