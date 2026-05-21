# Student Gender + Grade-by-Gender Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생 `gender` 필드(`MALE`/`FEMALE`)를 추가하고 관리자 UI/시트 임포트로 입력 받아, 신청자 명단 Excel에 학년·성별 통계 시트를 출력한다.

**Architecture:** Prisma `Gender` enum nullable 컬럼 (additive 마이그레이션) + 클라이언트/서버 양쪽 학생 필수 검증 + 시트 임포트 6번째 열 정규화 + `applications/[id]/export` 신청명단 모드에 두 번째 시트 추가. DB 공유 환경이라 NOT NULL/rename/drop 없이 진행.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + adapter-pg, PostgreSQL(Railway), exceljs, Vitest, shadcn/ui + base-ui, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-21-student-gender-stats-design.md`

---

## File Structure

| 파일 | 책임 | 변경 종류 |
|---|---|---|
| `prisma/schema.prisma` | `User.gender` + `Gender` enum | modify |
| `prisma/migrations/<ts>_add_user_gender/migration.sql` | additive 마이그레이션 | create |
| `src/lib/gender.ts` | 라벨·정규화 헬퍼 (서버·클라이언트 공용) | create |
| `src/lib/__tests__/gender.test.ts` | 헬퍼 단위 테스트 | create |
| `src/app/api/admin/users/route.ts` | GET select / POST·PUT 검증·저장 | modify |
| `src/app/api/admin/import/route.ts` | 학생 시트 6번째 열 파싱·검증·upsert | modify |
| `src/app/api/admin/applications/[id]/export/route.ts` | 통계 시트 추가 (기본 모드만) | modify |
| `src/app/admin/page.tsx` | `User` 타입·`emptyForm`·`sheetImportGuides`·표·라디오·검증 | modify |
| `.claude/PROJECT_MAP.md` | gender 헬퍼·User 필드 반영 | modify (별도 에이전트) |

---

## Task 1: Gender 헬퍼 모듈 + 단위 테스트

**Files:**
- Create: `src/lib/gender.ts`
- Create: `src/lib/__tests__/gender.test.ts`

- [ ] **Step 1: 단위 테스트 작성 (failing)**

`src/lib/__tests__/gender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeGender, genderLabel, GENDER_LABEL } from "@/lib/gender";

describe("normalizeGender", () => {
  it("한글 남/여를 매핑한다", () => {
    expect(normalizeGender("남")).toBe("MALE");
    expect(normalizeGender("여")).toBe("FEMALE");
  });

  it("영문 약어 M/F를 매핑한다", () => {
    expect(normalizeGender("M")).toBe("MALE");
    expect(normalizeGender("F")).toBe("FEMALE");
    expect(normalizeGender("m")).toBe("MALE");
    expect(normalizeGender("f")).toBe("FEMALE");
  });

  it("영문 단어 MALE/FEMALE/BOY/GIRL을 매핑한다", () => {
    expect(normalizeGender("MALE")).toBe("MALE");
    expect(normalizeGender("FEMALE")).toBe("FEMALE");
    expect(normalizeGender("Male")).toBe("MALE");
    expect(normalizeGender("female")).toBe("FEMALE");
    expect(normalizeGender("BOY")).toBe("MALE");
    expect(normalizeGender("girl")).toBe("FEMALE");
  });

  it("공백 패딩을 무시한다", () => {
    expect(normalizeGender("  남  ")).toBe("MALE");
    expect(normalizeGender("\t여\n")).toBe("FEMALE");
  });

  it("빈 값/공백/null/undefined는 null을 반환한다", () => {
    expect(normalizeGender("")).toBe(null);
    expect(normalizeGender("   ")).toBe(null);
    expect(normalizeGender(null)).toBe(null);
    expect(normalizeGender(undefined)).toBe(null);
  });

  it("인식 불가 값은 INVALID를 반환한다", () => {
    expect(normalizeGender("?")).toBe("INVALID");
    expect(normalizeGender("남자")).toBe("INVALID");
    expect(normalizeGender("X")).toBe("INVALID");
    expect(normalizeGender("기타")).toBe("INVALID");
  });
});

describe("genderLabel", () => {
  it("enum 값을 한글로 변환한다", () => {
    expect(genderLabel("MALE")).toBe("남");
    expect(genderLabel("FEMALE")).toBe("여");
  });

  it("null/undefined는 dash를 반환한다", () => {
    expect(genderLabel(null)).toBe("—");
    expect(genderLabel(undefined)).toBe("—");
  });
});

describe("GENDER_LABEL", () => {
  it("enum 키 매핑이 일관된다", () => {
    expect(GENDER_LABEL.MALE).toBe("남");
    expect(GENDER_LABEL.FEMALE).toBe("여");
  });
});
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

Run:
```
npx vitest run src/lib/__tests__/gender.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/gender'`

- [ ] **Step 3: 구현**

