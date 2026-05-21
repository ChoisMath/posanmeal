# 학생 성별 입력 및 신청자 학년·성별 통계 시트 — 설계

> 작성일: 2026-05-21
> 관련 페이지: `/admin` (사용자 관리, 신청 공고 export)

## 1. 배경 / 목표

급식(석식·조식) 신청자 수 집계에서 **여학생이 남학생보다 적게 먹는 경향**을 반영해 준비할 양을 조정하려는 운영 요구가 있다.

이를 위해:

1. 학생의 **성별** 정보를 관리자가 입력·관리할 수 있게 한다.
2. 신청 공고의 **신청자 명단 Excel** 다운로드에 학년·성별 인원 통계 시트를 추가한다.

본 변경은 교사 사용자에게는 옵셔널, 학생에게는 비즈니스 로직 레벨 필수로 적용한다.

## 2. 범위

### 포함
- `User.gender` Prisma enum 필드 추가 (nullable)
- 관리자 사용자 관리 UI 변경 (목록 표 컬럼·등록/편집 모달·시트 임포트 모달 안내)
- `/api/admin/users` POST/PUT 검증·저장
- `/api/admin/import` 학생 시트 6번째 열 `gender` 파싱·검증·upsert
- `/api/admin/applications/[id]/export` 신청명단 모드에 통계 시트 추가
- 단위 테스트 (`normalizeGender`, 통계 집계)

### 범위 밖
- `/api/users/me` (학생/교사 본인 프로필) — gender 노출/수정 안 함
- `/api/teacher/students` (담임용 학생 목록) — 변경 없음
- 월별 체크인 Excel (`/api/admin/export`) — 변경 없음
- 일괄 신청 양식 다운로드 (`?template=true`) — 변경 없음
- 학생 측 UI에서 성별 표시 — 안 함
- 신청 공고 일괄 등록 양식 (`/applications/[id]/import|export?template=true`) — 변경 없음

## 3. 결정사항 요약

| # | 결정 | 근거 |
|---|---|---|
| 1 | 학생 필수 / 교사 옵셔널 | 통계 대상은 학생, 교사 데이터는 부수적 |
| 2 | 스키마 표현: Prisma `Gender` enum (`MALE`, `FEMALE`) | 타입 안전·DB 레벨 값 검증·기존 `Role`/`MealKind` 패턴과 일치 |
| 3 | DB 컬럼은 영구 nullable | 기존 학생 backfill 기간 보호·DB 공유 마이그레이션 안전 |
| 4 | 통계 탭 세분화: 학년 소계만 | 급식 양 조사 목적에 가장 적합, 모바일/모달 가독성 우수 |
| 5 | 입력 경로: 관리자 UI + 시트 임포트(학생만) | 운영 워크플로 둘 다 일관 |
| 6 | 학생 목록 표에 성별 컬럼 추가 + 편집 모달 라디오 | 미입력 학생 식별·일관된 UX |
| 7 | 신청명단 export(기본 모드)에만 통계 시트 추가 | 일괄 신청 양식은 입력용이라 통계 부적합 |
| 8 | 본인 프로필(`/api/users/me`)에는 노출 안 함 | 학적 정보 성격, 관리자 권한으로 일원화 |

## 4. 데이터 모델

### 4-1. Prisma 스키마 변경 (`prisma/schema.prisma`)

```prisma
enum Gender {
  MALE
  FEMALE
}

model User {
  // ... (기존 필드)
  gender    Gender?
  // ... (기존 인덱스 그대로)
}
```

### 4-2. 마이그레이션 SQL

파일: `prisma/migrations/<ts>_add_user_gender/migration.sql`

```sql
-- 새 enum 타입 (additive)
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- nullable 컬럼 추가, 기본값 없음 → 기존 행 자동 NULL
ALTER TABLE "User" ADD COLUMN "gender" "Gender";
```

### 4-3. 마이그레이션 안전성 (DB 공유 환경)

| 항목 | 평가 |
|---|---|
| `CREATE TYPE "Gender"` | additive — 옛 코드 무영향 |
| `ALTER TABLE ADD COLUMN ... NULL` | additive — 기존 행 자동 NULL, 옛 코드는 명시한 select에만 의존하므로 무영향 |
| NOT NULL · rename · drop · type change | **없음** |