`src/lib/gender.ts`:

```ts
export type Gender = "MALE" | "FEMALE";
export type NormalizeResult = Gender | null | "INVALID";

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "남",
  FEMALE: "여",
};

export function genderLabel(g: Gender | null | undefined): string {
  return g ? GENDER_LABEL[g] : "—";
}

export function normalizeGender(raw: string | null | undefined): NormalizeResult {
  if (raw == null) return null;
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (["남", "M", "MALE", "BOY"].includes(v)) return "MALE";
  if (["여", "F", "FEMALE", "GIRL"].includes(v)) return "FEMALE";
  return "INVALID";
}
```

> 참고: 이 시점에서는 Prisma generate 전이라 `@/generated/prisma`의 `Gender`를 import할 수 없다. 헬퍼는 string literal union으로 정의하고 Task 2 이후 라우트에서 Prisma 타입과 호환되게 사용한다 (두 타입은 동일한 string union).

- [ ] **Step 4: 테스트 실행 (통과)**

Run:
```
npx vitest run src/lib/__tests__/gender.test.ts
```
Expected: PASS — 모든 it 통과

- [ ] **Step 5: 커밋**

```
git add src/lib/gender.ts src/lib/__tests__/gender.test.ts
git commit -m "feat(lib): add gender label and normalizer helpers"
```

---

## Task 2: Prisma 스키마 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_add_user_gender/migration.sql`

- [ ] **Step 1: schema.prisma 수정**

`prisma/schema.prisma` enum 블록 사이에 추가 (`AdminLevel` 위/아래 어디든, 권장: `MealKind` 다음 줄):

```prisma
enum Gender {
  MALE
  FEMALE
}
```

`model User { ... }` 안의 필드 목록에서 `photoUrl  String?` 다음에 추가:

```prisma
  gender    Gender?
```

저장 후 schema는 다음 구간이 포함된 상태가 된다 (인덱스·관계는 그대로):

```prisma
enum MealKind {
  BREAKFAST
  DINNER
}

enum Gender {
  MALE
  FEMALE
}

enum AdminLevel {
  NONE
  SUBADMIN
  ADMIN
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  role      Role
  grade     Int?
  classNum  Int?
  number    Int?
  subject   String?
  homeroom  String?
  position  String?
  photoUrl  String?
  gender    Gender?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  adminLevel AdminLevel @default(NONE)
  ...
}
```

- [ ] **Step 2: 마이그레이션 검수 (prisma-migration-guardian)**

스키마 변경 직후, `prisma migrate dev` 실행 전에 `prisma-migration-guardian` 에이전트를 호출하여 안전성 점검:

> 작업 내용: `prisma/schema.prisma` 에 `Gender` enum과 `User.gender Gender?` 를 추가했습니다. DB 공유 환경(Railway prod ↔ test 동일 PostgreSQL)이며 nullable + 기본값 없음으로 additive 마이그레이션입니다. 위험 패턴(NOT NULL 추가 / rename / drop / FK cascade) 점검 부탁드립니다.

예상 결과: PASS (additive only).

- [ ] **Step 3: 마이그레이션 생성**

Run:
```
npx prisma migrate dev --name add_user_gender --create-only
```

Expected output: `prisma/migrations/<ts>_add_user_gender/migration.sql` 파일 생성. 생성된 SQL이 다음과 일치하는지 확인:

```sql
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gender" "Gender";
```

다르게 생성되었다면 SQL을 위 형태로 수정 (Prisma 7이 동일 SQL을 만들어줄 가능성 높음).

- [ ] **Step 4: 로컬 적용 + 클라이언트 생성**

Run:
```
npx prisma migrate dev
npx prisma generate
```

Expected: 마이그레이션 적용 메시지 + `src/generated/prisma` 재생성. `User` 타입에 `gender: Gender | null` 포함 확인:

```
npx tsc --noEmit
```
Expected: 기존 TS 컴파일 통과 (User에 gender 추가됐지만 아직 어디서도 select하지 않음).

- [ ] **Step 5: 커밋**

```
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add nullable Gender enum on User"
```

---

## Task 3: `/api/admin/users` — gender 읽기·쓰기·검증

**Files:**
- Modify: `src/app/api/admin/users/route.ts`

- [ ] **Step 1: GET select 변경**

`src/app/api/admin/users/route.ts` 의 `GET` 함수 안 `prisma.user.findMany` 호출의 `select` 객체에 한 줄 추가:

```diff
   select: {
     id: true, email: true, name: true, role: true,
     grade: true, classNum: true, number: true,
     subject: true, homeroom: true, position: true,
     adminLevel: true,
+    gender: true,
   },
```

- [ ] **Step 2: POST 검증·저장 변경**

같은 파일 `POST` 함수를 다음으로 교체:

```ts
export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // gender 값 형식 검증
  if (
    body.gender !== undefined &&
    body.gender !== null &&
    body.gender !== "MALE" &&
    body.gender !== "FEMALE"
  ) {
    return NextResponse.json(
      { error: "Bad Request", reason: "유효하지 않은 성별 값입니다." },
      { status: 400 }
    );
  }

  // 학생은 성별 필수
  if (body.role === "STUDENT" && body.gender !== "MALE" && body.gender !== "FEMALE") {
    return NextResponse.json(
      { error: "Bad Request", reason: "학생은 성별을 선택해야 합니다." },
      { status: 400 }
    );
  }

  const user = await prisma.user.create({
    data: {
      email: body.email, name: body.name, role: body.role,
      grade: body.grade || null, classNum: body.classNum || null, number: body.number || null,
      subject: body.subject || null, homeroom: body.homeroom || null, position: body.position || null,
      gender: body.gender ?? null,
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}
```

- [ ] **Step 3: PUT 검증·저장 변경**

같은 파일 `PUT` 함수에서 기존 `adminLevel` 검증 블록 **아래**, `prisma.user.update` 호출 **위**에 새 검증 블록 추가:

```ts
  // gender 값 형식 검증 (undefined = 변경 안 함)
  if (
    body.gender !== undefined &&
    body.gender !== null &&
    body.gender !== "MALE" &&
    body.gender !== "FEMALE"
  ) {
    return NextResponse.json(
      { error: "Bad Request", reason: "유효하지 않은 성별 값입니다." },
      { status: 400 }
    );
  }

  // 학생은 gender를 null로 되돌릴 수 없음
  if (body.gender === null) {
    const t = await prisma.user.findUnique({
      where: { id: body.id },
      select: { role: true },
    });
    if (t?.role === "STUDENT") {
      return NextResponse.json(
        { error: "Bad Request", reason: "학생의 성별은 비울 수 없습니다." },
        { status: 400 }
      );
    }
  }
```

그리고 같은 함수의 `prisma.user.update` 호출에서 `data` 객체 마지막에 추가:

```diff
     data: {
       email: body.email, name: body.name,
       grade: body.grade, classNum: body.classNum, number: body.number,
       subject: body.subject, homeroom: body.homeroom, position: body.position,
       ...(body.adminLevel !== undefined ? { adminLevel: body.adminLevel } : {}),
+      ...(body.gender !== undefined ? { gender: body.gender } : {}),
     },
```

- [ ] **Step 4: 타입 컴파일 확인**

Run:
```
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: 커밋**

```
git add src/app/api/admin/users/route.ts
git commit -m "feat(api): admin users CRUD reads and validates gender"
```

---

## Task 4: `/api/admin/import` — 학생 시트 gender 파싱·검증·upsert

**Files:**
- Modify: `src/app/api/admin/import/route.ts`

- [ ] **Step 1: 학생 시트 처리 블록 교체**

`src/app/api/admin/import/route.ts`에서 `if (studentSheetUrl)` 블록 안의 처리 부분 (대략 `const validRows = ...` 부터 `studentCount = validRows.length;` 까지)을 다음으로 교체:

```ts
    if (studentSheetUrl) {
      const { rows, error } = await fetchSheet(studentSheetUrl, "학생");
      if (error) {
        errors.push(error);
      } else {
        const validRows = rows.slice(1).filter(([email, , , , name]) => email && name);

        if (validRows.length === 0) {
          errors.push("학생 시트에서 유효한 데이터를 찾을 수 없습니다. email과 name 열을 확인하세요.");
        } else {
          const rowErrors: string[] = [];
          const parsed: Array<{
            email: string; name: string; grade: number; classNum: number; number: number;
            gender: "MALE" | "FEMALE";
          }> = [];

          for (let i = 0; i < validRows.length; i++) {
            const [email, grade, classNum, number, name, genderRaw] = validRows[i];
            const rowNum = i + 2;

            if (isNaN(parseInt(grade)) || isNaN(parseInt(classNum)) || isNaN(parseInt(number))) {
              rowErrors.push(`${rowNum}행: ${email} — 학년/반/번호가 숫자가 아닙니다`);
              continue;
            }

            const g = normalizeGender(genderRaw);
            if (g === "INVALID") {
              rowErrors.push(`${rowNum}행: ${email} — 성별 값을 인식할 수 없습니다 (남/여)`);
              continue;
            }
            if (g === null) {
              rowErrors.push(`${rowNum}행: ${email} — 성별이 비어 있습니다 (학생 필수)`);
              continue;
            }

            parsed.push({
              email, name,
              grade: parseInt(grade), classNum: parseInt(classNum), number: parseInt(number),
              gender: g,
            });
          }

          if (rowErrors.length > 0) {
            errors.push("학생 데이터 오류:\n" + rowErrors.slice(0, 5).join("\n") +
              (rowErrors.length > 5 ? `\n...외 ${rowErrors.length - 5}건` : ""));
          } else {
            const upsertedUsers: { id: number }[] = [];
            for (const batch of chunk(parsed, BATCH_SIZE)) {
              const results = await Promise.all(
                batch.map((p) =>
                  prisma.user.upsert({
                    where: { email: p.email },
                    update: { name: p.name, grade: p.grade, classNum: p.classNum, number: p.number, gender: p.gender },
                    create: { email: p.email, name: p.name, role: "STUDENT", grade: p.grade, classNum: p.classNum, number: p.number, gender: p.gender },
                  })
                )
              );
              upsertedUsers.push(...results);
            }

            studentCount = parsed.length;
          }
        }
      }
    }