→ `feat/posanmeal-mvp` 먼저 push해도 prod에 영향 없음. `prisma-migration-guardian` 에이전트로 사전 검수.

## 5. 헬퍼 모듈 (`src/lib/gender.ts` 신규)

```ts
import { Gender } from "@/generated/prisma";

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "남",
  FEMALE: "여",
};

export function genderLabel(g: Gender | null | undefined): string {
  return g ? GENDER_LABEL[g] : "—";
}

export type NormalizeResult = "MALE" | "FEMALE" | null | "INVALID";

export function normalizeGender(raw: string | undefined | null): NormalizeResult {
  if (raw == null) return null;
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (["남", "M", "MALE", "BOY"].includes(v)) return "MALE";
  if (["여", "F", "FEMALE", "GIRL"].includes(v)) return "FEMALE";
  return "INVALID";
}
```

## 6. API 라우트 변경

### 6-1. `GET /api/admin/users`

`select`에 `gender: true` 추가. 응답 타입에 `gender: "MALE" | "FEMALE" | null` 포함.

### 6-2. `POST /api/admin/users` (신규 등록)

학생 검증 (inline):

```ts
if (body.role === "STUDENT" && !(body.gender === "MALE" || body.gender === "FEMALE")) {
  return NextResponse.json(
    { error: "Bad Request", reason: "학생은 성별을 선택해야 합니다." },
    { status: 400 }
  );
}
```

교사는 값 형식만 검증(허용: `"MALE" | "FEMALE" | null | undefined`), 강제 안 함.

`prisma.user.create({ data: { ..., gender: body.gender ?? null } })`.

### 6-3. `PUT /api/admin/users` (수정)

- `body.gender === undefined` → 변경 없음 (`...(body.gender !== undefined ? { gender: body.gender } : {})`)
- 대상이 STUDENT 인데 `body.gender === null` → 거부 ("학생의 성별은 비울 수 없습니다.")
- 대상이 STUDENT 인데 `body.gender === "MALE" | "FEMALE"` → 허용

→ 결과: 학생의 gender는 한 번 채우면 null로 되돌릴 수 없으며, 다른 필드만 수정할 때(`body.gender === undefined`)는 통과.

**클라이언트 페이로드 규약:** 편집 모달의 저장 핸들러는 학생 수정 시 `gender` 키를 페이로드에 항상 포함시킨다 (값은 `"MALE"`/`"FEMALE"`, 미선택이면 클라이언트 측에서 저장 차단). 모달 외부의 다른 경로(예: 권한 토글)가 PUT을 호출할 때는 `gender` 키를 보내지 않아 `undefined`로 들어오게 한다.

### 6-4. `/api/users/me` (본인 프로필)

**변경 없음.** 응답·요청 어디에도 gender를 포함하지 않는다.

### 6-5. `/api/admin/import` 학생 시트 처리

CSV 파싱 시 6번째 열 `gender` 추가:

```ts
const [email, grade, classNum, number, name, genderRaw] = row;
```

사전 유효성 검사에 추가 (행 단위 에러 누적):

```ts
const g = normalizeGender(genderRaw);
if (g === "INVALID") rowErrors.push(`${rowNum}행: ${email} — 성별 값을 인식할 수 없습니다 (남/여)`);
if (g === null)      rowErrors.push(`${rowNum}행: ${email} — 성별이 비어 있습니다 (학생 필수)`);
```

upsert (성별 검증 통과 후 `parsedGender: "MALE" | "FEMALE"`):

```ts
prisma.user.upsert({
  where: { email },
  update: { name, grade, classNum, number, gender: parsedGender },
  create: { email, name, role: "STUDENT", grade, classNum, number, gender: parsedGender },
})
```

→ 시트가 권위 있는 데이터 소스가 된다. UI에서 backfill한 값도 시트 재임포트 시 일관되게 유지.

교사 시트 처리는 변경 없음.

### 6-6. `/api/admin/applications/[id]/export` (신청명단 모드)

#### 6-6-1. 데이터 쿼리 수정

기존 `registrations`의 `user.select`에 `gender: true` 추가. 추가 쿼리 없음.

#### 6-6-2. 통계 시트 추가

기본 모드(`?template=true`가 아닐 때)에 두 번째 시트 `"통계"` 추가.

레이아웃:

| 행 | A | B | C | D |
|---|---|---|---|---|
| 1 | (머지 A1:D1) `{title} 학년·성별 신청자 수` | | | |
| 3 | 학년 | 남 | 여 | 합계 |
| 4 | 1학년 | n | n | n |
| 5 | 2학년 | n | n | n |
| 6 | 3학년 | n | n | n |
| 7 | 전체 | n | n | n |
| 9 | * 성별 미입력 학생 N명은 합계에 포함되며 남/여 어느 쪽에도 집계되지 않습니다. (N=0이면 행 생략) | | | |

- 컬럼 폭: `[10, 8, 8, 10]`
- 헤더 행(3행) 배경 `argb: "FFFFD580"` (앰버 미디엄), bold, 가운데
- 합계 행(7행) 배경 `argb: "FFFFE9B3"` (앰버 라이트), bold

#### 6-6-3. 집계 로직

```ts
const counts: Record<1 | 2 | 3, { MALE: number; FEMALE: number; NONE: number }> = {
  1: { MALE: 0, FEMALE: 0, NONE: 0 },
  2: { MALE: 0, FEMALE: 0, NONE: 0 },
  3: { MALE: 0, FEMALE: 0, NONE: 0 },
};
let other = 0;
for (const reg of registrations) {
  const g = reg.user.grade;
  if (g !== 1 && g !== 2 && g !== 3) { other++; continue; }
  const key = reg.user.gender ?? "NONE";
  counts[g][key]++;
}
const totalMissing = counts[1].NONE + counts[2].NONE + counts[3].NONE;
// 각 학년 합계 = MALE + FEMALE + NONE
// 전체 합계   = 1·2·3학년 모든 카테고리 합 (other 제외)
```

학년이 1·2·3 외인 신청자는 본 통계 대상이 아니지만 보통 발생하지 않으며 발생 시 9행 위에 추가 주석으로 안내한다.

#### 6-6-4. 일괄 신청 양식 모드 (`?template=true`)

변경 없음 (입력용 양식이라 통계 부적합).

## 7. 관리자 UI 변경 (`src/app/admin/page.tsx`)

### 7-1. 학생 목록 표

기존 헤더 뒤에 "성별" 컬럼 추가. 셀 값: `genderLabel(user.gender)`. 미입력 행은 `text-muted-foreground` 회색.

- 헤더·셀 모두 `whitespace-nowrap`
- 표 래퍼 `overflow-x-auto` 유지
- 교사 탭에서는 컬럼 미렌더

### 7-2. 학생 신규 등록 / 편집 모달

폼에 라디오 그룹 추가:

```
성별 *
( ) 남   ( ) 여
```

- 학생 신규/수정 시 미선택 저장 시도 → "성별을 선택해주세요" 토스트로 거부
- 기존(null) 학생 수정: 라디오 미선택 상태로 시작 → 선택 후 저장
- 터치 타겟 `min-h-11` (responsive-ui §6 준수)

### 7-3. 교사 편집 모달

같은 라디오 그룹을 보이되 "선택 해제" 옵션 제공. 빈 채로 저장 가능.

### 7-4. 시트 임포트 모달

```diff
 const sheetImportGuides = [
-  { label: "학생", columns: ["email", "grade", "classNum", "number", "name"] },
+  { label: "학생", columns: ["email", "grade", "classNum", "number", "name", "gender"] },
   { label: "교사", columns: ["email", "subject", "homeroom", "position", "name"] },
 ] as const;
```

추가 안내문 두 줄(박스 하단, `text-xs text-muted-foreground`):

> `gender` 열은 학생만 필수입니다. "남" 또는 "여"로 입력하세요. (M/F·male/female 도 허용)
>
> ⚠️ 기존 시트를 사용 중이라면 가장 오른쪽에 `gender` 열을 추가하고 학생별 값을 채운 뒤 가져오기 해주세요.

## 8. 테스트

### 8-1. 단위 테스트 (`src/lib/__tests__/gender.test.ts` 신규)

- `normalizeGender` 입력 매트릭스: `"남"`, `"여"`, `"M"`, `"F"`, `"MALE"`, `"FEMALE"`, `"boy"`, `" 남 "`, `""`, `null`, `undefined`, `"?"`, `"남자"`
- 통계 집계 헬퍼(라우트에서 추출 가능하면 추출): 빈 신청자, 1·2·3학년 mix + null + INVALID grade

### 8-2. 수동 검증 (test 도메인)