```

- [ ] **Step 2: import 라인 추가**

파일 상단 import 블록에 한 줄 추가:

```ts
import { normalizeGender } from "@/lib/gender";
```

- [ ] **Step 3: 컴파일 확인**

Run:
```
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: 커밋**

```
git add src/app/api/admin/import/route.ts
git commit -m "feat(api): require and parse student gender in sheet import"
```

---

## Task 5: `/api/admin/applications/[id]/export` — 통계 시트

**Files:**
- Modify: `src/app/api/admin/applications/[id]/export/route.ts`

- [ ] **Step 1: registrations include에 gender 추가**

해당 파일에서 `prisma.mealRegistration.findMany` 호출의 `include.user.select`에 `gender: true` 추가:

```diff
       include: {
-        user: { select: { id: true, name: true, grade: true, classNum: true, number: true } },
+        user: { select: { id: true, name: true, grade: true, classNum: true, number: true, gender: true } },
       },
```

- [ ] **Step 2: 통계 시트 생성 코드 추가**

기본 모드(`isTemplate`이 아닐 때) 시트 작성이 끝나는 부분 (`for (const reg of registrations) { ... }` 루프 직후, `const buffer = await workbook.xlsx.writeBuffer();` 호출 **이전**) 에 다음 블록 추가:

```ts
    // 통계 시트
    const stats = workbook.addWorksheet("통계");
    stats.mergeCells(1, 1, 1, 4);
    const statsTitle = stats.getCell(1, 1);
    statsTitle.value = `${application.title} 학년·성별 신청자 수`;
    statsTitle.font = { bold: true, size: 14 };
    statsTitle.alignment = { horizontal: "center" };

    const statsHeader = stats.getRow(3);
    ["학년", "남", "여", "합계"].forEach((h, i) => {
      const cell = statsHeader.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD580" } };
    });
    [10, 8, 8, 10].forEach((w, i) => { stats.getColumn(i + 1).width = w; });

    type GradeKey = 1 | 2 | 3;
    const counts: Record<GradeKey, { MALE: number; FEMALE: number; NONE: number }> = {
      1: { MALE: 0, FEMALE: 0, NONE: 0 },
      2: { MALE: 0, FEMALE: 0, NONE: 0 },
      3: { MALE: 0, FEMALE: 0, NONE: 0 },
    };
    let other = 0;
    for (const reg of registrations) {
      const g = reg.user.grade;
      if (g !== 1 && g !== 2 && g !== 3) { other++; continue; }
      const key: "MALE" | "FEMALE" | "NONE" = reg.user.gender ?? "NONE";
      counts[g as GradeKey][key]++;
    }

    let r = 4;
    let totalMale = 0, totalFemale = 0, totalNone = 0;
    for (const grade of [1, 2, 3] as GradeKey[]) {
      const row = stats.getRow(r++);
      row.getCell(1).value = `${grade}학년`;
      row.getCell(2).value = counts[grade].MALE;
      row.getCell(3).value = counts[grade].FEMALE;
      row.getCell(4).value = counts[grade].MALE + counts[grade].FEMALE + counts[grade].NONE;
      [2, 3, 4].forEach((c) => { row.getCell(c).alignment = { horizontal: "center" }; });
      totalMale += counts[grade].MALE;
      totalFemale += counts[grade].FEMALE;
      totalNone += counts[grade].NONE;
    }
    const totalRow = stats.getRow(r++);
    totalRow.getCell(1).value = "전체";
    totalRow.getCell(2).value = totalMale;
    totalRow.getCell(3).value = totalFemale;
    totalRow.getCell(4).value = totalMale + totalFemale + totalNone;
    [1, 2, 3, 4].forEach((c) => {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE9B3" } };
      if (c >= 2) cell.alignment = { horizontal: "center" };
    });

    if (totalNone > 0) {
      const noteRow = stats.getRow(r + 1);
      stats.mergeCells(noteRow.number, 1, noteRow.number, 4);
      const note = noteRow.getCell(1);
      note.value = `* 성별 미입력 학생 ${totalNone}명은 합계에 포함되며 남/여 어느 쪽에도 집계되지 않습니다.`;
      note.font = { italic: true, color: { argb: "FF888888" } };
    }
    if (other > 0) {
      const noteRow2 = stats.getRow(r + 2);
      stats.mergeCells(noteRow2.number, 1, noteRow2.number, 4);
      const note2 = noteRow2.getCell(1);
      note2.value = `* 학년 미지정 ${other}명은 통계에서 제외되었습니다.`;
      note2.font = { italic: true, color: { argb: "FF888888" } };
    }
```

> 주의: `isTemplate` 블록에는 추가하지 않는다 (일괄 신청 양식에는 통계 시트 없음).

- [ ] **Step 3: 컴파일 확인**

Run:
```
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: 커밋**

```
git add src/app/api/admin/applications/[id]/export/route.ts
git commit -m "feat(api): add grade-by-gender stats sheet to application export"
```

---

## Task 6: 관리자 페이지 UI — 표 컬럼·라디오·시트 가이드

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: `User` 타입과 `emptyForm` 확장**

파일 상단 `interface User { ... }` 블록 끝에 한 줄 추가:

```diff
 interface User {
   id: number; email: string; name: string; role: string;
   grade?: number; classNum?: number; number?: number;
   subject?: string; homeroom?: string; position?: string;
   adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
+  gender?: "MALE" | "FEMALE" | null;
 }
```

`emptyForm` 객체에 `gender` 키 추가:

```diff
 const emptyForm = {
   role: "STUDENT" as "STUDENT" | "TEACHER",
   email: "", name: "", grade: "", classNum: "", number: "",
   subject: "", homeroom: "", position: "",
+  gender: "" as "" | "MALE" | "FEMALE",
 };
```

`sheetImportGuides` 학생 row 변경:

```diff
 const sheetImportGuides = [
-  { label: "학생", columns: ["email", "grade", "classNum", "number", "name"] },
+  { label: "학생", columns: ["email", "grade", "classNum", "number", "name", "gender"] },
   { label: "교사", columns: ["email", "subject", "homeroom", "position", "name"] },
 ] as const;