UI:
- [ ] 학생 신규 등록 — 성별 미선택 저장 시도 거부
- [ ] 학생 신규 등록 — 남/여 선택 후 저장 → 표 반영
- [ ] 기존(null) 학생 편집 — 미선택 저장 시도 거부, 선택 후 저장 OK
- [ ] 교사 편집 — 성별 빈 채 저장 OK
- [ ] 학생 표 가로 스크롤 정상, sticky 컬럼 깨짐 없음
- [ ] 시트 임포트 모달 안내 row 마지막 칩이 `gender`

시트 임포트:
- [ ] 6열짜리 시트(남/여) → 임포트 성공
- [ ] 5열짜리 옛 시트 → 모든 학생 행이 "성별이 비어 있습니다" 행 에러로 거부
- [ ] 인식 불가 값("남자") → INVALID 행 에러
- [ ] 재임포트 → 기존 학생 gender도 정상 update

Excel:
- [ ] 신청자 있는 공고 → "신청명단" 다운로드 → 시트 2개 (신청명단, 통계)
- [ ] 통계 시트: 1·2·3학년 × 남/여/합계 + 전체 합계 일치
- [ ] 성별 미입력 학생 존재 → 9행 주석 노출, 없으면 9행 생략
- [ ] 일괄 신청 양식(`?template=true`) → 통계 시트 **없음**

회귀:
- [ ] `/api/admin/export` (월별 체크인) 변경 없음 확인
- [ ] `/api/users/me` 응답에 gender 없음 확인
- [ ] `/api/teacher/students` 변경 없음 확인

## 9. 배포 순서 (DB 공유 환경 안전 절차)

1. 모든 변경을 `feat/posanmeal-mvp` 한 PR에 묶어서 push
2. test 서비스 빌드 시작 → `prisma migrate deploy`로 enum + 컬럼 생성
3. 이 시점:
   - test 도메인 (posanmeal.up.railway.app): 새 코드 + 새 스키마 ✅
   - prod 도메인 (meal.posan.kr): 옛 코드 + 새 스키마 — gender 컬럼을 명시 select 하지 않으므로 무영향 ✅
4. test 도메인에서 §8-2 시나리오 검증
5. 검증 통과 후 `main` 머지/fast-forward → push → prod 배포
6. 운영 잡일 (prod 배포 직후 관리자):
   - 학생 Spreadsheet 가장 오른쪽 열에 `gender` 추가하고 값 입력
   - 또는 관리자 UI에서 학생별 backfill
   - backfill 완료 전까지 신청자 명단 통계 시트에 "성별 미입력 N명" 주석 노출 (정상)

## 10. 롤백

| 시나리오 | 절차 |
|---|---|
| 코드만 되돌리기 | 코드 revert. enum/컬럼은 DB에 남겨두면 옛 코드가 무시함. 다음 배포에서 재사용 가능 |
| DB까지 되돌리기 (비권장) | 별도 마이그레이션: `ALTER TABLE "User" DROP COLUMN "gender"; DROP TYPE "Gender";`. 데이터 손실 |

## 11. 변경 파일 목록 (요약)

| 카테고리 | 파일 | 변경 |
|---|---|---|
| 스키마 | `prisma/schema.prisma` | enum + `gender` 컬럼 |
| 마이그레이션 | `prisma/migrations/<ts>_add_user_gender/migration.sql` | 신규 |
| 헬퍼 | `src/lib/gender.ts` | 신규 (label · normalize) |
| API | `src/app/api/admin/users/route.ts` | select·POST·PUT |
| API | `src/app/api/admin/import/route.ts` | 학생 파싱·검증·upsert |
| API | `src/app/api/admin/applications/[id]/export/route.ts` | 통계 시트 |
| UI | `src/app/admin/page.tsx` | `sheetImportGuides`·표 컬럼·모달 라디오·검증 |
| 테스트 | `src/lib/__tests__/gender.test.ts` | 신규 |
| 프로젝트 맵 | `.claude/PROJECT_MAP.md` | `project-map-updater`로 갱신 |

## 12. 후속 에이전트 호출 (구현 단계)

| 시점 | 에이전트 |
|---|---|
| 마이그레이션 SQL 작성 직후, `migrate dev` 실행 전 | `prisma-migration-guardian` |
| UI 변경 작성 직후 | `responsive-ui-reviewer` |
| 모든 변경 완료 후 | `project-map-updater` |