```

`genderLabel` import 추가 (파일 상단 다른 `@/lib/*` import 옆):

```ts
import { genderLabel } from "@/lib/gender";
```

- [ ] **Step 2: 학생 목록 표 헤더·셀에 성별 컬럼**

표 thead 부분 (`<th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>` 가 있는 행) 의 권한 컬럼 **앞에** 학생 탭일 때만 렌더되는 헤더 추가:

```diff
                       <tr>
                         <th className="p-2 text-left bg-muted">이름</th>
                         <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}</th>
                         <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "이메일" : "직책"}</th>
+                        {userFilter === "STUDENT" && (
+                          <th className="p-2 text-left bg-muted whitespace-nowrap">성별</th>
+                        )}
                         <th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>
                         <th className="p-2 text-center w-24 bg-muted">관리</th>
                       </tr>
```

표 tbody의 각 행 (`<tr key={u.id} className="border-t">` 안) 에서, "이메일/직책" 셀 다음 + 권한 셀 앞에 학생 탭 셀 추가:

```diff
                         <td className="p-2">{u.role === "STUDENT" ? u.email : u.position || "-"}</td>
+                        {userFilter === "STUDENT" && (
+                          <td className="p-2 whitespace-nowrap">
+                            {u.gender ? (
+                              <span>{genderLabel(u.gender)}</span>
+                            ) : (
+                              <span className="text-muted-foreground">—</span>
+                            )}
+                          </td>
+                        )}
                         <td className="p-2 whitespace-nowrap">
                           {u.role === "STUDENT" ? (
                             <span className="text-muted-foreground">—</span>
                           ) : (
```

- [ ] **Step 3: 학생 추가 모달에 성별 라디오**

Add User Dialog 안 `{addForm.role === "STUDENT" && (` 블록의 학년/반/번호 grid 다음에 추가:

```diff
             {addForm.role === "STUDENT" && (
               <>
                 <div className="grid grid-cols-3 gap-2">
                   <div><Label>학년</Label><Input type="number" value={addForm.grade} onChange={(e) => setAddForm({ ...addForm, grade: e.target.value })} /></div>
                   <div><Label>반</Label><Input type="number" value={addForm.classNum} onChange={(e) => setAddForm({ ...addForm, classNum: e.target.value })} /></div>
                   <div><Label>번호</Label><Input type="number" value={addForm.number} onChange={(e) => setAddForm({ ...addForm, number: e.target.value })} /></div>
                 </div>
+                <div>
+                  <Label>성별 *</Label>
+                  <div className="flex gap-4 mt-1">
+                    <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                      <input
+                        type="radio"
+                        name="add-gender"
+                        value="MALE"
+                        checked={addForm.gender === "MALE"}
+                        onChange={() => setAddForm({ ...addForm, gender: "MALE" })}
+                      />
+                      <span>남</span>
+                    </label>
+                    <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                      <input
+                        type="radio"
+                        name="add-gender"
+                        value="FEMALE"
+                        checked={addForm.gender === "FEMALE"}
+                        onChange={() => setAddForm({ ...addForm, gender: "FEMALE" })}
+                      />
+                      <span>여</span>
+                    </label>
+                  </div>
+                </div>
               </>
             )}
```

- [ ] **Step 4: 교사 추가 모달 분기에 옵셔널 라디오 추가**

Add User Dialog 안 기존 `{addForm.role === "TEACHER" && (<>...</>)}` 블록 (subject/homeroom/position Input 3개가 있는 블록) 의 `position` Input 줄 다음, 닫는 `</>` 직전에 추가:

```diff
             {addForm.role === "TEACHER" && (
               <>
                 <div><Label>교과명</Label><Input value={addForm.subject} onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })} /></div>
                 <div><Label>담임 (예: 2-6)</Label><Input value={addForm.homeroom} onChange={(e) => setAddForm({ ...addForm, homeroom: e.target.value })} /></div>
                 <div><Label>직책</Label><Input value={addForm.position} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} /></div>
+                <div>
+                  <Label>성별 (선택)</Label>
+                  <div className="flex items-center gap-4 mt-1">
+                    <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                      <input
+                        type="radio"
+                        name="add-gender"
+                        value="MALE"
+                        checked={addForm.gender === "MALE"}
+                        onChange={() => setAddForm({ ...addForm, gender: "MALE" })}
+                      />
+                      <span>남</span>
+                    </label>
+                    <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                      <input
+                        type="radio"
+                        name="add-gender"
+                        value="FEMALE"
+                        checked={addForm.gender === "FEMALE"}
+                        onChange={() => setAddForm({ ...addForm, gender: "FEMALE" })}
+                      />
+                      <span>여</span>
+                    </label>
+                    <button
+                      type="button"
+                      className="text-xs text-muted-foreground underline"
+                      onClick={() => setAddForm({ ...addForm, gender: "" })}
+                    >
+                      선택 해제
+                    </button>
+                  </div>
+                </div>
               </>
             )}
```

- [ ] **Step 5: 편집 모달에도 동일 라디오 (학생 필수 + 교사 옵셔널)**

Edit User Dialog의 `{editUser.role === "STUDENT" && (<>...</>)}` 블록 안 grid 다음에 Step 3 코드와 동일 구조를 추가하되 `addForm`→`editForm`, `setAddForm`→`setEditForm`, `name="add-gender"`→`name="edit-gender"` 로 치환:

```diff
               {editUser.role === "STUDENT" && (
                 <>
                   <div className="grid grid-cols-3 gap-2">
                     <div><Label>학년</Label><Input type="number" value={editForm.grade} onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })} /></div>
                     <div><Label>반</Label><Input type="number" value={editForm.classNum} onChange={(e) => setEditForm({ ...editForm, classNum: e.target.value })} /></div>
                     <div><Label>번호</Label><Input type="number" value={editForm.number} onChange={(e) => setEditForm({ ...editForm, number: e.target.value })} /></div>
                   </div>
+                  <div>
+                    <Label>성별 *</Label>
+                    <div className="flex gap-4 mt-1">
+                      <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                        <input
+                          type="radio"
+                          name="edit-gender"
+                          value="MALE"
+                          checked={editForm.gender === "MALE"}
+                          onChange={() => setEditForm({ ...editForm, gender: "MALE" })}
+                        />
+                        <span>남</span>
+                      </label>
+                      <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                        <input
+                          type="radio"
+                          name="edit-gender"
+                          value="FEMALE"
+                          checked={editForm.gender === "FEMALE"}
+                          onChange={() => setEditForm({ ...editForm, gender: "FEMALE" })}
+                        />
+                        <span>여</span>
+                      </label>
+                    </div>
+                  </div>
                 </>
               )}
```

그리고 교사 분기 (`{editUser.role === "TEACHER" && (<>...</>)}`) `position` Input 줄 다음, 닫는 `</>` 직전에 Step 4 옵셔널 라디오 코드를 동일 치환으로 추가:

```diff
               {editUser.role === "TEACHER" && (
                 <>
                   <div><Label>교과명</Label><Input value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} /></div>
                   <div><Label>담임 (예: 2-6)</Label><Input value={editForm.homeroom} onChange={(e) => setEditForm({ ...editForm, homeroom: e.target.value })} /></div>
                   <div><Label>직책</Label><Input value={editForm.position} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} /></div>
+                  <div>
+                    <Label>성별 (선택)</Label>
+                    <div className="flex items-center gap-4 mt-1">
+                      <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                        <input
+                          type="radio"
+                          name="edit-gender"
+                          value="MALE"
+                          checked={editForm.gender === "MALE"}
+                          onChange={() => setEditForm({ ...editForm, gender: "MALE" })}
+                        />
+                        <span>남</span>
+                      </label>
+                      <label className="flex items-center gap-2 min-h-11 cursor-pointer">
+                        <input
+                          type="radio"
+                          name="edit-gender"
+                          value="FEMALE"
+                          checked={editForm.gender === "FEMALE"}
+                          onChange={() => setEditForm({ ...editForm, gender: "FEMALE" })}
+                        />
+                        <span>여</span>
+                      </label>
+                      <button
+                        type="button"
+                        className="text-xs text-muted-foreground underline"
+                        onClick={() => setEditForm({ ...editForm, gender: "" })}
+                      >
+                        선택 해제
+                      </button>
+                    </div>
+                  </div>
                 </>
               )}
```

- [ ] **Step 6: 추가/편집 페이로드에 gender 포함 + 클라이언트 검증**

`handleAddUser` 함수 교체:

```ts
  async function handleAddUser() {
    if (addForm.role === "STUDENT" && addForm.gender !== "MALE" && addForm.gender !== "FEMALE") {
      toast.error("학생은 성별을 선택해야 합니다.");
      return;
    }

    const body: Record<string, unknown> = { role: addForm.role, email: addForm.email, name: addForm.name };
    if (addForm.role === "STUDENT") {
      body.grade = parseInt(addForm.grade); body.classNum = parseInt(addForm.classNum);
      body.number = parseInt(addForm.number);
    } else {
      body.subject = addForm.subject; body.homeroom = addForm.homeroom; body.position = addForm.position;
    }
    body.gender = addForm.gender === "" ? null : addForm.gender;

    await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setAddDialogOpen(false);
    setAddForm({ ...emptyForm });
    fetchUsers();
  }
```

> 기존 코드에 백슬래시로 잘못 적혀 있는 fetch URL (`"\api\admin\users"`)도 함께 정상 슬래시 (`"/api/admin/users"`)로 수정한다.

`handleEditUser` 함수도 동일하게 교체:

```ts
  async function handleEditUser() {
    if (!editUser) return;
    if (editUser.role === "STUDENT" && editForm.gender !== "MALE" && editForm.gender !== "FEMALE") {
      toast.error("학생은 성별을 선택해야 합니다.");
      return;
    }

    const body: Record<string, unknown> = { id: editUser.id, name: editForm.name, email: editForm.email };
    if (editUser.role === "STUDENT") {
      body.grade = parseInt(editForm.grade); body.classNum = parseInt(editForm.classNum);
      body.number = parseInt(editForm.number);
    } else {
      body.subject = editForm.subject; body.homeroom = editForm.homeroom; body.position = editForm.position;
    }
    body.gender = editForm.gender === "" ? null : editForm.gender;

    await fetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setEditDialogOpen(false);
    setEditUser(null);
    fetchUsers();
  }
```

`toast`는 이미 sonner를 통해 다른 위치에서 import되어 있을 것이다. 없다면 `import { toast } from "sonner";` 한 줄 추가.

- [ ] **Step 7: `openEditDialog`에서 기존 gender를 폼에 채우기**

`openEditDialog` 함수의 `setEditForm` 호출 객체 끝에 한 줄 추가:

```diff
   function openEditDialog(user: User) {
     setEditUser(user);
     setEditForm({
       role: user.role as "STUDENT" | "TEACHER",
       email: user.email,
       name: user.name,
       grade: user.grade?.toString() || "",
       classNum: user.classNum?.toString() || "",
       number: user.number?.toString() || "",
       subject: user.subject || "",
       homeroom: user.homeroom || "",
       position: user.position || "",
+      gender: user.gender ?? "",
     });
     setEditDialogOpen(true);
   }
```

- [ ] **Step 8: 시트 임포트 모달 안내문 추가**

`{sheetImportGuides.map((guide) => (...))}` 가 들어 있는 div 블록 **다음 줄**, 박스를 닫는 `</div>` 들 사이에 작은 안내문 두 줄:

```diff
               <div className="mt-3 space-y-2">
                 {sheetImportGuides.map((guide) => (
                   ...
                 ))}
               </div>
+              <p className="mt-3 text-xs text-muted-foreground">
+                <code>gender</code> 열은 학생만 필수입니다. &quot;남&quot; 또는 &quot;여&quot;로 입력하세요. (M/F·male/female 도 허용)
+              </p>
+              <p className="mt-1 text-xs text-muted-foreground">
+                ⚠️ 기존 시트를 사용 중이라면 가장 오른쪽에 <code>gender</code> 열을 추가하고 학생별 값을 채운 뒤 가져오기 해주세요.
+              </p>
             </div>
```

- [ ] **Step 9: 타입 컴파일 확인**

Run:
```
npx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 10: 반응형 UI 검수 (responsive-ui-reviewer)**

`responsive-ui-reviewer` 에이전트를 호출:

> 작업 내용: `src/app/admin/page.tsx` 학생 목록 표에 "성별" 컬럼을 추가하고, 학생/교사 추가·편집 모달에 라디오 버튼 그룹을 넣었습니다. 시트 임포트 모달 안내 박스에 안내문 2개를 추가했습니다. 모바일 가로 스크롤·sticky·터치 타겟·줄바꿈 규칙 위반 점검 부탁드립니다.

지적사항이 있으면 인라인 수정 후 다음 단계.

- [ ] **Step 11: 개발 서버 수동 검증**

Run:
```
npm run dev
```

검증:
- [ ] 학생 추가 모달 → 성별 미선택 저장 시도 → 토스트 거부
- [ ] 학생 추가 모달 → 남 또는 여 선택 → 저장 → 표 새로고침 후 해당 학생 행에 "남"/"여" 표시
- [ ] 기존(gender 없는) 학생 편집 모달 열기 → 라디오 미선택 상태 → 저장 시도 → 토스트 거부
- [ ] 기존 학생 편집 → 라디오 선택 → 저장 OK → 표 갱신
- [ ] 교사 추가/편집 모달 → 성별 빈 채 저장 OK → 표에는 성별 컬럼 없음 (교사 탭이므로)
- [ ] 시트 임포트 모달 헤더 박스에 학생 row 마지막 칩이 `gender`로 표시, 안내문 2개 노출

- [ ] **Step 12: 커밋**

```
git add src/app/admin/page.tsx
git commit -m "feat(admin): show and require student gender in user management UI"
```

---

## Task 7: PROJECT_MAP.md 동기화

**Files:**
- Modify: `.claude/PROJECT_MAP.md`

- [ ] **Step 1: `project-map-updater` 에이전트 호출**

> 작업 내용:
> - `prisma/schema.prisma`: `Gender` enum 추가, `User.gender Gender?` 필드 추가
> - `src/lib/gender.ts` 신규 (label·normalize 헬퍼)
> - `src/lib/__tests__/gender.test.ts` 신규 (단위 테스트)
> - `src/app/api/admin/users/route.ts` POST/PUT 에 gender 검증·저장 추가
> - `src/app/api/admin/import/route.ts` 학생 시트 6번째 열 `gender` 파싱·검증·upsert
> - `src/app/api/admin/applications/[id]/export/route.ts` 신청명단 모드에 "통계" 시트 추가
> - `src/app/admin/page.tsx` 학생 목록 표 성별 컬럼·모달 라디오·시트 가이드 갱신

§2 의존성, §6 데이터 모델 (User · Enums), §8 lib 파일, §12 주의사항에 반영.

- [ ] **Step 2: 갱신된 PROJECT_MAP 검토 후 커밋**

```
git add .claude/PROJECT_MAP.md
git commit -m "docs(project-map): note User.gender field, gender helper, stats sheet"
```

---

## Task 8: test 도메인 배포 검증

**Files:** (코드 변경 없음)

- [ ] **Step 1: 전체 브랜치 푸시**

```
git push origin feat/posanmeal-mvp
```

Railway test 서비스가 자동 빌드 시작. 빌드 로그에서 `prisma migrate deploy` 가 새 마이그레이션을 적용하는지 확인.

- [ ] **Step 2: prod 도메인 영향 확인**

prod (`meal.posan.kr`) 가 정상 응답하는지 확인:

```
curl -sI https://meal.posan.kr | head -5
```

prod 옛 코드가 새 컬럼을 무시하므로 정상 동작해야 한다.

- [ ] **Step 3: test 도메인 수동 검증**

`https://posanmeal.up.railway.app` 관리자 로그인 후:

- [ ] 사용자 관리 학생 탭에 "성별" 컬럼 표시
- [ ] 기존 학생 1명 편집 → 성별 채우기 → 저장 → 표 반영
- [ ] 새 학생 1명 추가 → 성별 필수 검증 동작
- [ ] (선택) 학생 시트 6번째 열에 `gender` 추가한 테스트용 시트로 임포트 → 정상 반영
- [ ] 신청자 있는 공고 → 신청명단 Excel 다운로드 → 2개 시트, "통계" 시트 수치 일치
- [ ] 일괄 신청 양식(`?template=true`) Excel 다운로드 → "통계" 시트 **없음**

- [ ] **Step 4: 사용자 확인 후 main 머지**

위 시나리오 모두 통과하면 사용자에게 보고 후 main 머지 승인 받기. 승인 후:

```
git checkout main
git merge --ff-only feat/posanmeal-mvp
git push origin main
git checkout feat/posanmeal-mvp
```

Railway prod 서비스 자동 배포 → `meal.posan.kr` 반영.

- [ ] **Step 5: 운영 안내 (코드 작업 외)**

배포 직후 사용자(관리자)에게 안내:
- 학생 Spreadsheet 가장 오른쪽에 `gender` 열 추가하고 값 입력 권장
- 또는 관리자 UI에서 학생별 backfill
- backfill 완료 전까지 신청자 명단 통계 시트에 "성별 미입력 N명" 주석 노출됨
