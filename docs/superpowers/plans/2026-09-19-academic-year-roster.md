# 학년도별 사용자 관리·Excel 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 사용자와 식사 원본을 보존하면서 학생·교사 통합 Excel, 학년도별 명부·업무, 수동 학년도 전환과 과거 기록 조회를 구현한다.

**Architecture:** 기존 `User.id`를 유지한다. 초안·삭제 가능한 `RosterEntry`, 보존할 `UserAcademicRecord`, 현행 호환 필드의 책임을 분리한다. 잠금은 작업 범위까지만 잡는다(전환·Excel 확정=명부 전역, 셀 편집·계정 변경=사용자 행, 신청·공고=공고 행, 체크인=잠금 없음). 운영 반영은 Release A(스키마·백필·계정 검증·호환 쓰기)와 Release B(기능 공개) 두 번으로 나눈다.

**Tech Stack:** Next.js 16.2.1 App Router, React 19.2.4, TypeScript, Tailwind 4, Prisma 7.6 계열 + PrismaPg/pg, PostgreSQL, Auth.js v5, ExcelJS 4.4 계열, Vitest 4.1 계열. 기존 의존성을 재사용한다.

**Spec:** [승인된 설계](../specs/2026-09-19-academic-year-roster-design.md). 2026-09-19 사용자가 §13을 포함하여 승인했고, 같은 날 계획 검토 뒤 §13의 8~14 개정(§4.3·§4.4·§6.3·§7·§9·§10·§11.3)을 승인했다. 이 계획은 개정본 기준이다.

**현재 상태:** 계획 작성·검토 단계. 아래 체크박스·명령·코드는 앞으로 수행할 작업이며 실행 완료를 뜻하지 않는다. 운영 DB 연결·복원·마이그레이션·배포는 아직 실행하지 않았다.

## Global Constraints

- 기존 `User.id`와 식사 신청·확정일·체크인·얼굴 등록·사진 연결이 유지된다.
- 같은 학년도의 학급 정정은 그 학년도 전체 표시를 바꾸며, 다른 학년도에는 영향을 주지 않는다.
- 명부 삭제가 사용자 삭제나 식사 기록 삭제로 이어지지 않는다.
- 새 학년도 초안을 업로드해도 현재 운영 정보와 접수·체크인은 변하지 않는다.
- 파일 오류나 저장 실패 때문에 학생 또는 교사 일부만 반영되지 않는다.
- 기존 데이터 이전은 별도 DB에서 검증하고, 운영 반영 전후의 원본 보존을 비교한다.
- 현재 자료는 2026학년도이며 학년도는 KST 3월 1일부터 다음 해 2월 말일까지다.
- 모델·임베딩 차원·인식 임계값·얼굴 전처리·QR의 사용자 ID 체계는 변경하지 않는다. `/facecheck`의 기존 2단계(읽기 전용 매칭 → `confirmation` 확인 요청 → 저장)와 `KioskViewport`·`.kiosk-*` 화면 구조를 유지하고 그 위에 검증·표시만 추가한다.
- 이용 중단(졸업·전출·퇴직)과 같은 트랜잭션에서 그 사용자의 `FaceProfile`을 삭제한다. 재학·재직 사용자의 얼굴 등록과 모든 식사 기록·사진은 건드리지 않는다.
- 온라인 체크인과 학생 신청은 명부 전역 잠금(`RosterControl` 행)을 잡지 않는다. 전역 배타 잠금을 잡는 트랜잭션은 행별 쿼리 loop를 쓰지 않고 `createMany`·일괄 raw UPDATE로 처리하며 `{ maxWait: 10_000, timeout: 60_000 }`을 명시한다.
- 명부 사본(업로드 입력·미리보기, 다운로드 대응표, 키오스크 근거, 검토 payload)은 spec §4.4 기간만 보관한다. `RosterMutation.result`에는 건수·ID 요약만 넣는다.
- Google Sheet 원본 및 `code.gs`의 기존 자료는 실행·수정·삭제하지 않는다.
- 학년도 전환·이전 명부 삭제·권한 지정은 별도 credentials 메인 관리자만 수행한다.
- 제품 코드 작성 전 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `05-server-and-client-components.md`, `01-app/02-guides/authentication.md`의 관련 내용을 확인한다. 현재 계획 작성 시 해당 가이드를 확인했다.
- API는 기본 비캐시이며 최신 권한을 서버에서 검사한다. Prisma 공용 인스턴스·기존 KST/date 유틸·`normalizeGender`·ExcelJS·`EditableCell`을 재사용한다.
- 운영과 연결된 `.env`를 테스트의 암묵적 DB 설정으로 사용하지 않는다. `migrate reset`, `db push`, 운영 seed와 사용자 물리 삭제는 이 계획의 명령에 포함하지 않는다.
- 작업별 커밋은 로컬이다. `main` push와 Railway 배포는 Release A·B 각각의 검증 후 별도 운영 실행 절차로 취급한다. Railway 서비스·브랜치 연결은 6월·9월 기록이 서로 달라 미확정이므로 각 Release 전에 읽기 전용으로 확인한다. GitHub Actions는 없다.

## Review Focus

1. **오래된 Excel과 변경된 이메일:** 이전 이메일을 신규 계정으로 조용히 만들지 않는다. 내보내기 원본·행 토큰·버전을 확인하고 충돌을 차단한다. Task 6·7에서 테스트한다.
2. **두 관리자의 동시 변경과 응답 유실:** 전환·셀 편집·일괄 반영·계정 종료가 서로 덮어쓰지 않으며 재요청으로 사용자가 중복 생성되지 않는다. Task 2·7·8에서 실제 DB 동시성 테스트를 한다.
3. **같은 행수의 원본 훼손:** 초기 이전이 `updatedAt`, 서명, 확정일, 얼굴 JSON을 바꿔도 반드시 잡는다. Task 1·3에서 기존 컬럼별 해시와 PK 집합을 비교한다.
4. **진급 뒤 과거 공고 및 이름만 수정:** 현재 학급으로 과거 확정일을 재계산하지 않는다. 제목 수정은 확정일을 건드리지 않으며 학년도 기록 결측은 삭제 전에 중단한다. Task 10·11에서 검증한다.
5. **오래된 키오스크와 졸업 전 기록의 늦은 업로드:** 미전송 기록, 근거 없는 과거 payload, 확인 도중 자정, 승인 응답 유실을 잃지 않는다. 자정이 지나도 로컬 체크인은 멈추지 않고, 확인 대기 기록은 반드시 종결되어 로컬에서 정리된다. Task 12·13에서 검증한다.
6. **잠금 범위와 규모:** 체크인·신청이 명부 작업을 기다리지 않고, 서로 다른 셀의 동시 편집이 둘 다 성공하며, 1,000명 규모 Excel 확정·전환이 60초 제한 안에 끝난다. Task 2·5·7·8·10에서 실제 DB로 검증한다.
7. **남는 개인정보:** 이용 중단자의 얼굴 등록, 확정된 업로드 입력, 30일 지난 대응표·근거가 실제로 지워지고 이전 명부 삭제 때 사본도 함께 사라진다. Task 4·7·8·9·12에서 검증한다.

## 작업 순서와 완료 단위

| Task | 산출물 | 선행 |
|---|---|---|
| 1 | 운영 DB를 사용할 수 없는 통합 테스트 기반·원본 manifest | 없음 |
| 2 | 학년도 모델·도메인 계약·공통 잠금·추가형 SQL | 1 |
| 3 | 2026 초기 이전·원본 비교·기능 활성 가드 | 2 |
| 4 | 최신 계정 검증·이메일/권한/이용 상태 변경·얼굴 등록 파기 | 2·3 |
| 4A | 호환 쓰기·Release A 반영 준비 (**여기까지가 Release A**) | 2·3·4 |
| 5 | 학년도 명부 CRUD·초안·표시정보 서비스 | 2·3·4·4A |
| 6 | 두 시트 Excel 왕복·원본 식별·파일 검증 | 2·5 |
| 7 | 미리보기·동시성 재검사·전체 원자 반영 | 4·5·6 |
| 8 | 누락자 대조·관리자 학년도 전환 | 4·5·7 |
| 9 | 이전 명부 삭제·기록 정정·이력 보존 | 5·8 |
| 10 | 공고/신청/재계산/신청 Excel의 학년도 기준 | 4·5·8 |
| 11 | 과거 보고서·담임·본인 이력의 연도별 조회 | 5·9·10 |
| 12 | 온라인 체크인·동기화 근거·관리자 확인 API | 4·10·11 |
| 13 | IDB 무삭제 업그레이드·최신/오래됨 상태·검토 종결·공용 동기화 | 12 |
| 14 | 관리자 명부·전환·검토 UI와 개인 화면 연결 | 7·8·9·11·13 |
| 15 | 전체 회귀·문서·복원 리허설·Release A/B 운영 반영 절차 | 1~14 (Release A 부분은 1~4A 뒤 먼저 수행) |

단일 제품 변경의 결합된 경로이므로 하나의 계획으로 관리한다. Task 6의 순수 파일 처리와 Task 4의 인증 구현은 Task 2 계약 확정 뒤 독립 작업이 가능하다. 동일 파일을 수정하는 Task 10·11·12는 순서대로 통합한다.

운영 반영은 두 번이다. **Release A = Task 1~4A**(화면 변화 없음, 기존 쓰기 비차단, 전원 1회 재로그인)를 먼저 `main`에 반영하고 운영 DB에서 백필·원본 비교를 끝낸다. **Release B = Task 5~14**는 백필 검증 완료 뒤 한 번에 공개한다. Task 5~14의 중간 산출물은 따로 공개하지 않는다. Release A 반영 절차는 Task 15 Step 3~6의 해당 부분을 먼저 수행한다.

## 파일 구조와 공통 계약

새 도메인은 `src/lib/academic-year/`, 명부 UI는 `src/components/admin-roster/`에 모은다. 기존 관리자 페이지 전체를 재작성하지 않는다. 새 파일의 책임과 공개 함수는 아래 Task의 **Interfaces**가 기준이다.

`src/lib/academic-year/contracts.ts`에 다음 공유 타입을 정의한다. 서버 전용 Prisma 타입은 `db.ts`에서 분리해 클라이언트에 유입되지 않게 한다.

```ts
export type YearState = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ImportScope = "PARTIAL" | "FULL";
export type MemberState = "ENROLLED" | "EMPLOYED" | "GRADUATED" | "TRANSFERRED" | "RETIRED";
export type Actor =
  | { kind: "MAIN"; userId: null; sessionVersion: null }
  | { kind: "USER"; userId: number; sessionVersion: number };
export type Profile = {
  role: "STUDENT" | "TEACHER"; name: string;
  grade: number | null; classNum: number | null; number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null; homeroom: string | null; position: string | null;
};
export type AcademicProfile = Profile & {
  year: number; userId: number; memberState: MemberState;
  version: number; needsReview: boolean;
};
export type RosterRow = {
  entryId: string; userId: number | null; email: string;
  emailKey: string; profile: Profile; baseUserVersion: number | null;
  included: boolean;
};
export type RowIssue = { sheet: "학생" | "교사"; row: number; column: string; code: string; message: string };
export type RowChange = {
  kind: "NEW" | "SAME" | "CHANGED" | "REVIEW" | "CONFLICT";
  token: string; input: RosterRow; before: Profile | null; issues: RowIssue[];
  // CONFLICT: 내보낸 뒤 서버 값이 바뀐 행. server는 현재 서버 값, resolution은 관리자가 고른 뒤 채워진다.
  server?: Profile; resolution?: "USE_FILE" | "KEEP_SERVER";
};
export type ImportPreview = {
  id: string; year: number; controlVersion: number; yearVersion: number;
  scope: ImportScope; rows: RowChange[]; missingUserIds: number[];
  coveredRoles: Array<"STUDENT" | "TEACHER">; canCommit: boolean;
};
export type MutationReceipt = { requestId: string; version: number; changed: number };
// 사용자 행 단위 변경(셀 편집·이메일·이용 상태·권한). expectedRowVersion은 대상 행의 버전이다.
export type RowMutationInput = {
  actor: Actor; requestId: string; userId: number; expectedRowVersion: number;
  kind: string; payloadHash: string;
};
export type MutationSummary = { changed: number; ids: Array<number | string> };
export type MutationInput = {
  actor: Actor; requestId: string; expectedVersion: number;
  kind: string; payloadHash: string;
};
export type DomainErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "ACCOUNT_INACTIVE" | "STALE_SESSION"
  | "NOT_READY" | "VERSION_CONFLICT" | "REQUEST_REUSED" | "INVALID_FILE"
  | "IDENTITY_CONFLICT" | "REVIEW_REQUIRED" | "YEAR_MISMATCH" | "MISSING_PROFILE";
```

`DomainError`는 `code: DomainErrorCode`를 갖는 `Error`다. HTTP 변환은 `api.ts` 한 곳에서 401(미인증/옛 세션), 403(권한/이용 중단), 409(버전/요청키/식별 충돌), 422(파일/연도/보완 필요), 503(준비·중단 상태)으로 매핑한다. 응답에는 학생 원본이나 SQL 에러를 노출하지 않는다.

본문 테스트 코드는 각 테스트의 핵심 본문이다. 모든 DB 테스트의 beforeEach에서 `db = await openAcademicTestDb()`, `resetAcademicTestDb(db)`를 호출하고, `pgClient`는 같은 검증된 테스트 대상의 pg Client를 사용한다. 테스트별 `fx`는 명시적으로 만든다. CLI와 product import가 운영 `.env`를 읽기 전에 테스트 대상 확인을 끝낸다. 테스트용 고정 payloadHash와 달리 HTTP route는 요청의 actor/kind/hash를 신뢰하지 않고 서버에서 정규화한 입력의 SHA-256을 만든다.

## Task 1: 격리된 통합 테스트와 원본 비교 기반

**Files**
- Create: `compose.academic-year-test.yml`, `vitest.integration.config.ts`, `tests/integration/prisma.config.ts`
- Create: `tests/integration/support/db.ts`, `tests/integration/support/legacy-fixture.ts`, `tests/integration/sql/identity.sql`
- Create: `src/lib/academic-year/test-target.ts`, `src/lib/__tests__/academic-year-test-target.test.ts`
- Test: `tests/integration/academic-fingerprint.test.ts`
- Create: `scripts/academic-year/test-db.ts`, `scripts/academic-year/legacy-columns.json`, `scripts/academic-year/fingerprint.ts`
- Modify: `package.json`의 테스트 스크립트만 추가. 기존 compose의 `pgdata`는 사용하지 않는다.

**Interfaces**
- Produces: `parseAcademicTestTarget(raw: string): URL` — URL 문자열 미출력, 고정 로컬 테스트 대상만 허용.
- Produces: `openAcademicTestDb(): Promise<PrismaClient>`, `resetAcademicTestDb(db): Promise<void>` — 연결 전 URL/컨테이너, 연결 후 읽기 전용 marker 검사 필수.
- Produces: `seedLegacyFixture(db): Promise<{ studentId: number; teacherId: number; applicationId: number; registrationId: number; checkInId: number }>`.
- Produces: `captureLegacyFingerprint(pgClient): Promise<LegacyFingerprint>`, `compareLegacyFingerprints(a,b): { equal: boolean; differingTables: string[] }`. `LegacyFingerprint`는 `{ tables: Record<string,{ count:number; pkHash:string; rowHash:string }> }`다.

- [ ] **Step 1 — 대상 가드 실패 테스트 작성.** URL의 host만 검사하지 않는다.

```ts
import { expect, it } from "vitest";
import { parseAcademicTestTarget } from "@/lib/academic-year/test-target";
it.each([
  "postgresql://u:p@railway.example:5432/posanmeal",
  "postgresql://u:p@127.0.0.1:5432/posanmeal",
  "postgresql://academic_year_test:local-only@127.0.0.1:55439/production",
  "",
])("rejects a non-test target without printing its URL", raw => {
  expect(() => parseAcademicTestTarget(raw)).toThrow("전용 테스트 DB 설정을 확인하세요");
});
```

- [ ] **Step 2 — 실패 확인.** `npx vitest run src/lib/__tests__/academic-year-test-target.test.ts`. 모듈 없음으로 실패해야 한다.
- [ ] **Step 3 — 전용 컨테이너·가드 구현.** 아래 설정을 별도 파일에 사용한다. 실행 프로젝트 이름은 `posanmeal-academic-tests`로 고정한다.

```yaml
services:
  academic-db:
    image: postgres:16-alpine
    labels:
      posanmeal.academic-year-test: "true"
    environment:
      POSTGRES_USER: academic_year_test
      POSTGRES_PASSWORD: local-only
      POSTGRES_DB: posanmeal_academic_year_test
    ports:
      - "127.0.0.1:55439:5432"
    tmpfs:
      - /var/lib/postgresql/data
    volumes:
      - ./tests/integration/sql/identity.sql:/docker-entrypoint-initdb.d/identity.sql:ro
```

`identity.sql`은 `academic_test_identity(key text primary key)`에 `posanmeal-academic-tests-v1` 하나를 넣는다. `parseAcademicTestTarget`은 hostname `127.0.0.1`, port `55439`, database `posanmeal_academic_year_test`, username `academic_year_test`를 모두 검사한다. `test-db.ts`는 Docker label과 실제 포트 매핑도 검사한 뒤 marker와 `current_database()/current_user`를 SELECT한다. 그 전에는 DDL·DML·앱 Prisma import를 하지 않는다. 기존 `DATABASE_URL`로 fallback하지 않는다.

- [ ] **Step 4 — 테스트 스크립트와 Prisma 구성.** `test:academic`은 `vitest run --config vitest.integration.config.ts`, `academic:test-db`는 `tsx scripts/academic-year/test-db.ts`로 정의한다. wrapper의 `up / migrate / down`만 허용하고 URL은 프로세스 내부에서 전용 구성으로 전달한다. 별도 Prisma config는 `../../prisma/schema.prisma`와 `../../prisma/migrations`를 사용하고 dotenv를 import하지 않는다. integration 설정은 `tests/integration/**/*.test.ts`, `fileParallelism:false`, 기존 `@` alias를 사용한다.
- [ ] **Step 5 — 합성 fixture와 manifest 구현.** 학생·교사 각 1명, 2026년 9월 공고, 학생 신청/서명·DINNER 선택·확정일, 학생/교사 체크인, 얼굴 JSON·사진 경로·설정 행을 생성한다. `seedLegacyFixture`는 실제 학생정보를 사용하지 않는다. 기존 11개 모델(`Admin`, `User`, `MealApplication`, `MealApplicationMeal`, `MealApplicationMealDate`, `MealRegistration`, `MealRegistrationMeal`, `MealRegistrationMealDate`, `CheckIn`, `SystemSetting`, `FaceProfile`)의 **현재 컬럼 전체와 PK**를 `legacy-columns.json`에 고정한다. timestamp를 JS Date로 바꿔 정밀도를 잃지 말고 PostgreSQL에서 UTC·ISO 출력과 `jsonb` 정렬을 사용한 문자열을 SHA-256으로 해시한다. snapshot은 repeatable-read/read-only 트랜잭션으로 수집한다.

학생 이름은 `학생테스트`, 학번은 1-1-1, 성별 MALE, 교사는 담임 1-1·ADMIN으로 만든다. 학생/교사 체크인은 2026-09-18 DINNER, 학생 확정일은 9월 18일·19일이다. 공고 접수기간은 9월 1일~30일이고 날짜 선택 방식은 DATE다. 이후 모든 Task가 이 합성 기준을 사용한다.

```ts
const before = await captureLegacyFingerprint(pgClient);
await pgClient.query('UPDATE "MealRegistration" SET signature = $1 WHERE id = $2', ["changed", fixture.registrationId]);
const after = await captureLegacyFingerprint(pgClient);
expect(compareLegacyFingerprints(before, after)).toEqual({ equal: false, differingTables: ["MealRegistration"] });
```

- [ ] **Step 6 — 가드 통과 후 전용 DB에서 확인.** `npm run academic:test-db -- up`, `npm run academic:test-db -- migrate`, 단위/통합 테스트 순서로 실행한다. `resetAcademicTestDb`는 매번 marker 검증 후 이 전용 DB의 앱 테이블만 비운다. `_prisma_migrations`와 marker는 유지한다. 운영 URL이 들어가면 연결 전에 중단되는 테스트도 통과해야 한다.
- [ ] **Step 7 — 커밋.** 이 Task의 파일만 검토·stage하고 `test: add isolated academic year database harness`로 로컬 커밋한다.

## Task 2: 학년도 모델·제약·시간 계산·공통 변경 트랜잭션

**Files**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260919000001_add_academic_year_roster/migration.sql`
- Create: `src/lib/academic-year/contracts.ts`, `calendar.ts`, `db.ts`, `errors.ts`, `mutation.ts` (모두 같은 새 디렉터리)
- Create: `src/lib/__tests__/academic-year-calendar.test.ts`, `tests/integration/academic-schema.test.ts`, `tests/integration/academic-mutation.test.ts`

**Interfaces**
- Produces: 위 공유 계약 전체, `Db = PrismaClient | Prisma.TransactionClient` 타입.
- Produces: `academicYearOfDate(dateKey: string): number`, `academicYearBounds(year: number): { startDate: string; endDate: string }`, `nextKstMidnight(now: Date): Date`.
- Produces: `withAcademicMutation<T extends Prisma.InputJsonObject>(db: PrismaClient, input: MutationInput, authorize: (tx: Prisma.TransactionClient) => Promise<void>, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<{result:T; receipt:MutationReceipt}>`.
- Produces: `withUserMutation<T extends MutationSummary>(db: PrismaClient, input: RowMutationInput, authorize, write): Promise<{result:T; receipt:MutationReceipt}>` — control 행 **공유** 잠금(`FOR SHARE`)으로 진행 중인 전환·Excel 확정과만 순서를 정하고, `User` 행 `FOR UPDATE` + 행 버전으로 충돌을 판단한다. control version은 올리지 않는다.
- Produces: `ROSTER_TX = { maxWait: 10_000, timeout: 60_000 }` — 전역 배타 잠금 트랜잭션 공통 옵션.
- 체크인·신청 경로용 읽기 잠금 helper는 만들지 않는다. 그 경로는 control 행을 잠그지 않는다.

- [ ] **Step 1 — 날짜·unique·멱등성 실패 테스트 작성.**

```ts
it("keeps January and leap-day in the preceding academic year", () => {
  expect(academicYearOfDate("2027-02-28")).toBe(2026);
  expect(academicYearOfDate("2028-02-29")).toBe(2027);
  expect(academicYearOfDate("2027-03-01")).toBe(2027);
  expect(() => academicYearOfDate("2027-02-29")).toThrow();
  expect(nextKstMidnight(new Date("2027-02-28T14:59:59.000Z")).toISOString())
    .toBe("2027-02-28T15:00:00.000Z");
});
```

DB 테스트는 두 ACTIVE 생성 실패, 같은 사용자/연도·명부 중복 실패, 같은 요청키/다른 입력 거절, 두 병렬 전역 변경 중 하나만 같은 기준 버전으로 성공하는 결과를 검사한다. `withUserMutation`은 서로 다른 사용자 두 건이 병렬로 모두 성공하고, 같은 사용자·같은 행 버전 두 건은 하나만 성공함을 검사한다. 전역 배타 잠금을 잡은 채 대기시키는 동안 `checkIn` 삽입과 `MealRegistration` 쓰기가 지연 없이 끝나는 것도 검사한다.

```ts
const version = (await db.rosterControl.findUniqueOrThrow({ where: { id: 1 } })).version;
const actor: Actor = { kind: "MAIN", userId: null, sessionVersion: null };
const results = await Promise.allSettled(["one", "two"].map(requestId =>
  withAcademicMutation(db, { actor, requestId, expectedVersion: version, kind: "TEST", payloadHash: requestId },
    async () => {}, async () => ({ saved: true })),
));
expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
expect(failed.reason).toMatchObject({ code: "VERSION_CONFLICT" });
```
- [ ] **Step 2 — 실패 확인.** calendar 단위 테스트와 `npm run test:academic -- academic-schema.test.ts academic-mutation.test.ts`를 분리해 실행한다.
- [ ] **Step 3 — 아래 모델 계약대로 추가한다.** 연도 PK는 실제 연도 정수(`2026`)이며 `year` 필드명으로 참조한다. 모든 새 FK는 기본 `Restrict`; 계정/명부를 따라 보존 자료를 Cascade하지 않는다.

| 모델 | 정확한 필드·제약 |
|---|---|
| User 추가 | `emailKey String? @unique`, `accessState String @default("ACTIVE")`, `sessionVersion Int @default(0)`, `profileVersion Int @default(0)` |
| MealApplication 추가 | `academicYear Int?` → `AcademicYear.year` |
| AcademicYear | `year Int @id`, `state String`, `version Int @default(0)`, `reviewedVersion Int?`, `reviewedSourceVersion Int?`, `activatedAt DateTime?`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` |
| RosterControl | `id Int @id`, `mode String @default("PREPARING")`, `version Int @default(0)`. `id=1` CHECK |
| UserAcademicRecord | `id Int @id @default(autoincrement())`, `year Int`, `userId Int`, 공유 Profile의 10개 필드(기존 Role/Gender enum 재사용), `memberState String`, `needsReview Boolean @default(false)`, `version Int @default(0)`, `updatedAt DateTime @updatedAt`, unique `(year,userId)` |
| RosterEntry | `id String @id @default(cuid())`, `year Int`, `userId Int?`, `emailKey String`, `draftEmail String?`, `draftProfile Json?`, `included Boolean @default(true)`, `baseUserVersion Int?`, `version Int @default(0)`, unique `(year,emailKey)`·`(year,userId)` |
| RosterFile | `id String @id @default(cuid())`, `year Int`, `version Int`, `schemaVersion Int`, `manifest Json`, `createdAt DateTime @default(now())`, index `(createdAt)`. 기존 데이터 포함 다운로드에서만 생성, 30일 뒤 삭제 |
| RosterImport | `id String @id @default(cuid())`, `year Int`, `scope String`, `controlVersion Int`, `yearVersion Int`, `payload Json?`, `preview Json?`, `summary Json?`, `state String`(PREVIEW/COMMITTED/CANCELLED/EXPIRED), `createdAt DateTime @default(now())`. 확정·취소 즉시, 미확정은 24시간 뒤 `payload/preview`를 null로 비우고 `summary`(건수)만 유지 |
| RosterDecision | `year Int`, `userId Int`, `decision String`, `sourceVersion Int`, unique `(year,userId)` |
| RosterMutation | `requestId String @id`, `actorUserId Int?`(메인 null), `kind String`, `payloadHash String`, `result Json`(`MutationSummary` — 건수·ID만, 이름·학번·이메일 원문 금지), `version Int`, `changed Int`(실제 변경 건수), `createdAt DateTime @default(now())` |
| UserAccessEvent | `id Int @id @default(autoincrement())`, `userId Int`, `state String`, `reason String`, `effectiveAt DateTime`, `requestId String?`, index `(userId,effectiveAt)` |
| EligibilityEvent | `id Int @id @default(autoincrement())`, `scope String`(APPLICATION/REGISTRATION/ACCOUNT/ROLLOVER), `applicationId Int?`, `userId Int?`, `occurredAt DateTime`, `createdAt DateTime @default(now())`, `requestId String?`, index `(userId,occurredAt)`·`(applicationId,occurredAt)` |
| AcademicBackfill | `key String @id`(`academic-year-2026`), `state String`, `sourceManifest Json`, `completedAt DateTime?`, `verifiedAt DateTime?` |
| KioskSnapshot | `id String @id @default(cuid())`, `version Int`, `activeYear Int`, `lastEligibilityEventId Int`, `payload Json`, `issuedAt DateTime`, `freshUntil DateTime`(다음 KST 자정), `coversUntil String`(내려준 자격의 마지막 dateKey), index `(issuedAt)`. 30일 뒤 삭제하되 PENDING 검토가 참조하면 유지 |
| LocalCheckInReview | `id String @id @default(cuid())`, `clientKey String @unique`, `payloadHash String`, `payload Json?`, `snapshotId String?`, `reason String`, `state String @default("PENDING")`, `decision Json?`, `createdAt DateTime @default(now())`, `resolvedAt DateTime?`. 해결 30일 뒤 `payload`를 null로 비움 |

`RosterEntry`는 DRAFT에서만 `draftProfile`을 갖는다. 확정 뒤에는 `userId`가 필수이며 `draftProfile=null`; 이름/학급 등은 연도 기록에서 읽는다. `RosterFile.manifest`는 행 토큰→원본 사용자/명부 ID·이메일·행 버전을 보관한다. 새로운 문자열 상태에는 SQL CHECK를 둔다. `UserAcademicRecord` 관계의 User/AcademicYear 역방향 목록을 추가한다. LocalCheckInReview.state는 PENDING/ACCEPTED/DUPLICATE/REJECTED를 허용하며 최초 성공 업로드도 증거 행을 남긴다. EligibilityEvent는 기존 원본 보존을 방해하지 않도록 과거 application/user 식별값을 보존하는 논리 참조로 두며, 발급 이후 자격 변경 시점을 증명한다. 순번은 autoincrement(sequence)로 발급하므로 신청 트랜잭션이 control 행을 잠그지 않는다. sequence는 커밋 순서를 보장하지 않으므로 Task 12의 검증은 `id > snapshot.lastEligibilityEventId` **또는** `createdAt ≥ snapshot.issuedAt − 60초`인 event를 모두 살펴 보수적으로 판단한다(과포함은 관리자 확인으로 갈 뿐 기록을 잃지 않는다).

- [ ] **Step 4 — 제약과 잠금의 SQL을 검토한다.** 예시 핵심 SQL은 다음과 같다.

```sql
CREATE UNIQUE INDEX "AcademicYear_one_active" ON "AcademicYear" ((1)) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX "AcademicRecord_student_seat" ON "UserAcademicRecord" (year, grade, "classNum", number)
WHERE role = 'STUDENT' AND "memberState" = 'ENROLLED' AND "needsReview" = false;
ALTER TABLE "RosterControl" ADD CONSTRAINT "RosterControl_singleton" CHECK (id = 1);
INSERT INTO "RosterControl" (id, mode, version) VALUES (1, 'PREPARING', 0);
```

기존 source 테이블에 NOT NULL 무기본값 필드나 학번 unique를 직접 붙이지 않는다. Guardian이 실제 생성 SQL의 INDEX/CONSTRAINT, FK·default·잠금을 검수한 후 **Task 1 전용 DB에서만** migrate한다. `npx prisma generate`와 `npx tsc --noEmit`도 수행한다.

- [ ] **Step 5 — 공통 변경 순서 구현.** SQL 식별자는 고정 문자열만 사용한다.

```ts
return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM "RosterControl" WHERE id = 1 FOR UPDATE`;
  await authorize(tx);
  const old = await tx.rosterMutation.findUnique({ where: { requestId: input.requestId } });
  if (old) {
    if (old.payloadHash !== input.payloadHash || old.kind !== input.kind || old.actorUserId !== input.actor.userId)
      throw new DomainError("REQUEST_REUSED");
    return { result: old.result as unknown as T, receipt: { requestId: old.requestId, version: old.version, changed: old.changed } };
  }
  const control = await tx.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
  if (control.version !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT");
  const result = await write(tx); // T extends MutationSummary
  const updated = await tx.rosterControl.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
  await tx.rosterMutation.create({ data: { requestId: input.requestId, actorUserId: input.actor.userId,
    kind: input.kind, payloadHash: input.payloadHash, result, version: updated.version, changed: result.changed } });
  return { result, receipt: { requestId: input.requestId, version: updated.version, changed: result.changed } };
}, ROSTER_TX);
```

authorize 인자를 생략할 수 없게 하여 Task 4 이후 모든 호출자는 `tx => assertActor(tx, input.actor, 요구권한)`을 전달한다. Task 2의 잠금 테스트는 허용/거절 callback을 각각 주입한다. 재전송 응답도 최신 권한 검사 뒤 저장된 최초 receipt를 그대로 반환한다. `changed`는 `write`가 돌려준 실제 변경 건수다. `write`의 제네릭 제약을 `T extends MutationSummary & Prisma.InputJsonObject`로 두어 결과에 건수·ID 외의 원문이 들어가지 않게 한다. 이 wrapper는 **전환·Excel 확정·이전 명부 삭제·초안 생성**에만 쓴다.

`withUserMutation`은 같은 멱등성 검사(requestId·payloadHash·actor)를 쓰되 잠금 순서가 다르다: `SELECT id FROM "RosterControl" WHERE id = 1 FOR SHARE` → `authorize` → `SELECT id, "profileVersion" FROM "User" WHERE id = $1 FOR UPDATE` → 행 버전 비교(`VERSION_CONFLICT`) → `write` → `RosterMutation` 기록. control version은 올리지 않고, `write` 안에서 대상 학년도의 `AcademicYear.version`을 올려 진행 중인 미리보기·전환 검토를 무효화한다. 전역 배타 잠금이 잡혀 있는 동안에는 공유 잠금 대기로 자연히 뒤에 선다(전환은 60초 제한 안에 끝난다).

온라인 체크인과 신청·공고 변경은 control 행을 잠그지 않는다. 체크인은 삽입 직전 같은 트랜잭션에서 `accessState`만 읽고, 신청·공고는 Task 10의 공고 행 잠금을 쓴다.

- [ ] **Step 6 — 날짜 구현.** `academicYearOfDate`는 기존 `dateKeyToUtcDate`로 실재 날짜를 먼저 검증한 뒤 월 `<3`이면 연도-1을 반환한다. `nextKstMidnight`는 절대시각에 +9h하여 날짜 부분을 얻고 다음 날짜 00:00에서 9h를 빼며, 기존 `nowKST()`로 재해석된 Date를 사용하지 않는다.
- [ ] **Step 7 — 테스트·커밋.** unique, 재시도, 두 동시 전역 transaction, 서로 다른 사용자 행의 병렬 성공, 전역 잠금 중 체크인·신청 비차단, 자정 경계를 통과시킨 뒤 `feat: add academic year domain and guarded mutations`로 커밋한다.

## Task 3: 2026 초기 이전과 원본 보존 검증

**Files**
- Create: `src/lib/academic-year/backfill.ts`, `readiness.ts`
- Create: `scripts/academic-year/backfill.ts`, `scripts/academic-year/verify.ts`, `scripts/academic-year/db-target.ts`
- Create: `tests/integration/academic-backfill.test.ts`, `tests/integration/support/academic-fixture.ts`

**Interfaces**
- Consumes: Task 1 fingerprint·전용 DB, Task 2 모델/잠금.
- Produces: `backfill2026(db, source: LegacyFingerprint): Promise<{ inserted:number; blockingIssues:string[] }>`.
- Produces: `verifyBackfill(db, before: LegacyFingerprint, after: LegacyFingerprint): Promise<{ canEnable:boolean; issues:string[] }>`.
- Produces: `requireAcademicReady(tx): Promise<void>`, `enableAcademicMode(db, actor:Actor): Promise<void>`.
- Produces: 테스트용 `prepareAcademicFixture(db)` → `seedLegacyFixture` 결과 + `version:number`, `main:Actor`, `writer:Actor`. 합성 teacher는 `adminLevel=ADMIN`, main은 credentials Actor, writer는 teacher Actor로 설정한다. 백필과 원본 검증을 거쳐 테스트에서만 READY로 설정하고 합성 AccessEvent의 effectiveAt을 2026-09-18T00:00:00Z로 고정한다. 실제 backfill의 최초 확인 시각을 소급하는 구현은 하지 않는다.
- Produces: CLI용 `openMigrationTarget(configPath:string):Promise<PrismaClient>`. 별도 `ACADEMIC_MIGRATION_DATABASE_URL`만 읽으며 `DATABASE_URL`/dotenv fallback이 없다. config는 환경 구분·host·port·database·username·고유 marker·백업/복원 확인 report ID를 포함한다. 연결 전 URL 대조와 연결 후 SELECT 대조를 통과한 뒤에만 Prisma client를 반환한다.

- [ ] **Step 1 — 원본 불변·삭제 후 재실행 실패 테스트.**

```ts
const fixture = await seedLegacyFixture(db);
const before = await captureLegacyFingerprint(pgClient);
await backfill2026(db, before);
const after = await captureLegacyFingerprint(pgClient);
expect(compareLegacyFingerprints(before, after).equal).toBe(true);
expect(await db.userAcademicRecord.count()).toBe(2);
await db.rosterEntry.deleteMany({ where: { year: 2026 } });
await backfill2026(db, before);
expect(await db.rosterEntry.count()).toBe(0);
expect(await db.checkIn.findUnique({ where: { id: fixture.checkInId } })).not.toBeNull();
```

백필은 운영 중에 실행되므로, `COPIED` 이전에 호환 쓰기(Task 4A)가 먼저 만든 Record·Entry가 있으면 덮어쓰지 않고 건너뛰는 사례도 넣는다. 파일에 원본 `User.updatedAt`·`MealApplication.updatedAt` 보존, 결측 성별 복사, 중복 학번 needsReview 보존, 2026 범위 밖 확정일 차단, 완료 직전 예외 rollback 사례도 넣는다.
- [ ] **Step 2 — 실패 확인.** `npm run test:academic -- academic-backfill.test.ts`.
- [ ] **Step 3 — preflight와 copy 구현.** 연도 범위·이메일 정규화 충돌·학번 충돌·누락 관계를 읽기 전용으로 검사한다. 자동 병합·수치 보정은 하지 않는다. 원본 User 값 그대로 연도 기록을 INSERT하고 기존 결측은 `needsReview=true`로 표시한다. 신규 엄격 검증과 초기 복사는 별도 함수로 분리한다.
- [ ] **Step 4 — source 컬럼 변경 방지.** `User.emailKey`와 `MealApplication.academicYear` 백필은 Prisma `update()`의 `@updatedAt` 부작용을 피하도록 바인딩된 raw UPDATE로 **새 컬럼만** 채운다. 원래 `updatedAt`를 현재 시각으로 바꾸지 않는다.

```ts
await tx.$executeRaw`UPDATE "MealApplication" SET "academicYear" = 2026
  WHERE id = ${applicationId} AND "academicYear" IS NULL`;
await tx.$executeRaw`UPDATE "User" SET "emailKey" = ${emailKey}
  WHERE id = ${userId} AND "emailKey" IS NULL`;
```

`applicationId/userId/emailKey`는 preflight에서 확인한 행이다. 이메일 충돌 그룹은 임의 채우지 않으며 기능 활성화를 차단한다. 원본 일부가 이미 복사됐을 때는 INSERT 누락만 보완하고 기존값과 다르면 충돌을 반환한다.
- [ ] **Step 5 — 완료 상태와 활성 가드.** `AcademicBackfill`을 `PENDING → COPIED → VERIFIED`로 변경한다. COPIED 뒤 명부가 삭제돼도 재생성하지 않는다. `RosterControl.mode=PREPARING` 동안 `requireAcademicReady`는 **새 학년도 기능 API**(Task 5~14의 명부·Excel·전환·검토)만 503으로 막는다. 기존 사용자 관리·신청·체크인 쓰기는 막지 않으며 Task 4A의 호환 쓰기로 학년도 기록을 함께 유지한다. 귀속/식별/학번 충돌이 해결되고 원본 비교와 Task 5~14가 통합·배포된 후에만 메인 관리자가 `READY`로 바꾼다. 기존 성별 결측처럼 원본에 있던 비식별 결측은 보완 표시를 유지할 수 있지만 새 업로드·진급 입력에서는 허용하지 않는다.
- [ ] **Step 6 — CLI 경계.** `backfill.ts`는 `--mode inspect`가 기본이고, 쓰기는 `--mode apply --target-config <설정파일 경로> --report-dir <보호된 출력 경로>`를 모두 명시해야 한다. `verify.ts`는 같은 target-config와 `--before <manifest 경로>`를 받아 비교한다. 실제 파일 경로는 Task 15에서 대상 검토와 함께 고정한다. apply는 복원 검증 report ID가 설정에 없으면 실행하지 않는다. 빈 시험 DB 준비·운영 최초 marker 설정은 승인된 운영 실행안의 별도 단계이며 CLI가 알려지지 않은 대상에 marker를 자동 생성하지 않는다. 자동 테스트에서는 Task 1 wrapper만 연결한다. 사용자 데이터 대신 차이 종류·건수만 출력한다.
- [ ] **Step 7 — 테스트·커밋.** 재실행·중단 복구·같은 행수 훼손 탐지를 통과한 뒤 `feat: backfill 2026 records without changing meal sources`로 커밋한다.

## Task 4: 최신 계정 상태·세션·관리자 권한 검증

**Files**
- Create: `src/lib/academic-year/access.ts`, `request-actor.ts`, `account-service.ts`, `api.ts`
- Modify: `src/auth.ts`, `src/types/next-auth.d.ts`, `src/lib/permissions.ts`, `src/proxy.ts`
- Modify: `src/app/api/users/me/route.ts`, `src/app/api/users/me/photo/route.ts`, `src/app/api/users/me/face/route.ts`, `src/app/api/qr/token/route.ts`, `src/app/api/checkins/route.ts`, `src/app/api/system/settings/route.ts`
- Create: `src/app/api/admin/users/[id]/email/route.ts`, `src/app/api/admin/users/[id]/access/route.ts`, `src/app/api/admin/users/[id]/permissions/route.ts`
- Test: `src/lib/__tests__/academic-access.test.ts`, `tests/integration/academic-account.test.ts`

**Interfaces**
- Produces: `AccessRequirement = "SIGNED_IN" | "STUDENT" | "TEACHER" | "READ_ADMIN" | "WRITE_ADMIN" | "MAIN"`.
- Produces: `assertActor(tx:Db, actor:Actor, required:AccessRequirement): Promise<void>`, `requireActor(required:AccessRequirement): Promise<Actor>`.
- Produces: `changeEmail(db, input:RowMutationInput & { email:string }): Promise<MutationReceipt>`; `changeAccess(db, input:RowMutationInput & { state:"ACTIVE"|"INACTIVE"; reason:string; confirmPrivileges:boolean }): Promise<MutationReceipt>`; `changePermissions(db, input:RowMutationInput & { level:"NONE"|"SUBADMIN"|"ADMIN" }): Promise<MutationReceipt>`. 셋 다 `withUserMutation`을 쓴다.
- Produces: transaction-only `deactivateUsers(tx, userIds:number[], reason:string, at:Date): Promise<void>` — `accessState`·`sessionVersion` 일괄 갱신, `UserAccessEvent`·`EligibilityEvent` `createMany`, `FaceProfile.deleteMany`. `changeAccess`와 Task 8 전환이 공용한다. 호출자는 커밋 뒤 `invalidateFaceCache()`를 부른다.

- [ ] **Step 1 — 기존 JWT·교사 직접 변경 실패 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
const stale: Actor = { kind: "USER", userId: fx.teacherId, sessionVersion: 0 };
const teacher = await db.user.findUniqueOrThrow({ where: { id: fx.teacherId } });
await changeAccess(db, { actor: fx.main, requestId: "retire-1", expectedRowVersion: teacher.profileVersion,
  kind: "ACCESS", payloadHash: "retire-hash", userId: fx.teacherId,
  state: "INACTIVE", reason: "RETIRED", confirmPrivileges: false });
await expect(assertActor(db, stale, "SIGNED_IN")).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
expect(await db.checkIn.count({ where: { userId: fx.teacherId } })).toBe(1);
expect(await db.faceProfile.count({ where: { userId: fx.teacherId } })).toBe(0);
expect(await db.faceProfile.count({ where: { userId: fx.studentId } })).toBe(1);
```

별도 테스트: 구 JWT의 sessionVersion 누락/버전 불일치, 교사 ADMIN의 권한 부여 403, credentials 메인 허용, 학생 self PUT이 DB를 먼저 변경하지 않음, `/api/checkins`가 `/api/checkin` prefix로 공개 처리되지 않음.
- [ ] **Step 2 — 실패 확인.** `npx vitest run src/lib/__tests__/academic-access.test.ts` 및 해당 DB 테스트.
- [ ] **Step 3 — auth 순환 import 없이 구현.** `access.ts`는 DB+순수 Actor 검증만 하고 `auth`를 import하지 않는다. `request-actor.ts`만 `auth()`를 호출한다. JWT의 sessionVersion은 로그인 시에만 저장한다. 재검증 때 토큰의 버전을 최신 값으로 덮어써 무효 토큰을 되살리지 않는다. 버전 없는 기존 Google 세션은 재로그인을 요구한다. 별도 관리자 로그인은 `role=ADMIN && dbUserId=0` 경로로 구분한다.

```ts
if (actor.kind === "USER") {
  const user = await tx.user.findUnique({ where: { id: actor.userId } });
  if (!user || user.accessState !== "ACTIVE") throw new DomainError("ACCOUNT_INACTIVE");
  if (user.sessionVersion !== actor.sessionVersion) throw new DomainError("STALE_SESSION");
  if (required === "MAIN") throw new DomainError("FORBIDDEN");
}
```

이후 최신 DB의 role/adminLevel로 요구 권한을 판단한다. 클라이언트 body의 Actor·adminLevel은 인증 근거로 받지 않는다. 기존 pure permissions helper는 UI 표시용으로 유지하되 서버 쓰기 허용의 최종 근거로 쓰지 않는다.
fixture의 얼굴 JSON은 학생·교사 모두에게 만든다. 이용 중단된 교사의 얼굴 등록만 사라지고 사진 경로·체크인·신청은 fingerprint의 해당 테이블에서 동일해야 한다(`FaceProfile`·`User`만 차이).
- [ ] **Step 4 — 계정 변경 구현.** 세 변경 모두 `withUserMutation`(control 공유 잠금 + 사용자 행 잠금·행 버전)과 최신 Actor 검사를 통과한다. 성공 시 `User.profileVersion`을 올린다. 이메일은 원본 ID를 고정해 새 `emailKey`의 충돌을 검사하고 세션/profileVersion을 증가시킨다. 이미 연결된 명부의 emailKey도 같은 transaction으로 바꾸되 오래된 초안/파일은 source version 충돌로 재검토시킨다. 이용 중단은 `deactivateUsers`로 처리해 `UserAccessEvent`·해당 userId의 `EligibilityEvent` 추가와 `FaceProfile` 삭제를 한 트랜잭션에 묶는다. 재활성화는 `UserAccessEvent`·`EligibilityEvent`만 추가하며 얼굴 등록을 복구하지 않는다(본인이 다시 등록). 재활성화는 MAIN과 `confirmPrivileges=true`가 필요하다. 권한 변경도 sessionVersion을 증가시키며 학생에게 관리자 권한을 줄 수 없다. 얼굴 캐시는 commit 뒤 invalidate한다.
- [ ] **Step 5 — 직접 수정·공개 prefix 정리.** `users/me PUT`의 명부 필드 변경은 검사 전에 DB 쓰기 없이 403을 반환한다. 사진·얼굴 API는 같은 본인 인증을 유지한다. proxy의 공개 경로는 완전 일치 또는 `prefix + '/'` 경계를 사용한다. 각 Route Handler의 최신 인증 검사는 유지하며 proxy만 믿지 않는다.
- [ ] **Step 6 — 모든 후속 보호 API에 공통 guard를 적용한다.** Task 5~14의 새/수정 API 첫 단계는 `requireActor`다. 기존 `admin/applications`, `teacher`, `applications`, `sync`, `system/settings PUT`도 해당 Task에서 빠짐없이 이전한다. 구조 검색으로 남은 옛 서버 권한 검사를 마지막 Task에서 점검한다.
- [ ] **Step 7 — 테스트·커밋.** `feat: enforce current account access and main admin authority`.

## Task 4A: 호환 쓰기와 Release A 반영 준비

**Files**
- Create: `src/lib/academic-year/compat-write.ts`
- Modify: `src/app/api/admin/users/route.ts`, `src/app/api/admin/import/route.ts`, `src/app/api/users/me/route.ts`
- Test: `tests/integration/academic-compat-write.test.ts`

**Interfaces**
- Produces: transaction-only `mirrorUsersToActiveYear(tx, userIds:number[]): Promise<void>` — ACTIVE 학년도(Release A 시점에는 2026)의 `UserAcademicRecord`·`RosterEntry`를 `User` 현재값으로 일괄 upsert한다(`INSERT ... ON CONFLICT (year,"userId") DO UPDATE`, 바인딩된 raw SQL 한 번). `AcademicYear` 2026 행이 없으면 `DRAFT`가 아닌 `ACTIVE`로 한 번 만든다(마이그레이션이 미리 넣어 두는 것을 기본으로 하고 이는 방어용).
- Consumes: Task 2 모델, Task 4 `requireActor`.

Release A와 B 사이에도 `User`만 바뀌는 경로가 없어야 한다(spec §11.2-8, §11.3). 이 Task는 **기존 API의 동작과 응답을 바꾸지 않고** 같은 트랜잭션에 학년도 기록 쓰기만 덧붙인다. Task 5·14에서 이 경로들은 새 서비스로 대체·종료된다.

- [ ] **Step 1 — 실패 테스트.** 기존 `/api/admin/users` POST·PUT, Sheet import, `users/me` PUT 각각을 호출한 뒤 `User`와 2026 Record가 같은 값인지 검사한다. 백필 전(Record 없음)과 백필 후(Record 있음) 두 상태 모두에서 통과해야 한다. import 도중 한 행이 실패하면 `User`·Record 모두 rollback돼야 한다.

```ts
const before = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
await db.$transaction(async tx => {
  await tx.user.update({ where: { id: fx.studentId }, data: { classNum: 4 } });
  await mirrorUsersToActiveYear(tx, [fx.studentId]);
});
const record = await db.userAcademicRecord.findUniqueOrThrow({ where: { year_userId: { year: 2026, userId: fx.studentId } } });
expect(record.classNum).toBe(4);
expect(record.grade).toBe(before.grade);
```

- [ ] **Step 2 — 실패 확인.** `npm run test:academic -- academic-compat-write.test.ts`.
- [ ] **Step 3 — 구현.** 세 route의 `User` 쓰기를 `$transaction`으로 감싸고 끝에 `mirrorUsersToActiveYear`를 호출한다. Sheet import는 기존 배치 구조를 유지하고 변경된 userId 배열을 한 번에 넘긴다(행별 호출 금지). `emailKey`도 여기서 함께 채운다. 정규화 이메일이 다른 사용자와 충돌하면 기존 동작대로 저장하되 `needsReview=true`로 표시하고 Release B의 READY를 차단하는 예외로 남긴다.
- [ ] **Step 4 — 사용자 물리 삭제 차단.** `/api/admin/users` DELETE는 409와 "이용 중단으로 처리하세요" 안내를 반환한다(Cascade로 식사 기록이 사라지는 경로를 Release A에서 먼저 닫는다). 관리자 화면의 삭제 버튼은 같은 안내를 toast로 보여주는 최소 수정만 한다. 이용 중단 실행 UI는 Release B(Task 14)에서 제공하므로, Release A~B 사이에 필요한 이용 중단은 Task 4의 API를 직접 호출하는 절차를 runbook에 적는다.
- [ ] **Step 5 — 세션 영향 확인.** Task 4의 `sessionVersion` 도입으로 Release A 배포 직후 기존 Google 세션은 재로그인을 요구받는다. 랜딩 페이지가 `STALE_SESSION`을 오류 화면이 아닌 로그인 화면으로 자연스럽게 보내는지 브라우저로 확인한다. 공개 키오스크(`/check`·`/facecheck`)는 영향이 없어야 한다.
- [ ] **Step 6 — Release A 게이트.** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:academic`, `npm run build`를 통과시키고 `prisma-migration-guardian`의 실제 SQL 검수를 받는다. 이후 Task 15 Step 3~6의 Release A 부분(연결 확인 → 백업·복원 리허설 → 복원본 백필 검증 → 운영 반영)을 수행한다. 운영 백필이 `VERIFIED`가 될 때까지 Release B를 배포하지 않는다.
- [ ] **Step 7 — 커밋.** `feat: mirror legacy user writes into academic year records`.

## Task 5: 연도별 명부 서비스·초안·개별 편집

**Files**
- Create: `src/lib/academic-year/profile-schema.ts`, `profile-service.ts`, `roster-service.ts`
- Create: `src/app/api/admin/academic-years/route.ts`, `src/app/api/admin/academic-years/[year]/roster/route.ts`, `src/app/api/admin/academic-years/[year]/records/[userId]/route.ts`
- Modify: `src/app/api/admin/users/route.ts`
- Test: `src/lib/__tests__/academic-profile.test.ts`, `tests/integration/academic-roster.test.ts`

**Interfaces**
- Produces: `normalizeEmail(email:string): string`; Zod `studentProfileSchema`, `teacherProfileSchema` and `parseProfile(input:unknown):Profile`.
- Produces: `getAcademicProfiles(db:Db, userIds:number[], year:number): Promise<Map<number,AcademicProfile>>`.
- Produces: `listRoster(db:Db, year:number, role?:Profile["role"]): Promise<RosterRow[]>` — `included=true`만 일반 명부로 반환한다. 전환 검토는 제외 후보를 별도로 읽는다.
- Produces: `createDraftYear(db, input:MutationInput & {year:number; sourceYear?:number}): Promise<MutationReceipt>`.
- Produces: `upsertRosterProfile(db, input:RowMutationInput & {year:number; entryId?:string; email:string; profile:Profile}): Promise<MutationReceipt>` — 기존 사용자는 `withUserMutation`. 신규 추가(userId 없음)만 `withAcademicMutation`을 쓴다.
- Produces: transaction-only `writeRosterProfiles(tx, year:number, rows:RosterRow[]): Promise<MutationSummary>` — 일괄 쓰기. Task 7·8 재사용. 행 수와 무관하게 쿼리 수가 상수여야 한다.

- [ ] **Step 1 — 초안 격리·과거 조회 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
const original = await db.user.findUniqueOrThrow({ where: { id: fx.studentId } });
await createDraftYear(db, { actor: fx.main, requestId: "draft-2027", expectedVersion: fx.version,
  kind: "DRAFT", payloadHash: "draft-2027-hash", year: 2027, sourceYear: 2026 });
const [copied] = (await listRoster(db, 2027, "STUDENT"));
expect(copied.userId).toBe(fx.studentId);
expect(await db.user.findUnique({ where: { id: fx.studentId } })).toEqual(original);
expect(await db.userAcademicRecord.count({ where: { year: 2027 } })).toBe(0);
```

같은 파일에 서로 다른 학생 두 명의 셀을 병렬 편집하면 둘 다 성공하고 같은 학생을 같은 행 버전으로 두 번 편집하면 하나만 성공함, 신규 초안 이메일로 User가 생성되지 않음, 과거 profile 정정이 현재 User를 바꾸지 않음, 조회에 profile 결측이 있으면 현재값 fallback 없음, 일반 DELETE가 User를 삭제하지 않음을 추가한다.
- [ ] **Step 2 — 실패 확인.** profile 단위 테스트와 roster DB 테스트.
- [ ] **Step 3 — 입력 검증·연도 상태 분기.** 문자열을 trim하고 이메일 비교는 소문자화하되 기존 email 표시값은 자동 변경하지 않는다. 학생 1~3학년, 양의 정수 반·번호, 이름·성별을 검사한다. 교사 담임은 빈 문자열→null 또는 `^[1-3]-[1-9][0-9]*$`로 제한한다. 관련 없는 역할 필드는 null로 정규화한다.
- [ ] **Step 4 — 초안 복사.** 원본 연도 명부의 사용자 ID·이메일·최종 Profile을 `RosterEntry.draftProfile`에 복사하고 현재 `profileVersion`을 저장한다. 자동 진급·User 생성·로그인 활성화는 하지 않는다. Task 2의 `draftEmail`로 신규 초안 이메일의 표시값을 보존하고 `included=true`로 시작한다. 확정 뒤 draftEmail은 null로 정리한다. 초안 복사·편집·누락 포함 상태 변경은 대상 AcademicYear.version을 증가시켜 이전 검토를 무효화한다.
- [ ] **Step 5 — active/archived 쓰기.** ACTIVE 행은 연도 기록과 User 호환 필드를 같은 transaction으로 갱신한다. ARCHIVED는 연도 기록만 수정한다. 학생 학번을 서로 맞바꾸는 일괄 변경은 Task 7의 전체 최종 상태 검사 뒤, 같은 transaction에서 학번이 바뀌는 행의 `number`를 먼저 `-userId`(임시 음수)로 일괄 갱신하고 이어서 최종 값을 일괄 갱신해 unique의 중간 충돌을 피한다. `needsReview`는 백필 결측 표시 전용이며 제약 우회에 쓰지 않는다. `number > 0` 검증은 애플리케이션 계층(Zod)에 두고 DB CHECK로 걸지 않는다. transaction 밖에 중간 상태를 노출하지 않는다.

```ts
if (yearRow.state === "DRAFT") {
  await tx.rosterEntry.update({ where: { id: row.entryId }, data: {
    draftProfile: row.profile, draftEmail: row.email,
    version: { increment: 1 },
  } });
} else {
  await tx.userAcademicRecord.update({ where: { year_userId: { year, userId: row.userId! } },
    data: { ...row.profile, version: { increment: 1 } } });
  if (yearRow.state === "ACTIVE") {
    await tx.user.update({ where: { id: row.userId! }, data: { ...row.profile, profileVersion: { increment: 1 } } });
  }
}
```

위 코드는 한 행의 분기를 보여주는 것이며, `writeRosterProfiles`는 같은 분기를 행 배열에 대해 일괄 SQL(`UPDATE ... FROM (VALUES ...)`/`createMany`)로 수행한다. 1,000행 입력에서 쿼리 수가 행 수에 비례하지 않음을 테스트에서 쿼리 로그 건수로 확인한다.

신규 ACTIVE 행은 User/Record/Entry와 최초 AccessEvent를 함께 만들고 신규 DRAFT 행은 Entry만 만든다. 기존 역할 변경·이메일 변경은 이 경로로 받지 않는다. 교사 Excel에 없는 gender는 기존 연도 값(초안은 draft 값)을 보존하며 신규 교사만 null로 시작한다. `writeRosterProfiles`는 대상 존재와 source version을 먼저 검사하며 호출자는 최신 관리 권한을 검사한다. 모든 명부 변경에서 year.version, 확정 연도 Profile.version을 증가시키며 ACTIVE이면 User.profileVersion도 증가한다. ARCHIVED의 신규 명부 추가/Excel 반영은 제공하지 않고 남은 명부 편집 또는 보존 기록 정정만 허용한다.
- [ ] **Step 6 — API·옛 API 경계.** `/api/admin/users`의 GET/POST/PUT은 활성 연도 서비스로 연결하고 명시 `academicYear`가 있으면 그 연도를 사용한다. Task 4A의 `mirrorUsersToActiveYear` 호출은 이 서비스로 대체하며 제거한다. PUT은 대상 행 버전(`expectedRowVersion`)을 받고, GET은 행마다 버전을 돌려준다. DELETE는 Task 4A의 409를 유지한다. 관리자는 새 학년도/과거 record route를 사용하며 원본 User 직접 update 코드를 남기지 않는다.
- [ ] **Step 7 — 테스트·커밋.** `feat: add draft and yearly roster services`.

## Task 6: 두 시트 Excel 양식·원본 대응·파서

**Files**
- Create: `src/lib/academic-year/workbook.ts`, `workbook-parser.ts`, `export-service.ts`
- Create: `src/app/api/admin/academic-years/[year]/template/route.ts`
- Test: `src/lib/__tests__/academic-workbook.test.ts`, `tests/integration/academic-export.test.ts`

**Interfaces**
- Produces: `WorkbookManifest = {schemaVersion:1; fileId:string; year:number; version:number; rows:Record<string,{entryId:string;userId:number|null;email:string;version:number}>}`.
- Produces: `buildRosterWorkbook(input:{year:number;rows:RosterRow[];includeData:boolean;manifest:WorkbookManifest;currentProfiles?:Map<number,AcademicProfile>}): Promise<Buffer>`.
- Produces: `parseRosterWorkbook(buffer:ArrayBuffer): Promise<{fileId:string;year:number;rows:Array<{sheet:"학생"|"교사";row:number;email:string;profile:Profile;rowToken?:string}>;issues:RowIssue[];coveredRoles:Profile["role"][]}>`.
- Produces: `exportRoster(db, actor:Actor, year:number, includeData:boolean, includeCurrent:boolean): Promise<Buffer>`.

- [ ] **Step 1 — 왕복·수식·빈 시트·행 정렬 테스트.**

```ts
const manifest: WorkbookManifest = { schemaVersion: 1, fileId: "file-1", year: 2026, version: 2, rows: {} };
const buffer = await buildRosterWorkbook({ year: 2026, rows: [], includeData: false, manifest });
const parsed = await parseRosterWorkbook(Uint8Array.from(buffer).buffer);
expect(parsed.rows).toEqual([]);
expect(parsed.coveredRoles).toEqual([]);
expect(parsed.issues).toEqual([]);
const book = new ExcelJS.Workbook();
await book.xlsx.load(buffer);
expect(book.worksheets.filter(s => s.state === "visible").map(s => s.name)).toEqual(["학생", "교사"]);
expect(book.getWorksheet("학생")!.getCell("A1").text).toBe("이메일");
```

정렬 후 rowToken이 다른 사람을 가리키면 차단, 학생/교사 간 같은 이메일, 누락 헤더/부분 입력 행, `formula`·`sharedFormula` 셀, richText·hyperlink email, 숫자 문자열, 참고용 현재학급 열 무시도 테스트한다.
- [ ] **Step 2 — 실패 확인.** `npx vitest run src/lib/__tests__/academic-workbook.test.ts`.
- [ ] **Step 3 — 고정 양식 구현.** 1행 한국어 헤더, 2행부터 데이터, 첫 행 고정·필터·열 너비·이메일 텍스트 형식. 학생 A~F와 교사 A~E는 spec 그대로다. 참고 열은 명시 `참고_현재학년/반/번호`로 뒤에 추가한다. 사용자 행 토큰은 숨김 열 `__rowToken`, 파일 정보는 veryHidden `__meta` 시트에 둔다. Excel의 숨김·보호를 보안 수단으로 신뢰하지 않는다.
- [ ] **Step 4 — 서버 manifest 등록.** 다운로드마다 `RosterFile`에 대응표와 대상 year/version을 기록한다. 토큰은 `crypto.randomUUID()`로 발급한다. 원본에 있던 userId는 클라이언트 숨김 값이 아니라 서버 manifest에서 찾는다. `includeData=false`(양식만)이면 `RosterFile` 행을 만들지 않고 `__meta`에 `schemaVersion`·`year`·`templateOnly=true`만 넣는다. 대응표에는 행별 버전(`UserAcademicRecord.version`, 초안은 `RosterEntry.version`)을 기록해 Task 7의 행 단위 충돌 판단에 쓴다. 권한 포함 열은 생성하지 않는다. 다운로드 처리 끝에 Task 7의 `purgeExpiredRosterCopies`를 호출한다.
- [ ] **Step 5 — 파서 구현.** 헤더를 이름으로 읽고 필요한 시트/열을 모두 확인한다. 행 단위 parse 실패를 조용히 건너뛰지 않고 위치별 `RowIssue`로 만든다. 셀 변환 공용 함수를 만들어 수식 거절·문자열·숫자·richText·hyperlink의 화면 문자열만 수용한다. 빈 교사 시트는 역할 미포함으로 반환한다. `__meta` 시트가 없거나 `schemaVersion`이 다르면 422로 표준 양식 다운로드를 안내한다. 양식만 받은 파일은 `__meta`의 연도만 검증하고 서버 대응표를 요구하지 않는다. 기존 데이터 포함 파일인데 서버의 `RosterFile`이 없으면(30일 경과) 새로 내려받도록 안내한다.
- [ ] **Step 6 — 다운로드 서비스 테스트.** 삭제된 명부 항목은 Record를 통해 일반 명부로 재생성하지 않으며, 과거 내역 출력만 Record를 사용함을 검사한다. 권한 없는 학생의 명부 다운로드는 403이어야 한다.
- [ ] **Step 7 — 테스트·커밋.** `feat: add two-sheet roster workbook with source manifests`.

## Task 7: 파일 미리보기·원자적 반영

**Files**
- Create: `src/lib/academic-year/import-service.ts`, `src/lib/academic-year/retention.ts`
- Create: `src/app/api/admin/academic-years/[year]/imports/route.ts`, `src/app/api/admin/academic-years/[year]/imports/[id]/route.ts`(충돌 선택 PATCH·취소 DELETE), `src/app/api/admin/academic-years/[year]/imports/[id]/commit/route.ts`
- Test: `tests/integration/academic-import.test.ts`

**Interfaces**
- Produces: `previewRosterImport(db, actor:Actor, year:number, scope:ImportScope, file:ArrayBuffer): Promise<ImportPreview>`.
- Produces: `resolveImportConflicts(db, actor:Actor, importId:string, choices:Array<{token:string;resolution:"USE_FILE"|"KEEP_SERVER"}>): Promise<ImportPreview>` — 선택을 서버의 preview에 저장한다.
- Produces: `commitRosterImport(db, input:MutationInput & {importId:string;confirmedNewRowTokens:string[];omissionsConfirmed:boolean}): Promise<MutationReceipt>`.
- Produces: `cancelRosterImport(db, actor:Actor, importId:string): Promise<void>`, `purgeExpiredRosterCopies(db, now:Date): Promise<void>`(`retention.ts`) — spec §4.4의 기간대로 `RosterImport.payload/preview`, `RosterFile`, `KioskSnapshot`, 해결된 `LocalCheckInReview.payload`를 정리한다. 실패해도 호출한 요청을 실패시키지 않는다.
- Consumes: manifest·parser, row schema, latest Actor, `writeRosterProfiles`, common mutation.

- [ ] **Step 1 — 전체 rollback·오래된 파일·학생 번호 교환 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
const exported = await exportRoster(db, fx.main, 2026, true, false);
const book = new ExcelJS.Workbook();
await book.xlsx.load(exported);
book.getWorksheet("학생")!.getCell("E2").value = "수정이름";
const workbookBytes = Uint8Array.from(await book.xlsx.writeBuffer()).buffer;
const preview = await previewRosterImport(db, fx.main, 2026, "PARTIAL", workbookBytes);
expect(preview.rows.map(r => r.kind)).toContain("CHANGED");
await db.user.update({ where: { id: fx.teacherId }, data: { profileVersion: { increment: 1 } } });
await expect(commitRosterImport(db, { actor: fx.main, requestId: "import-1", kind: "IMPORT",
  expectedVersion: preview.controlVersion, payloadHash: "input-hash", importId: preview.id,
  confirmedNewRowTokens: [], omissionsConfirmed: false })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
expect((await db.user.findUniqueOrThrow({ where: { id: fx.studentId } })).name).toBe("학생테스트");
```

위 teacher version 변경은 **미리보기 이후**의 변경이라 확정 재검사에서 `VERSION_CONFLICT`로 재미리보기를 요구하는 사례다. **내보낸 뒤·미리보기 전**의 변경은 행 단위 충돌로 다룬다.

```ts
await db.userAcademicRecord.update({ where: { year_userId: { year: 2026, userId: fx.teacherId } },
  data: { subject: "서버에서 정정", version: { increment: 1 } } });
const conflicted = await previewRosterImport(db, fx.main, 2026, "PARTIAL", workbookBytes);
expect(conflicted.rows.filter(r => r.kind === "CONFLICT")).toHaveLength(1);
expect(conflicted.rows.some(r => r.kind === "CHANGED")).toBe(true); // 학생 행은 정상 미리보기
expect(conflicted.canCommit).toBe(false);
const conflictToken = conflicted.rows.find(r => r.kind === "CONFLICT")!.token;
const resolved = await resolveImportConflicts(db, fx.main, conflicted.id, [{ token: conflictToken, resolution: "KEEP_SERVER" }]);
expect(resolved.canCommit).toBe(true);
```

확정 뒤 `RosterImport.payload`·`preview`가 null이고 `summary`만 남는지, 1,000행 합성 파일의 확정이 60초 제한 안에 끝나는지도 검사한다. 반영 도중 실제 unique 실패를 일으키는 별도 케이스에서는 학생/교사 양쪽과 RosterMutation 모두 rollback됐음을 원본 manifest로 비교한다. 두 학생 번호 교환은 최종 상태가 유일하면 성공해야 한다.
- [ ] **Step 2 — 실패 확인.** `npm run test:academic -- academic-import.test.ts`.
- [ ] **Step 3 — 순수 비교 후 preview 저장.** ACTIVE/DRAFT만 반영 대상으로 허용하고 ARCHIVED는 기록 정정 화면을 안내한다. source manifest의 대상 year와 원본 대응을 확인한다. 학년도 버전이 달라졌다는 이유로 파일 전체를 거절하지 않는다. 대응표의 **행 버전**이 서버 현재 버전과 다른 행만 `CONFLICT`로 분류해 서버 현재 값(`server`)을 함께 보여주고, `resolution`이 모두 채워질 때까지 `canCommit=false`다. `KEEP_SERVER` 행은 확정 때 쓰지 않는다. 이메일은 `emailKey`로 기존 사용자를 찾지만 rowToken이 가리키는 원본 이메일이 바뀌었으면 `IDENTITY_CONFLICT`다. 이름 유사도·학번으로 자동 병합하지 않는다. 보낸 행 외 기존 대상 명부도 포함해 최종 학번 충돌을 검사한다. 교사 gender는 파일에서 갱신하지 않는다. 기존 행 토큰이 제거된 파일은 신규로 추정하지 않고 다시 다운로드하도록 안내한다. 양식만 받은 파일의 토큰 없는 미등록 이메일은 명시 확인 후 신규로 처리한다.
- [ ] **Step 4 — 범위·누락 규칙 구현.** PARTIAL은 누락을 처리하지 않는다. FULL은 데이터가 있는 역할만 대조하고 누락 ID를 보여준다. DRAFT의 FULL 확정은 `omissionsConfirmed=true`를 받아 누락 초안 행을 `included=false`인 확인 후보로 표시한다. User·지난 명부를 삭제하거나 종료 상태를 확정하지 않는다. 파일에 포함된 행은 included=true다. ACTIVE의 FULL은 누락 목록만 반환하며 재학/재직 상태를 바꾸지 않는다. 헤더뿐인 시트는 그 역할을 건드리지 않는다. 최종 전환 대조는 Task 8이 전체 역할에 대해 다시 수행한다. preview의 각 행에 확인용 token을 발급하고 입력을 서버에 보관한다. 확정 body에서 다른 행을 받지 않는다.
- [ ] **Step 5 — 원자 commit.** 신규 행은 미리보기의 opaque 토큰으로 명시 확인받는다. 확인 없이 신규를 생성하지 않는다. RosterImport 상태·Actor·미리보기 시점의 행 버전·현재 명부를 다시 확인하고(미리보기 뒤 바뀐 행이 있으면 `VERSION_CONFLICT`로 재미리보기) 전체 최종 상태를 검증한 후 학생·교사를 같은 transaction에서 `writeRosterProfiles` 한 번으로 반영한다. DRAFT면 User 변경이 없는 서비스 분기를 사용한다. `state=COMMITTED`와 request result를 같은 transaction에 저장한다.

```ts
await withAcademicMutation(db, input, tx => assertActor(tx, input.actor, "WRITE_ADMIN"), async tx => {
  const batch = await tx.rosterImport.findUniqueOrThrow({ where: { id: input.importId } });
  const preview = batch.preview as unknown as ImportPreview;
  if (!preview.canCommit || preview.rows.some(r => r.issues.length)) throw new DomainError("REVIEW_REQUIRED");
  const rows = preview.rows
    .filter(r => r.kind !== "SAME" && r.resolution !== "KEEP_SERVER")
    .map(r => r.input);
  const summary = await writeRosterProfiles(tx, preview.year, rows);
  await tx.rosterImport.update({ where: { id: batch.id }, data: {
    state: "COMMITTED", payload: Prisma.DbNull, preview: Prisma.DbNull,
    summary: { changed: summary.changed, year: preview.year },
  } });
  return summary;
});
```

검증·전체 학번 충돌 검사·신규 확인은 위 쓰기 loop 전에 완료한다. idempotency payload hash에는 import ID·신규 확인 토큰·대상 연도·Actor를 포함한다.
- [ ] **Step 5A — 사본 정리.** 취소는 즉시 `payload/preview`를 비우고 `CANCELLED`로 둔다. `purgeExpiredRosterCopies`는 24시간 지난 `PREVIEW`를 `EXPIRED`로 비우고, 30일 지난 `RosterFile`·`KioskSnapshot`(PENDING 검토가 참조하는 것은 제외)을 삭제하며, 해결 30일 지난 검토 payload를 비운다. 미리보기 요청 처리 끝에 try/catch로 호출한다. 시간 주입 테스트로 경계(23h59m/24h, 29일/30일, PENDING 참조 유지)를 검사한다.
- [ ] **Step 6 — API 파일 제한.** multipart `file`을 받아 기존 `MAX_FILE_SIZE_MB` 제한을 읽고 파싱 전에 검사한다. malformed xlsx는 422, 용량 초과는 413, 권한은 403, stale는 409. 확정 route의 Next 16 `params`는 `await params`한다.
- [ ] **Step 7 — 재시도/동시 요청 테스트·커밋.** 동일 키 재요청 결과 동일, 같은 키 다른 입력 거절, 두 관리자의 preview 중 한쪽만 commit되는 DB 테스트 후 `feat: preview and atomically commit roster imports`.

## Task 8: 누락자 대조·학년도 전환

**Files**
- Create: `src/lib/academic-year/rollover-service.ts`
- Create: `src/app/api/admin/academic-years/[year]/review/route.ts`, `src/app/api/admin/academic-years/[year]/decisions/route.ts`, `src/app/api/admin/academic-years/[year]/activate/route.ts`
- Test: `tests/integration/academic-rollover.test.ts`

**Interfaces**
- Produces: `RolloverWarnings = {futureMealDatesOfLeavers:number;remainingMealDatesInSourceYear:number;studentsWithSameGrade:number}`.
- Produces: `RolloverReview = {year:number;version:number;yearVersion:number;sourceVersion:number;missing:Array<{userId:number;role:Profile["role"];suggested:MemberState|null}>;issues:string[];warnings:RolloverWarnings;canActivate:boolean}`. version은 control, sourceVersion은 현재 ACTIVE 연도 version이다.
- Produces: `reviewRollover(db, actor:Actor, year:number): Promise<RolloverReview>`.
- Produces: `saveRolloverDecision(db, input:MutationInput & {year:number;userId:number;decision:"GRADUATED"|"TRANSFERRED"|"RETIRED"|"RESTORE"}): Promise<MutationReceipt>`.
- Produces: `activateAcademicYear(db, input:MutationInput & {year:number;yearVersion:number;sourceVersion:number;kiosksPaused:boolean;warningsAcknowledged:boolean}): Promise<MutationReceipt>`. 아래 테스트 예시의 호출에는 `warningsAcknowledged: true`를 함께 넘긴다(Task 9의 예시 포함).

- [ ] **Step 1 — 누락 미확인 전환 차단·전환 실패 rollback 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
await db.userAcademicRecord.update({ where: { year_userId: { year: 2026, userId: fx.studentId } }, data: { grade: 3 } });
await createDraftYear(db, { actor: fx.main, requestId: "draft-review", kind: "DRAFT",
  payloadHash: "draft-review", expectedVersion: fx.version, year: 2027, sourceYear: 2026 });
await db.rosterEntry.updateMany({ where: { year: 2027, userId: fx.studentId }, data: { included: false } });
const review = await reviewRollover(db, fx.main, 2027);
expect(review.canActivate).toBe(false);
expect(review.missing).toEqual(expect.arrayContaining([expect.objectContaining({ userId: fx.studentId, suggested: "GRADUATED" })]));
await expect(activateAcademicYear(db, { actor: fx.main, requestId: "rollover-1", kind: "ACTIVATE",
  payloadHash: "rollover-hash", expectedVersion: review.version, year: 2027,
  yearVersion: review.yearVersion, sourceVersion: review.sourceVersion, kiosksPaused: true }))
  .rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
expect((await db.academicYear.findFirstOrThrow({ where: { state: "ACTIVE" } })).year).toBe(2026);
```

추가: 경고 값이 0이 아닌데 `warningsAcknowledged=false`면 `REVIEW_REQUIRED`, 초안을 고치지 않고 복사만 한 경우 `studentsWithSameGrade`가 학생 수와 같음, 졸업 처리된 학생에게 미래 확정 식사일이 있으면 `futureMealDatesOfLeavers`에 집계되고 전환 뒤에도 그 확정일 행은 그대로임, 종료된 사용자의 `FaceProfile`만 삭제되고 계속 재학하는 학생의 얼굴 등록·ID는 유지, 1,000명 합성 명부 전환이 60초 제한 안에 완료. 신규 학생은 전환 전 User 없음/전환 후 User 생성, teacher adminLevel 유지, 원래 학생 ID·얼굴 유지, 두 전환 동시 실행 한쪽만 성공, 전환 뒤에도 기존 확정일 동일.
- [ ] **Step 2 — 실패 확인.** rollover integration 테스트.
- [ ] **Step 3 — 전체 대조.** 현재 ACTIVE의 재학/재직 사용자와 DRAFT의 included=true 행을 대조한다. 파일 업로드의 coveredRoles와 별개로 최종 전체 대조는 학생·교사를 모두 포함한다. blank 시트 때문에 전원을 종료하지 않는다. 3학년은 suggested만 설정한다. 각 누락에 종료 또는 RESTORE를 명시하고, RESTORE는 초안 행을 included=true로 복원하되 새 배정 검토가 완료돼야 한다. 학생 RETIRED·교사 GRADUATED는 거절한다.
- [ ] **Step 4 — 대조 버전.** review는 control 배타 잠금 안에서 전체 대조와 `reviewedVersion/reviewedSourceVersion` 기록을 수행한다. 이 검토 메타데이터 저장 자체로 content version을 올리지는 않는다. 이후 초안 변경·원본 상태 변경은 검토 결과를 무효화한다. 비활성 계정의 재활성화는 Task 4 메인 확인이 없으면 blocker다. `kiosksPaused`는 물리 장치 확인을 대신하지 않으며 화면에서 운영자가 확인한 사실을 기록하는 값이다.
- [ ] **Step 4A — 전환 경고 집계.** review에서 세 값을 계산한다: 종료 결정 사용자의 오늘 이후 APPROVED 확정 식사일 수, 현재 ACTIVE 학년도 범위에 남은 오늘 이후 APPROVED 확정 식사일 수, 초안의 학년이 원본 학년도와 같은 학생 수. 3월 1일 이전 전환도 막지 않는다. 하나라도 0이 아니면 `activateAcademicYear`는 `warningsAcknowledged=true`를 요구하고, 집계값을 결과 요약에 남긴다.
- [ ] **Step 5 — 하나의 전환 transaction.** 공통 배타 잠금(`ROSTER_TX`) → MAIN/READY 검사 → 원본·초안 version 재검사 → 누락/중복/필수값·경고 확인 검사 → 신규 User `createMany` → 모든 연도 기록 `createMany` → 현행 User 필드 일괄 UPDATE(`UPDATE ... FROM (VALUES ...)`) → 종료 계정은 Task 4의 `deactivateUsers`(상태·세션버전·AccessEvent·EligibilityEvent·`FaceProfile` 삭제) → 기존 ACTIVE를 ARCHIVED → 대상 DRAFT를 ACTIVE → 결과 요약 기록. 사용자별 loop를 돌지 않는다. 이 순서에서 기존 신청·확정일·체크인 행과 **계속 이용하는 사용자의** 얼굴 등록을 UPDATE/DELETE하지 않는다.

```ts
await tx.academicYear.update({ where: { year: sourceYear }, data: { state: "ARCHIVED" } });
await tx.academicYear.update({ where: { year: targetYear }, data: {
  state: "ACTIVE", activatedAt: new Date(), version: { increment: 1 },
} });
await tx.eligibilityEvent.create({ data: { scope: "ROLLOVER", occurredAt: new Date(), requestId: input.requestId } });
```

각 사용자 반영은 최신 adminLevel을 유지한다. 확정 RosterEntry는 원래 entryId를 유지하고 userId를 연결한 뒤 draftProfile/draftEmail을 null로 한다. 종료 결정된 included=false 초안 후보 행만 제거하며 기존 연도 명부는 유지한다. 종료한 사용자의 이전 학년도 Record는 학급값을 보존하면서 memberState를 결정된 상태로 갱신한다. ROLLOVER EligibilityEvent를 같은 transaction에 저장한다. 커밋 뒤 얼굴 후보 캐시를 invalidate한다(종료자 얼굴 등록 삭제 반영). 로컬 키오스크는 운영 학년도 불일치로 신규 저장이 막히므로 재동기화를 안내한다.
- [ ] **Step 6 — 접수 경계 반환.** 새 연도 신청 허용은 Task 10의 동일 active-year guard로 보장한다. 전환 날짜를 3월 1일로 강제하지 않되 식사일 귀속 연도는 바꾸지 않는다.
- [ ] **Step 7 — 테스트·커밋.** `feat: activate reviewed academic year without rebuilding meals`.

## Task 9: 과거 명부 삭제·표시정보 정정

**Files**
- Create: `src/lib/academic-year/archive-service.ts`
- Modify: `src/app/api/admin/academic-years/[year]/roster/route.ts`, `src/app/api/admin/academic-years/[year]/records/[userId]/route.ts`
- Test: `tests/integration/academic-archive.test.ts`

**Interfaces**
- Produces: `deleteArchivedRoster(db,input:MutationInput & {year:number;entryIds:string[]|"ALL"}): Promise<MutationReceipt>`.
- Produces: `correctAcademicRecord(db,input:MutationInput & {year:number;userId:number;profile:Profile}): Promise<MutationReceipt>`.

- [ ] **Step 1 — 물리 명부 삭제 후 내역 보존 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
await createDraftYear(db, { actor: fx.main, requestId: "draft-archive", kind: "DRAFT",
  payloadHash: "draft-archive", expectedVersion: fx.version, year: 2027, sourceYear: 2026 });
const review = await reviewRollover(db, fx.main, 2027);
const activated = await activateAcademicYear(db, { actor: fx.main, requestId: "activate-archive", kind: "ACTIVATE",
  payloadHash: "activate-archive", expectedVersion: review.version, year: 2027,
  yearVersion: review.yearVersion, sourceVersion: review.sourceVersion, kiosksPaused: true });
const original = await captureLegacyFingerprint(pgClient);
await deleteArchivedRoster(db, { actor: fx.main, requestId: "delete-2026", expectedVersion: activated.version,
  kind: "ARCHIVE_DELETE", payloadHash: "delete-hash", year: 2026, entryIds: "ALL" });
expect(await listRoster(db, 2026)).toEqual([]);
expect((await getAcademicProfiles(db, [fx.studentId], 2026)).get(fx.studentId)?.grade).toBe(1);
expect(compareLegacyFingerprints(original, await captureLegacyFingerprint(pgClient)).equal).toBe(true);
await backfill2026(db, original);
expect(await listRoster(db, 2026)).toEqual([]);
```

ACTIVE 삭제·교사 관리자 삭제 시도는 실패해야 한다. 위 테스트의 백필 source는 이미 COPIED 상태이므로 재실행이 아무것도 만들지 않아야 한다.
- [ ] **Step 2 — 실패 확인.** archive integration 테스트.
- [ ] **Step 3 — 삭제 서비스.** MAIN, 대상 ARCHIVED, expectedVersion과 entry 소속을 검사하고 `RosterEntry.deleteMany`를 수행한다. Record나 User 삭제 호출은 넣지 않는다. 전체 삭제(`"ALL"`)면 같은 transaction에서 그 학년도의 `RosterFile`을 삭제하고 `RosterImport.payload/preview`를 비운다(spec §4.4). 선택 삭제는 사본을 30일 규칙에 맡긴다. 삭제 건수·연도·사용자 ID만 감사 결과에 저장한다. 테스트는 삭제 뒤 해당 연도 `RosterFile` 0건과 import 사본 null을 확인한다.
- [ ] **Step 4 — 기록 정정.** 명부가 없어도 보존 Record를 userId/year로 찾는다. Profile만 정정하고 User나 다른 연도는 수정하지 않는다. 현재 학급 병기는 Task 11의 별도 조회다. 일반 명부 export가 Record를 다시 명부로 만들어 내지 않도록 테스트한다.
- [ ] **Step 5 — 테스트·커밋.** `feat: separate archived roster deletion from historical profiles`.

## Task 10: 공고·신청·재계산의 학년도 기준

**Files**
- Create: `src/lib/academic-year/registration-context.ts`, `eligibility-mutation.ts`
- Modify: `src/lib/meal-plan-server.ts`, `src/lib/schemas/meal-plan.ts`
- Modify: `src/app/api/applications/route.ts`, `src/app/api/applications/[id]/route.ts`, `src/app/api/applications/[id]/register/route.ts`
- Modify: `src/app/api/admin/applications/route.ts`, `src/app/api/admin/applications/[id]/route.ts`, `src/app/api/admin/applications/[id]/close/route.ts`
- Modify: `src/app/api/admin/applications/[id]/registrations/route.ts`, `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`, `src/app/api/admin/applications/[id]/import/route.ts`
- Test: `src/lib/__tests__/meal-plan-schema.test.ts`, `tests/integration/academic-registration.test.ts`, `tests/integration/academic-resync.test.ts`

**Interfaces**
- Consumes: `getAcademicProfiles`, `academicYearOfDate`, `assertActor`, `requireAcademicReady`; 기존 `resolveRegistrationSelections(applicationId, grade, meals, ctx)`·`writeRegistration` 재사용.
- Produces: `RegistrationIntent = "CREATE" | "EDIT" | "RESTORE" | "CANCEL"`.
- Produces: `getRegistrationContext(tx:Db, actor:Actor, applicationId:number, userId:number, intent:RegistrationIntent): Promise<{year:number;profile:AcademicProfile;resolveContext:ResolveContext}>`. `ResolveContext`는 기존 `meal-plan-server.ts`의 export 타입이다.
- Produces: `withEligibilityMutation<T>(db:PrismaClient, actor:Actor, change:{scope:"APPLICATION"|"REGISTRATION";applicationId?:number;userId?:number}, write:(tx:Prisma.TransactionClient)=>Promise<T>): Promise<T>` — **control 행을 잠그지 않는다.** 기존 공고는 `SELECT id FROM "MealApplication" WHERE id = $1 FOR UPDATE`로 공고 행만 잠그고(신규 공고는 잠금 없음), `RosterControl.mode`는 잠금 없이 읽어 READY를 검사하며, 현재 Actor 검사 뒤 성공 시 EligibilityEvent(autoincrement id)를 기록한다. 신규 공고의 applicationId가 아직 없으면 생성 후의 id로 기록한다. 공고 개시 직후 서로 다른 공고의 신청은 병렬로, 같은 공고의 신청은 공고 행에서만 직렬로 처리된다.
- Changes: `saveApplication(actor:Actor, input:AdminApplicationInput, id?:number)`에 Actor를 추가한다. `AdminApplicationInput`에 `academicYear:number`를 추가하며 기존 반환형은 유지한다.
- Changes: `resyncRegistrations(tx, applicationId:number): Promise<void>`는 공고 학년도 기록만 사용한다. `resolveRegistrationSelections`의 선택 계산 계약은 유지하고 호출자가 같은 transaction에서 읽은 ctx를 반드시 전달한다.

- [ ] **Step 1 — 초안 접수·제목 수정·과거 학년 테스트 작성.**

```ts
const fx = await prepareAcademicFixture(db);
await createDraftYear(db, { actor: fx.main, requestId: "draft-for-meals", kind: "DRAFT",
  payloadHash: "draft-for-meals", expectedVersion: fx.version, year: 2027, sourceYear: 2026 });
const app = await db.mealApplication.findUniqueOrThrow({ where: { id: fx.applicationId }, include: { meals: true, mealDates: true } });
const dateOrder = [{ registrationId: "asc" }, { mealKind: "asc" }, { date: "asc" }] as const;
const daysBefore = await db.mealRegistrationMealDate.findMany({ orderBy: [...dateOrder] });
const input = applicationInputFromFixture(app);
await saveApplication(fx.main, { ...input, subject: "제목만 정정" }, fx.applicationId);
expect(await db.mealRegistrationMealDate.findMany({ orderBy: [...dateOrder] })).toEqual(daysBefore);
await db.mealApplication.update({ where: { id: fx.applicationId }, data: { academicYear: 2027 } });
await expect(getRegistrationContext(db, fx.main, fx.applicationId, fx.studentId, "CREATE"))
  .rejects.toMatchObject({ code: "YEAR_MISMATCH" });
```

`applicationInputFromFixture(app): AdminApplicationInput`를 `tests/integration/support/academic-fixture.ts`에 추가한다. 입력 타입은 `Prisma.MealApplicationGetPayload<{include:{meals:true;mealDates:true}}>`다. 구현은 다음처럼 필드를 열거하고 schema로 최종 검증한다.

```ts
return adminApplicationSchema.parse({
  academicYear: app.academicYear, subject: app.title, description: app.description ?? "",
  startYear: app.startYear, startMonth: app.startMonth, monthCount: app.monthCount,
  applyStartAt: app.applyStartAt?.toISOString(), applyEndAt: app.applyEndAt?.toISOString(),
  meals: app.meals.map(meal => ({ mealKind: meal.mealKind, price: meal.price,
    exemptionSelectable: meal.exemptionSelectable, method: meal.method,
    dates: app.mealDates.filter(day => day.mealKind === meal.mealKind)
      .map(day => ({ grade: day.grade, date: day.date.toISOString().slice(0, 10) })),
  })),
});
```

추가 테스트는 명부 전역 배타 잠금이 잡혀 있는 동안에도 학생 신청이 대기 없이 성공함, 같은 공고에 대한 50건 병렬 신청이 모두 성공하고 EligibilityEvent가 50건 남음, 모든 CREATE/RESTORE 경로의 초안 차단, 과거 공고 재계산 시 2026 grade 사용, 연도 기록 누락 시 확정일 삭제 전 rollback, 2월/3월 경계 공고 거절을 포함한다.
- [ ] **Step 2 — 실패 확인.** `npm run test:academic -- academic-registration.test.ts academic-resync.test.ts`와 기존 schema 테스트.
- [ ] **Step 3 — 공고 기간 검증.** 선택한 전체 대상 식사일과 월 범위가 `academicYearBounds(input.academicYear)` 안에 있어야 한다. 초안 연도 공고의 작성·수정은 허용하지만 공개 접수 목록에 넣지 않는다. 이미 신청이 있는 공고의 학년도 변경은 거절한다. 기존 공고의 nullable year가 남으면 READY를 차단한다.
- [ ] **Step 4 — 모든 신청 분기에서 공통 자격 검사.** CREATE/RESTORE는 운영 연도·이용 가능 사용자만 허용한다. 학생 본인은 운영 연도 본인 신청만 수정/취소한다. 쓰기 관리자의 과거 EDIT/CANCEL은 현재 졸업 상태만으로 막지 않으며 당시 Profile로 처리한다. 다른 학생을 지정한 일반 계정, 초안, 연도 정보 결측은 거절한다. PATCH의 상태 복원 분기, 관리자 대리 신청, 신청 Excel 경로도 예외 없이 이 검사를 사용한다.
- [ ] **Step 5 — 재계산 범위 축소.** `saveApplication`에서 자격 입력(식사 종류·방법·면제 선택 규칙·대상 월/개설일)을 정규화해 이전값과 비교한다. 제목·설명·접수 안내만 바뀌면 resync하지 않는다. resync할 때는 모든 관련 학생의 연도 grade와 선택 유효성을 **삭제 전에** 확인한다.

```ts
const profiles = await getAcademicProfiles(tx, registrations.map(r => r.userId), application.academicYear);
for (const registration of registrations) {
  const profile = profiles.get(registration.userId);
  if (!profile || profile.grade === null) throw new DomainError("MISSING_PROFILE");
}
// 이 사전검사 이후에만 기존 확정일 재계산·교체를 수행한다.
```

공고·신청 변경은 `withEligibilityMutation`으로 감싼다. 트랜잭션 안에서 기존 resolver가 global prisma를 읽지 않도록 `resolveContext`를 반드시 넘긴다. 명부 수정·전환에서는 resync를 호출하지 않는다.
- [ ] **Step 6 — 신청 Excel 매칭.** 새 신청 양식의 이메일로 User를 찾고 공고 연도 Profile로 검증한다. 이메일 없는 기존 양식은 해당 연도 학번 후보를 배열로 수집해 정확히 1명일 때만 수용한다. 중복 후보를 Map 마지막 값으로 덮어쓰지 않는다. 학생별 검증 실패 시 전체 신청 import를 rollback하며 초안 등록도 거절한다.
- [ ] **Step 7 — 회귀·커밋.** 기존 meal-plan·schema·template-columns 테스트와 신규 DB 테스트 후 `feat: scope meal registration and resync to academic year`.

## Task 11: 과거 내역·통계·담임 접근 범위

**Files**
- Create: `src/lib/academic-year/report-profile.ts`, `teacher-scope.ts`
- Modify: `src/app/api/admin/checkins/route.ts`, `src/app/api/admin/checkins/toggle/route.ts`, `src/app/api/admin/dashboard/route.ts`, `src/app/api/admin/export/route.ts`
- Modify: `src/app/api/admin/applications/[id]/registrations/route.ts`, `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts`, `src/app/api/admin/applications/[id]/export/route.ts`
- Modify: `src/app/api/teacher/students/route.ts`, `src/app/api/teacher/applications/route.ts`, `src/app/api/teacher/applications/[id]/registrations/route.ts`
- Modify: `src/app/api/applications/my/route.ts`, `src/app/api/users/me/route.ts`, `src/lib/meal-stats-excel.ts`
- Test: `tests/integration/academic-reports.test.ts`, `src/lib/__tests__/meal-stats-excel.test.ts`

**Interfaces**
- Produces: `ReportProfile = {userId:number;year:number;historical:AcademicProfile|null;current:AcademicProfile|null;currentState:string;warning:string|null}`.
- Produces: `getReportProfiles(db:Db, ids:number[], year:number, includeCurrent:boolean): Promise<Map<number,ReportProfile>>`.
- Produces: `getTeacherScope(db:Db, actor:Actor): Promise<{year:number;grade:number;classNum:number}|null>` — 재직 교사의 ACTIVE 업무만 해석한다.
- Consumes: `getAcademicProfiles`, `academicYearOfDate`, 최신 Actor 검증. `StatsExcelInput/buildStatsWorkbook`은 DB 없는 순수 입력 구조를 유지한다.

- [ ] **Step 1 — 명부 삭제 뒤 과거 표기·담임 범위 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
await db.user.update({ where: { id: fx.studentId }, data: { grade: 2, classNum: 3 } });
await db.rosterEntry.deleteMany({ where: { year: 2026 } });
const profiles = await getReportProfiles(db, [fx.studentId], 2026, false);
expect(profiles.get(fx.studentId)?.historical?.grade).toBe(1);
expect(profiles.get(fx.studentId)?.historical?.classNum).toBe(1);
await db.userAcademicRecord.deleteMany({ where: { year: 2026, userId: fx.studentId } });
const missing = await getReportProfiles(db, [fx.studentId], 2026, false);
expect(missing.get(fx.studentId)?.historical).toBeNull();
expect(missing.get(fx.studentId)?.warning).toBe("학년도 정보 확인 필요");
```

결측 생성은 테스트에서만 수행한다. 다른 사례: 현재 담당반 교사의 이전 연도 요청 403, 잘못된 담임 문자열은 scope 없음, 재직 교사의 본인 과거 조회 성공, 조기 전환 후 2월 잔여 확정일 유지, 졸업자의 현재학급 칸에 과거 학급을 복사하지 않음.
- [ ] **Step 2 — 실패 확인.** `npm run test:academic -- academic-reports.test.ts`.
- [ ] **Step 3 — 조회 출발점 교체.** 과거 명단은 현재 재학생·RosterEntry 목록이 아니라 해당 연도 기록/신청/체크인에서 사용자 ID를 수집한다. 식사일은 KST dateKey의 학년도, 신청은 공고의 학년도로 일괄 Profile을 읽는다. 정렬·이름·성별·담당 업무도 이 Profile을 사용한다. 월/일 다운로드 두 분기를 모두 수정한다.

```ts
const year = academicYearOfDate(dateKey);
const profiles = await getReportProfiles(db, userIds, year, includeCurrent);
const display = profiles.get(userId);
const classLabel = display?.historical
  ? `${display.historical.grade ?? ""}-${display.historical.classNum ?? ""}`
  : "학년도 정보 확인 필요";
```

위 `dateKey/userIds/userId/includeCurrent`는 기존 조회 요청·결과에서 얻는 지역 변수다. 현재 소속 병기는 `includeCurrent=true`일 때 별도 열에만 넣는다. 기본 Excel은 과거 연도 최종 학급이다. 새 신청 양식에도 이메일 A열과 공고 학년도를 넣되 기존 신청 선택 열 처리 유틸은 재사용한다.
- [ ] **Step 4 — 담임·본인 분리.** 교사 명단 API는 ACTIVE 연도 및 `getTeacherScope` 결과로 학생을 제한한다. URL/body로 다른 연도·반을 지정해도 확대하지 않는다. 본인 과거 신청/체크인 목록은 계속 제공한다. 오늘 식사 자격은 확정 날짜로 읽고 ACTIVE 공고만 남기는 필터를 추가하지 않는다.
- [ ] **Step 5 — 관리자 체크인 정정.** toggle은 최신 WRITE_ADMIN과 날짜 연도 Profile을 검사한다. 과거 정정 대상이 현재 졸업했다는 이유로 이력을 숨기지 않는다. 권한·날짜 검증과 기록 변경을 같은 transaction에서 수행하고 식사 원본의 고유키를 유지한다.
- [ ] **Step 6 — 회귀·커밋.** 일별/월별/공고 통계·현재학급 선택 출력 테스트와 기존 Excel 테스트를 통과시킨 뒤 `feat: preserve academic year labels in reports and teacher views`.

## Task 12: 온라인 판정·서버 동기화 근거·지연 업로드 검토

**Files**
- Create: `src/lib/academic-year/kiosk-snapshot.ts`, `upload-review.ts`
- Modify: `src/app/api/checkin/route.ts`, `src/app/api/facecheck/route.ts`, `src/lib/face-embedding-cache.ts`
- Modify: `src/app/api/sync/download/route.ts`, `src/app/api/sync/upload/route.ts`
- Create: `src/app/api/admin/checkin-reviews/route.ts`, `src/app/api/admin/checkin-reviews/[id]/route.ts`
- Test: `src/lib/__tests__/sync-download.test.ts`, `src/lib/__tests__/sync-upload.test.ts`, `src/lib/__tests__/facecheck-route.test.ts`, `src/lib/__tests__/face-embedding-cache.test.ts`, `tests/integration/academic-delayed-checkin.test.ts`

**Interfaces**
- Produces: `SnapshotEvidence = {id:string;version:number;lastEligibilityEventId:number;activeYear:number;issuedAt:string;freshUntil:string;coversUntil:string;users:Array<{userId:number;role:Profile["role"];accessState:"ACTIVE";accessEventId:number}>;eligible:Array<{userId:number;applicationId:number;registrationId:number;date:string;mealKind:string}>;profiles:AcademicProfile[]}`. 실제 동기화 응답은 기존 users/faceProfiles/settings와 이 근거를 함께 포함한다.
- Produces: `issueKioskSnapshot(db:PrismaClient, actor:Actor, now:Date): Promise<SnapshotEvidence>` — repeatable-read 트랜잭션에서 자격을 읽고 발급 근거를 저장한다(control 공유 잠금으로 진행 중인 전환 뒤에 선다). `freshUntil=nextKstMidnight(now)`, `coversUntil`=내려준 자격의 마지막 dateKey(오늘+13일).
- Produces: `UploadedCheckIn = {clientId:number;deviceId:string;userId:number;date:string;mealKind?:string;checkedAt:string;type:string;snapshotId?:string;rawLegacy?:unknown}`.
- Produces: `UploadDecision = {status:"ACCEPTED"|"DUPLICATE"|"REVIEW"|"REJECTED";clientId:number;reviewId?:string;reason?:string;final:boolean}` — `final=true`(ACCEPTED·DUPLICATE·REJECTED)면 장치가 로컬 미전송에서 정리하고, REVIEW(`final=false`)만 남긴다. 같은 clientKey를 다시 보내면 최초 응답이 아니라 **현재 검토 상태**를 돌려준다.
- Produces: `processUploadedCheckIn(db:PrismaClient, actor:Actor, item:UploadedCheckIn): Promise<UploadDecision>`.
- Produces: `resolveCheckInReview(db, input:MutationInput & {reviewId:string;decision:"ACCEPT"|"REJECT";reason:string;mealKind?:string}): Promise<MutationReceipt>`.

- [ ] **Step 1 — 정상 과거 지연 기록·근거 없는 기록 테스트.**

```ts
const fx = await prepareAcademicFixture(db);
const snapshot = await issueKioskSnapshot(db, fx.main, new Date("2026-09-19T00:00:00Z"));
const item: UploadedCheckIn = { deviceId: "test-device", clientId: 101,
  userId: fx.studentId, date: "2026-09-19", mealKind: "DINNER", type: "STUDENT",
  checkedAt: "2026-09-19T09:00:00Z", snapshotId: snapshot.id };
// fixture의 학생 체크인은 9월 18일, 확정 식사일은 18일·19일로 둔다.
await db.userAccessEvent.create({ data: { userId: fx.studentId, state: "INACTIVE",
  reason: "GRADUATED", effectiveAt: new Date("2026-09-20T00:00:00Z") } });
await db.user.update({ where: { id: fx.studentId }, data: { accessState: "INACTIVE" } });
expect((await processUploadedCheckIn(db, fx.main, item)).status).toBe("ACCEPTED");
expect((await processUploadedCheckIn(db, fx.main, item)).status).toBe("DUPLICATE");
const { snapshotId, ...legacy } = item;
const undecidable = await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 102, date: "2026-09-20" });
expect(undecidable).toMatchObject({ status: "REVIEW", final: false });
expect(undecidable.reviewId).toBeDefined();
// 자정이 지난(오래된) 명부로 찍은 기록: 확정일이 근거에 있고 그 사이 자격·이용 상태 변경이 없으면 자동 반영
const staleItem = { ...item, clientId: 103, date: "2026-09-19", mealKind: "LUNCH", checkedAt: "2026-09-19T03:00:00Z" };
// 관리자가 REVIEW를 승인한 뒤 같은 기록을 다시 보내면 현재 상태(종결)를 받는다
await resolveCheckInReview(db, { actor: fx.writer, requestId: "review-102", expectedVersion: 0, kind: "REVIEW",
  payloadHash: "review-102", reviewId: undecidable.reviewId!, decision: "REJECT", reason: "확정일 없음" });
expect(await processUploadedCheckIn(db, fx.main, { ...legacy, clientId: 102, date: "2026-09-20" }))
  .toMatchObject({ status: "REJECTED", final: true });
```

`staleItem`처럼 `freshUntil` 이후·`coversUntil` 이내에 찍힌 기록은 별도 테스트로 둔다(fixture에 9월 20일 LUNCH 확정일을 추가하고 `issuedAt`을 전날로 발급). 그 사이 해당 학생의 EligibilityEvent나 AccessEvent가 없으면 `ACCEPTED`, 있으면 `REVIEW`다.

시간 주입은 테스트에서만 사용하고 실제 route는 서버 현재시각을 전달한다. 추가 사례: 교사 WORK/PERSONAL은 학생 신청 불필요, 확인 직전 이용 중단 거절, 같은 clientKey에 다른 payload 충돌, 승인 응답 유실 재송신 시 중복 생성 없음, 근거 발급 전·`coversUntil` 밖·날짜 불일치·근거 삭제(30일 경과) 기록은 REVIEW, `/api/facecheck`의 매칭 단계(`needConfirmation`)는 저장하지 않고 확인 요청 단계에서만 계정 상태를 최종 검증함.
- [ ] **Step 2 — 실패 확인.** 위 기존 mock 테스트와 `academic-delayed-checkin.test.ts`를 실행한다. 기존 “사용자 존재만 있으면 자격 검사 없이 삽입” 기대값은 변경 승인된 계약에 맞춘다.
- [ ] **Step 3 — 온라인 최종 판단.** QR의 userId 규약은 유지하되 role은 최신 DB를 읽는다. 공개 키오스크 checkin/facecheck의 기존 요청 인증 방식은 유지하고 체크인 대상 사용자의 최신 상태를 검증한다. 관리자 동기화/검토 API에는 최신 관리자 Actor 검사를 적용한다. 얼굴 후보 조회에서 비활성 계정을 제외한다(이용 중단 시 `FaceProfile`이 삭제되므로 이중 방어다). `/api/facecheck`는 9월 19일 도입된 2단계를 유지한다: 매칭 요청은 읽기 전용으로 `needConfirmation`을 돌려주고, `confirmation={userId,mealKind,date}` 확인 요청에서 기존 재매칭·대상/날짜/식사 검증(`CONFIRMATION_CHANGED`)에 이어 **저장 직전** 같은 트랜잭션에서 `accessState`와 자격을 읽는다. `/api/checkin`도 삽입 직전 같은 트랜잭션에서 읽는다. 명부 잠금은 잡지 않는다. 이용 중단과 수 ms 차이로 경합한 체크인 한 건은 허용하며(spec §4.3), 기존 `(userId,date,mealKind)` unique가 중복을 막는다.
- [ ] **Step 4 — snapshot 발급·보존.** 실제 내려준 오늘~13일 뒤 확정 자격, ACTIVE 사용자·상태 확인 시점, 날짜별 연도 Profile을 `KioskSnapshot.payload`에 저장한다. payload는 발급 후 수정하지 않는다. 최초 UserAccessEvent는 초기 이전/신규 계정 생성 시점으로 기록하고 그 이전 이용 상태를 만들어내지 않는다. `freshUntil=nextKstMidnight(now)`은 "최신" 표시의 경계일 뿐 체크인 차단 시각이 아니다. 학생 식사 자격과 교사 WORK/PERSONAL 기준을 분리한다. 발급 처리 끝에 `purgeExpiredRosterCopies`를 try/catch로 호출한다.
- [ ] **Step 5 — 늦은 업로드의 보수적 증명.** `issuedAt ≤ checkedAt`, date ≤ `coversUntil`, checkedAt의 KST 날짜=date, snapshot에 실제 사용자/학생 확정일 존재, 당시 access event를 확인한다. `checkedAt ≥ freshUntil`(오래된 명부로 찍음)이라는 이유만으로 REVIEW로 보내지 않는다. 같은 증명 절차를 적용해 통과하면 ACCEPTED다. snapshot 이후 발생 전 이용 상태 변경은 해당 시각의 event로 검사한다. EligibilityEvent 중 (`id > snapshot.lastEligibilityEventId` 또는 `createdAt ≥ issuedAt − 60초`)이고 occurredAt≤checkedAt인 항목을 살펴본다. snapshot 행이 보존 기간 경과로 없으면 REVIEW다. 해당 학생/공고의 자격 변경 또는 범위를 알 수 없는 변경이 있으면 REVIEW로 보존한다. 발생 후 졸업/전환/신청 변경은 이전 시점의 입증된 자격을 무효화하지 않는다. 현재 학년도/졸업 상태만으로 정상 과거를 거절하지 않는다. 중복은 같은 `(userId,date,mealKind)`의 기존 행과 입력이 같은 사건인지 확인한 경우에만 자동 확정한다.

```ts
const clientKey = `${item.deviceId}:${item.clientId}`;
const existing = await tx.localCheckInReview.findUnique({ where: { clientKey } });
if (existing && existing.payloadHash !== payloadHash) throw new DomainError("REQUEST_REUSED");
if (!item.snapshotId || !item.mealKind) {
  // payload 전체를 REVIEW로 보관하고 syncedClientIds에 넣지 않는다.
  return { status: "REVIEW", clientId: item.clientId, reviewId, reason: "당시 자격 확인 필요" };
}
```

`payloadHash`는 정규화한 전체 payload의 SHA-256이며 `reviewId`는 동일 transaction의 `LocalCheckInReview.upsert` 결과다. 모든 처리(ACCEPTED/DUPLICATE 포함)에 clientKey·payloadHash·결과를 영속 저장하여 재송신을 판별한다. 재송신 응답은 저장된 행의 **현재 state**로 만든다: PENDING→`REVIEW`(`final:false`), 관리자가 해결한 뒤에는 ACCEPTED/REJECTED(`final:true`). 같은 자연키에 다른 시각/type 입력은 자동으로 덮어쓰지 않고 검토로 보낸다.
- [ ] **Step 6 — 검토 API.** READ_ADMIN은 목록만, WRITE_ADMIN은 사유와 필요한 mealKind를 명시해 승인/거절한다. 승인 시 checkin 고유키 검사·삽입과 결정 기록을 하나의 transaction에 저장한다. 거절도 payload를 보존한다. upload 응답은 기존 counts/`syncedClientIds/rejected`를 유지하고 review ID를 추가한다. `final=true`인 항목(accepted·입증된 duplicate·확정 거절)은 synced/정리 대상이고 REVIEW만 로컬에 남는다. 확정 거절은 사유와 함께 응답에 실어 장치가 정리 전에 화면·내보내기에 표시할 수 있게 한다. `resolveCheckInReview`는 전역 버전과 무관하므로 `expectedVersion` 대신 검토 행의 state가 PENDING인지로 충돌을 판단한다(이미 해결됐으면 `VERSION_CONFLICT`).
- [ ] **Step 7 — 회귀·커밋.** QR/얼굴 확인 흐름과 기존 mealKind 분리 테스트, 지연/중복/응답 유실 테스트 후 `feat: verify kiosk snapshots and retain uncertain uploads for review`.

## Task 13: 로컬 DB 무삭제 이전·원자 동기화·유효기간

**Files**
- Modify: `src/lib/local-db.ts`, `src/lib/kiosk-sync.ts`, `src/lib/qr-checkin-local.ts`, `src/lib/facecheck-local.ts`
- Modify: `src/app/check/page.tsx`, `src/app/facecheck/page.tsx`
- Create: `src/lib/academic-year/local-snapshot.ts`
- Test: `src/lib/__tests__/academic-local-snapshot.test.ts`, `src/lib/__tests__/qr-checkin-local.test.ts`, `src/lib/__tests__/facecheck-local.test.ts`, `src/lib/__tests__/kiosk-sync.test.ts`
- Create: `tests/browser/academic-local-migration.html` (임시 브라우저 테스트 origin 전용, 앱 public 폴더에 배포하지 않는다.)

**Interfaces**
- Produces: `checkLocalSnapshot(snapshot:SnapshotEvidence|null, input:{now:Date;userId:number;dateKey:string;serverActiveYear:number|null}): "FRESH"|"STALE"` — 명부 없음·사용자 미포함·`dateKey > coversUntil`·`serverActiveYear`가 알려져 있고 `snapshot.activeYear`와 다름이면 throw(저장 금지). `now ≥ freshUntil`이면 `"STALE"`을 돌려주되 저장은 허용한다. `serverActiveYear`는 `fetchKioskSettings`가 마지막으로 확인해 IDB settings에 저장한 값이며 오프라인이면 null이다.
- Produces: `applyKioskSnapshot(db:IDBDatabase, download:KioskDownload): Promise<void>` — users/eligible/faces/settings 원자 교체, checkins 불변. `KioskDownload`는 기존 download payload와 `SnapshotEvidence`를 합친 export 타입으로 `kiosk-sync.ts`에 둔다.
- Changes: `LocalCheckIn`에 `snapshotId?`, `deviceId?`, `reviewId?`, `reviewReason?`, `rawLegacy?`를 추가한다. 구버전의 `mealKind` 없는 값도 읽을 수 있도록 legacy read 타입을 분리한다. 새 insert의 mealKind/snapshotId/deviceId는 필수다.
- Changes: `LocalQrRepo`·`LocalFaceRepo`에 `getSnapshot():Promise<SnapshotEvidence|null>`을 추가하고 두 판정 함수에 `now:()=>Date`를 주입한다(기본 `() => new Date()`).
- Changes: `performKioskSync`·`KioskSyncOutcome`은 accepted/duplicate/review/rejected 수와 `freshUntil`을 반환한다. `final=true` 응답을 받은 로컬 기록은 synced로 정리하고 REVIEW만 남긴다. 기존 호출자 둘은 이 함수만 사용한다.
- Changes: `/api/system/settings` GET 응답에 `activeAcademicYear`를 추가하고 `fetchKioskSettings`가 IDB settings에 저장한다(공개 응답이므로 연도 숫자만).
- Produces: `forceClearLocalData(confirm:{exported:boolean;typed:string}): Promise<void>` — 미전송·확인 대기가 남아 있어도 내보내기 완료와 확인 문구 입력이 있으면 초기화한다.
- Changes: 기존 `openDB`를 export하고 `openDB(databaseName:string = DB_NAME):Promise<IDBDatabase>`로 확장한다. 기본 이름은 기존 `posanmeal-local`이며 명시 이름 주입은 테스트용이다. v6 upgrade handler를 이 공용 opener 안에서 한 번만 정의한다.

- [ ] **Step 1 — 자정 직전/직후·확인 대기 테스트.**

```ts
const snapshot: SnapshotEvidence = { id: "snapshot", version: 1, lastEligibilityEventId: 1,
  activeYear: 2026, issuedAt: "2027-02-28T00:00:00Z", freshUntil: "2027-02-28T15:00:00Z", coversUntil: "2027-03-13",
  users: [{ userId: 7, role: "STUDENT", accessState: "ACTIVE", accessEventId: 1 }],
  eligible: [{ userId: 7, applicationId: 1, registrationId: 1, date: "2027-02-28", mealKind: "DINNER" }], profiles: [] };
const at = (iso: string, extra = {}) => ({ now: new Date(iso), userId: 7, dateKey: "2027-02-28", serverActiveYear: 2026, ...extra });
expect(checkLocalSnapshot(snapshot, at("2027-02-28T14:59:59Z"))).toBe("FRESH");
expect(checkLocalSnapshot(snapshot, at("2027-02-28T15:00:00Z", { dateKey: "2027-03-01" }))).toBe("STALE");
expect(checkLocalSnapshot(snapshot, at("2027-02-28T15:00:00Z", { dateKey: "2027-03-01", serverActiveYear: null }))).toBe("STALE");
expect(() => checkLocalSnapshot(snapshot, at("2027-03-02T00:00:00Z", { serverActiveYear: 2027 }))).toThrow();
expect(() => checkLocalSnapshot(snapshot, at("2027-03-20T00:00:00Z", { dateKey: "2027-03-20" }))).toThrow();
expect(() => checkLocalSnapshot(null, at("2027-02-28T10:00:00Z"))).toThrow();
```

기존 injectable repo 테스트에 now를 제어해, 최초 얼굴 인식은 FRESH이고 확인 버튼 처리 때 STALE로 바뀌어도 저장되며 결과에 `stale:true`가 실리는 경우와, 확인 대기 중 운영 학년도 불일치가 확인되면 저장 함수 호출 수 0·기존 미전송 수 불변인 경우를 추가한다.
- [ ] **Step 2 — 실패 확인.** 해당 단위 테스트 실행. real IDB 검증은 아래 disposable origin에서만 수행한다.
- [ ] **Step 3 — IDB v6 cursor 이전.** 기존 oldVersion<2의 checkins store 삭제를 제거한다. cursor.update로 synced boolean을 숫자 0/1로 변환하고 기존 키·시간·payload를 그대로 보존한다. oldVersion<4의 누락 mealKind를 DINNER로 추정하는 분기도 제거한다. 근거 없는 원본은 rawLegacy와 reviewReason을 남겨 검토 대상이 된다. 이미 v4/5에서 부여된 mealKind는 보존하되 snapshot 없는 레거시 기록은 검토로 보낸다. `rawLegacy`·`reviewReason`은 **미전송(synced=0) 기록에만** 붙인다. 이미 전송된 기록은 synced 정규화만 한다.

```ts
const cursorRequest = upgradeTx.objectStore("checkins").openCursor();
cursorRequest.onsuccess = () => {
  const cursor = cursorRequest.result;
  if (!cursor) return;
  const original = cursor.value;
  const synced = original.synced === true || original.synced === 1 ? 1 : 0;
  cursor.update(synced === 1 ? { ...original, synced } : { ...original, synced,
    rawLegacy: original.rawLegacy ?? original,
    reviewReason: original.snapshotId ? original.reviewReason : "이전 버전 기록 확인 필요",
  });
  cursor.continue();
};
```

v1부터 올 때 users/eligible/faces/settings 신규 store 생성도 기존 키를 보존하도록 조건부로 수행한다. 이 코드에서 checkins 삭제·clear는 허용하지 않는다. 장치 UUID는 설정에 한 번만 생성하고 재시도 때 유지한다.
- [ ] **Step 4 — snapshot 원자 적용.** 하나의 readwrite transaction에 users/eligible/faces/settings를 포함하고 그 안에서 교체한다. 중간 에러면 abort하고 이전 snapshot을 계속 보존한다. checkins store는 이 transaction에 포함하지 않는다. 업로드 성공 IDs만 별도 transaction에서 synced로 바꾸고 review/reject 사유는 원본과 함께 갱신한다. 다운로드 실패 시 업로드의 성공 여부를 사용자에게 별도 표시한다.
- [ ] **Step 5 — 브라우저 무삭제 검증.** 운영 장치는 9월 5일 이후 v5이므로 실브라우저 검증은 **v4·v5 → v6**만 한다. v1~v3은 upgrade handler에 checkins 삭제·clear 호출이 없음을 코드 검색과 fake-indexeddb 없는 순수 분기 단위 테스트로만 확인한다. 브라우저 테스트 HTML에서 고유 DB 이름 `posanmeal-academic-test-v4`·`v5`를 만들고 각 스키마에 미전송 2건·전송 1건을 넣는다. 제품 opener를 DB명 주입 가능하게 분리하여 실제 upgrade handler를 v6으로 실행한다. 이전 PK/checkedAt/userId와 raw 필드, 미전송 수를 비교한다. snapshot 저장 도중 transaction.abort()를 발생시켜 이전 users/settings와 모든 checkins가 유지되는지 확인한다. 실제 서비스 origin의 `posanmeal-local` DB에는 테스트를 실행하지 않는다.

검증 HTML은 개발 서버에 넣지 않는다. 설치된 Vitest 의존성 esbuild로 실제 `local-db.ts`를 임시 폴더의 ESM으로 bundle하고 HTML의 module script에서 import한다. `python3 -m http.server 53461 --bind 127.0.0.1 --directory "$ACADEMIC_BROWSER_DIR"`로 별도 origin을 열어 Chrome에서 검증한다. 브라우저 검증 명령은 실행 단계에 사용 가능한 automation 도구로 선택하며 실패/성공 결과를 그대로 기록한다. 임시 폴더는 `mktemp -d`로 생성하고 제품 DB명은 사용하지 않는다.
- [ ] **Step 6 — 초기화 경로 보호와 강제 초기화.** `clearAllData`, QR 화면 초기화, `?reset=1`은 미전송·확인 대기(서버가 `final=false`로 답한 것) 수가 0이 아니면 바로 지우지 않고 건수와 함께 두 선택지를 보여준다: [동기화 후 다시 시도], [Excel로 내보낸 뒤 강제 초기화]. 강제 초기화는 기존 `local-checkins-export.ts`로 파일을 내려받은 뒤 확인 문구("초기화")를 입력해야 실행된다. 종결된 기록(`final=true`)은 동기화 때 정리되므로 가드 대상이 아니다. 얼굴 확인창(로컬 `confirmation` 단계)에서도 최종 저장 전에 `checkLocalSnapshot`을 다시 호출한다.
- [ ] **Step 6A — 오래된 명부 표시.** `STALE`이면 `/check`·`/facecheck` 하단 동기화 상세 행(`.kiosk-*`, `KioskViewport` 구조 유지)에 `재동기화 필요`를 고정 표시하고 체크인은 계속 받는다. 운영 학년도 불일치로 막힌 경우에는 결과 한 줄에 주황(오류 분류)으로 "학년도 전환 후 동기화가 필요합니다"를 표시하고 기존 오류음을 쓴다. 새 색·사운드는 추가하지 않는다. 100dvh 단일 화면과 44px 터치 영역을 유지하고 `responsive-ui-reviewer`로 확인한다.
- [ ] **Step 7 — 테스트·커밋.** 단위/실브라우저 v4·v5 결과를 구분해 기록하고 `feat: preserve offline checkins across yearly roster sync`.

## Task 14: 사용자 관리 화면·전환/확인 흐름 통합

**Files**
- Create: `src/components/admin-roster/RosterManager.tsx`, `RosterToolbar.tsx`, `RosterTable.tsx`, `RosterImportDialog.tsx`, `RolloverDialog.tsx`, `ArchivedRosterDialog.tsx`, `CheckInReviewPanel.tsx` (같은 디렉터리)
- Modify: `src/app/admin/page.tsx`, `src/app/teacher/page.tsx`, `src/components/meal/ApplicationForm.tsx`, `src/components/meal/ApplicationStats.tsx`, `src/components/meal/AdminApplyDialog.tsx`, `src/components/meal/StudentApplicationView.tsx`
- Modify: `src/app/api/admin/import/route.ts`, `tests/admin-sheet-import-guide.test.ts`와 그 테스트가 검증하는 Sheet 가져오기 안내 문서
- Test: `tests/integration/academic-api-permissions.test.ts`
- Create: `docs/testing/academic-year-browser-checks.md`

**Interfaces**
- Produces: `RosterManager({canWrite:boolean,isMain:boolean}:{canWrite:boolean;isMain:boolean})` — 기존 관리자 사용자 탭 안에서 사용한다.
- Produces: `RosterImportDialog({year,scope,onCommitted,onClose}:{year:number;scope:ImportScope;onCommitted:()=>void;onClose:()=>void})`.
- Consumes: Task 4~13 API. 조회는 `{data,version}`, 변경은 `MutationReceipt`, 오류는 `{error:{code,message,issues?}}`로 통일한다. 서버 Actor는 세션에서만 생성한다.

- [x] **Step 1 — 서버 권한과 우회 차단 테스트.** READ_ADMIN의 POST preview/commit·셀 편집은 403, WRITE_ADMIN의 activate/delete/permissions는 403, MAIN은 허용되는 실제 handler 테스트를 추가한다. 옛 `/api/admin/import`는 인증 후 410을 반환하고 DB 쓰기를 하지 않아야 한다.

```ts
const fx = await prepareAcademicFixture(db);
await expect(assertActor(db, fx.writer, "MAIN")).rejects.toMatchObject({ code: "FORBIDDEN" });
await expect(assertActor(db, fx.writer, "WRITE_ADMIN")).resolves.toBeUndefined();
```

route 수준 테스트에는 NextRequest body의 가짜 actor/adminLevel을 넣어도 권한이 바뀌지 않는 경우와 모든 관리자 변경 API의 인증 없는 요청을 포함한다.
- [x] **Step 2 — 실패 확인.** `npm run test:academic -- academic-api-permissions.test.ts`.
- [x] **Step 3 — 연도별 명부 화면.** 연도 선택 옆에 `운영 중 / 준비 중 / 지난 학년도` 표시, 학생/교사 보기, 양식 다운로드의 `기존 데이터 포함` 체크박스, 과거 출력의 `현재 학급도 함께 표시` 옵션을 둔다. 선택 연도와 현재 운영 연도는 분리해 보여준다. 기존 `EditableCell`을 재사용하되 이메일은 별도 변경 다이얼로그, 교사 권한은 MAIN 전용 별도 버튼으로 분리한다.
- [x] **Step 4 — 업로드 상태 흐름.** `파일 선택 → 검증 중 → 미리보기 → 반영 중 → 완료`로 구성한다. 미리보기는 신규/동일/변경/확인 필요/충돌, 학생·교사 건수, 값 비우기, 전체 대조 누락을 보여준다. 충돌 행은 파일 값과 서버 현재 값을 나란히 보여주고 행마다 [파일 값 사용]/[서버 값 유지]를 고르게 하며, 선택은 즉시 서버(PATCH)에 저장한다. 신규 행 확인, FULL 누락 확인, 모든 충돌 행 선택이 없으면 확정 버튼을 활성화하지 않는다. 닫기·취소는 서버의 미리보기를 취소(DELETE)해 사본을 바로 비운다.

```ts
type ImportUiState =
  | { stage: "SELECT" }
  | { stage: "VALIDATING" }
  | { stage: "PREVIEW"; preview: ImportPreview; confirmedTokens: string[]; omissionsConfirmed: boolean }
  | { stage: "COMMITTING"; requestId: string }
  | { stage: "DONE"; receipt: MutationReceipt };
```

파일·대상 연도·일부/전체 선택이 바뀌면 preview/확인/requestId를 초기화한다. 응답 유실 후 같은 반영을 재시도하면 같은 requestId를 재사용한다. 409는 자동 덮어쓰지 않고 최신 파일/미리보기 재생성을 안내한다. 행 오류는 시트·행·열과 한국어 사유를 표시한다.
- [x] **Step 5 — 전환·삭제·정정.** 전환에서 누락자 결정을 모두 받고 키오스크 업로드·일시 중지 확인, 신규/업무 변경/이용 중단 수·관리자 권한 유지 안내, 이용 중단자의 얼굴 등록 삭제 안내를 보여준다. 세 가지 전환 경고(이용 중단자의 미래 확정 식사일, 현 학년도 잔여 확정 식사일, 전년도와 학년이 같은 학생 수)는 0이 아닐 때 강조하고 확인 체크를 요구한다. 개별 이용 중단 다이얼로그에도 얼굴 등록 삭제를 명시한다. 전환 성공 후에만 새 연도 접수 기능을 활성화한다. 삭제는 대상 수와 사전 다운로드 버튼 및 설계의 보존 안내 문구를 표시한다. 과거 Profile 정정은 일반 명부 복구와 분리한다.
- [x] **Step 6 — 연관 화면.** 교사 자기정보의 담임·업무 직접 편집을 읽기 전용으로 바꾼다. ApplicationForm에는 학년도를 넣고 준비 연도 공고는 접수 전 상태를 명시한다. 통계에 기준 학년도와 선택 현재 학급을 표시한다. 체크인 검토 화면은 원본 발생시각·사유·승인/거절 결과를 보여주고 로컬 기록이 보존됨을 안내한다. 옛 Sheet URL 입력 UI를 제거하고 API는 410으로 닫되 code.gs/Sheet 자료는 변경하지 않는다. `tests/admin-sheet-import-guide.test.ts`가 검증하는 안내 문서는 "학년도별 Excel로 대체됨"으로 고치고 테스트 기대값을 그에 맞춘다(테스트를 지우지 않는다). 이 테스트는 기본 vitest include 밖이므로 실행 명령을 명시해 돌린다.
- [x] **Step 7 — 브라우저 확인·UI 검수.** `docs/testing/academic-year-browser-checks.md`에 360/768/1280px 화면에서 연도 선택, 업로드 오류→수정→미리보기, 재전송, 전환 누락 차단, 삭제 후 보고서, 교사 권한, 충돌 행 선택, 전환 경고 확인, 키오스크 `재동기화 필요` 표시·학년도 불일치 차단·내보내기 후 강제 초기화를 실제 조작 순서와 기대 결과로 기록한다. 표는 가로 스크롤·sticky 헤더, 버튼/이름/학번은 프로젝트 nowrap 규칙을 지킨다. `responsive-ui-reviewer` 검토 후 수정한다.
- [x] **Step 8 — 테스트·커밋.** 관련 handler 테스트·타입·lint·브라우저 확인 후 `feat: add yearly roster and Excel management workflows`.

## Task 15: 통합 회귀·복원 리허설·운영 반영 준비

> 2026-09-20 재개 상태: Task 14a·14b·14c는 구현·독립 코드/UI 검토·실제 Chromium 확인을 완료했다. Task 15 앱 회귀와 검토 결과는 [검증 보고서](../../operations/academic-year-validation-report.md)에 기록한다. 실제 운영 자료 백업/복원·배포는 미실행이며 별도 대상 승인이 필요하다. Step 3은 서비스 메타데이터·실제 SQL·복원 후보까지만 확인했고 DB 연결과 복원 대상 확정은 남았다. Step 6은 실행안 작성 완료, 실제 담당자·일시·접속/차단 방법 승인 전이라 미완료로 둔다. Step 2의 기존 lint 오류와 Step 7의 역할 런타임 대체 검토는 보고서에 구분했다. 최신 AGENTS의 Claude 원본 보존 지침에 따라 맵·인계는 `.codex/`만 갱신한다.

**Files**
- Create: `docs/operations/academic-year-migration-runbook.md`, `docs/operations/academic-year-validation-report.md`
- Modify: `.codex/PROJECT_MAP.md`, `.claude/PROJECT_MAP.md`(두 맵의 §1~§12를 같은 내용으로 유지), `CLAUDE.md`의 낡은 표(라우팅·API·DB 스키마)에 학년도 구조 한 줄 안내, `.codex/memory/MEMORY.md`, `.codex/memory/2026-09-19-academic-year-roster-requirements.md`
- Modify: `railway.json`은 기존 시작 명령의 자동 migrate가 검토된 반영 순서를 지키도록 변경이 필요한 경우에만 다룬다. 환경 확인 전 미리 바꾸지 않는다.

**Interfaces**
- Consumes: Task 1~14 서비스와 검증 명령. 새 제품 API는 추가하지 않는다.
- Produces: 현재 commit·테스트 결과·복원 대상 검증·백업/manifest 식별자·실행 순서·중단 조건을 포함한 review 가능한 운영 실행안. 비밀값·학생 원본은 문서에 저장하지 않는다.

- [x] **Step 1 — 빠진 경로 정적 검사.** `rg`로 `user.update/delete`, `reg.user.grade`, `auth()/canWriteAdmin`, 기존 Sheet import와 `resyncRegistrations` 호출 위치를 확인한다. 직접 User 삭제·연도 없는 명부 쓰기·옛 JWT만 믿는 서버 권한·현재 grade로 과거 계산·초안 신청 경로가 남으면 소유 Task로 돌아가 회귀 테스트를 추가한다. `src/app/api/admin/**`의 기존 설정/백업 API도 최신 계정 guard를 적용한다.
- [x] **Step 2 — 앱 검증.** 아래를 실행해 종료 코드와 테스트 수를 기록한다. 실패를 기존 오류라고 추정하지 않으며 실패 원인·기존 여부를 확인해 구분한다.

```bash
npx prisma generate
npx tsc --noEmit
npm run lint
npm test
npm run test:academic
npm run build
```

integration은 Task 1의 검증된 전용 DB에서만 실행한다. build가 Prisma 환경을 요구하면 시험용 구성을 명시하고 운영 환경의 DB 작업이 발생하지 않게 확인한다. IDB/QR/얼굴 브라우저와 실제 태블릿 검증 결과는 단위 테스트 수에 합산하지 않는다.
Release A에서는 Step 1~2를 Task 1~4A 범위로, Step 3~6을 Release A 범위로 먼저 수행하고, Release B에서 전체 범위로 다시 수행한다. runbook은 두 Release를 별도 절로 적는다.
- [ ] **Step 3 — 실제 복원 검증 전 대상 확정.** 6월 기록(단일 `dinner`/`main`)과 9월 기록(`dinner-facecheck`/`feat/facecheck`)이 서로 다르므로 어느 서비스가 어느 브랜치·DB·Volume에 연결돼 있는지부터 확정한다. `railway-deploy-advisor`로 현재 서비스/DB/Volume 연결·시작 명령을 읽기 전용 확인한다. `prisma-migration-guardian`에게 **실제 SQL**을 검토받는다. 운영에서 분리된 복원 DB와 시험 앱, 사진 파일 복사본·별도 Volume, 접근 통제와 시험용 OAuth callback을 실행안에 명시한다. 새 Railway 서비스 생성이 필요한 경우 이 시점에 구체 대상·비용 발생 범위·연결도를 사용자에게 제시한다. 서비스 생성·운영 적용은 이 계획 승인만으로 자동 실행하지 않는다.
- [ ] **Step 4 — 백업·복원 리허설.** 승인된 별도 대상에서 DB 백업의 실제 복원을 완료하고 원본 manifest를 만든다. 사진/Volume 자료는 별도 백업·복원으로 확인한다. 비밀값은 제한된 libpq service 파일로 전달하고 stdout/계획 문서에 쓰지 않는다. 아래는 운영자가 검토한 서비스 이름을 사용한 실행안이며 지금 실행하는 명령이 아니다.

```bash
pg_dump --format=custom --dbname=service=posanmeal-source --file="$ACADEMIC_BACKUP_FILE"
pg_restore --exit-on-error --no-owner --dbname=service=posanmeal-restore "$ACADEMIC_BACKUP_FILE"
```

`posanmeal-source`는 읽기 전용 백업 계정, `posanmeal-restore`는 새로 확인한 빈 시험 DB여야 한다. CLI wrapper는 접속 후 database/user/환경 marker를 확인해 허용 목록과 다르면 중단한다. 원본 백업과 manifest 파일은 git 밖 접근 제한 위치에 둔다. 백업 파일 생성만으로 복원 성공이라고 쓰지 않는다.
- [ ] **Step 5 — 복원본 이전 검증.** 복원본에서 추가형 migrate → 초기 2026 copy → 원본 전체 필드/PK/FK 비교 → 예외 목록 → 예외 해결 확인 → READY 순서로 실행한다. 성별 등 비식별 기존 결측은 보완 표시, 식별/학번/귀속 불확실성은 READY 차단이다. 재실행·중간 중단·삭제 명부 재생성 금지·전환 후 과거 보고서·신청·온라인/오프라인 체크인을 검증한다. 실제 복원 데이터와 합성 테스트의 통과 결과를 별도로 적는다.
- [ ] **Step 6 — 운영 실행안 확정.** **Release A**: 새 백업 → source manifest → `main` 반영(시작 명령의 `migrate deploy`가 추가형 SQL 적용) → 롤링 교체가 끝나 이전 컨테이너가 없음을 확인 → 운영 DB 식별 marker 생성(누가·언제·어떤 계정으로 하는지 명시) → `backfill --mode inspect` → `apply` → `verify` → `VERIFIED`. 이 동안 기존 쓰기는 막지 않으며, 롤링 교체 구간에 이전 컨테이너가 쓴 `User` 변경은 백필이 그대로 복사하므로 유실되지 않는다. 배포 직후 전원 재로그인이 1회 발생함을 공지한다. **Release B**: 승인 대상 commit/DB/서비스/Volume, 유지보수 시간, 키오스크 미전송 업로드·중지 확인, 새 백업, source manifest, migration/배포 시작 명령, copy/verify, READY 공개, 키오스크 재동기화·운영 재개 순서를 고정한다. 쓰기 중단을 DB/라우트에서 강제하고 구 앱 인스턴스가 User를 계속 쓰지 않도록 종료 여부를 확인한다. 롤백은 새 기능 공개 전/후를 구분한다. 공개 후에는 옛 백업을 자동 복원하지 않으며 추가 스키마를 이해하는 호환 앱/수정 배포로 복구할지 결정한다. 모호한 원본·비교 실패·키오스크 미전송 존재 시 해당 실행 단계에서 멈춘다.
- [x] **Step 7 — 최종 검토·인계·커밋.** 전체 변경의 독립 코드 리뷰, `project-map-updater`, `responsive-ui-reviewer`, `project-memory-keeper`를 수행한다. 역할별 검토 범위와 실제 미실행 항목을 기록한다. `docs: record academic year migration checks and rollout procedure`로 문서 커밋한다. 실제 운영 적용 전에는 이 구체 실행안을 사용자에게 검토받는다.

## 요구사항과 검증의 연결

| 승인 spec | 구현 Task | 완료 판단 |
|---|---|---|
| §1~4 ID·학년도·최종 학급·명부/표시정보 분리 | 2·3·5·9 | 기존 ID/원본 동일, 해당 연도만 정정, 삭제 후 표시 유지 |
| §5 Excel 형식·기존 자료 다운로드 | 6·14 | 두 visible 시트, 이메일 A열, 데이터 포함/빈 양식 왕복 |
| §6 검증·부분/전체·충돌·원자 저장 | 6·7·14 | 수식/중복 거절, 바뀐 행만 충돌·행별 선택, 전부 rollback, 재시도 동일 결과 |
| §7 준비·누락자·관리자 전환·전환 후 접수 | 5·8·10·14 | 초안 User 불변, 학생/교사 전체 대조, 조기 전환 경고·확인, 중간 실패 rollback |
| §8 과거 조회·신청 계산·명부 삭제 | 9·10·11 | 진급 후 과거 학급/grade 기준, 사용자/식사 물리 삭제 없음 |
| §9 최신 권한·이메일·이용 종료 | 4·8·11·12·14 | 옛 JWT 차단, MAIN 권한 경계, 교사 자가 담임 변경 차단, 이용 중단 시 얼굴 등록 삭제 |
| §4.3 잠금 범위·대량 쓰기 | 2·5·7·8·10·12 | 다른 행 병렬 성공, 체크인·신청 비차단, 1,000명 60초 이내 |
| §4.4 명부 사본 보존 기간 | 2·6·7·9·12 | 확정 즉시/24시간/30일 정리, 이전 명부 삭제 시 동반 삭제 |
| §10 온라인/오프라인·지연 동기화 | 12·13·14 | 미전송 보존, 오래된 명부 체크인 허용·학년도 불일치 차단, 검토 종결·로컬 정리, 내보내기 후 강제 초기화 |
| §11 원본 보존·별도 복원·운영 보호 | 1·2·3·15 | 컬럼별 비교, 삭제 명부 재생성 금지, 실제 복원 검증 별도 |
| §11.3 Release A/B 분리 | 3·4A·15 | 호환 쓰기로 User·학년도 기록 동시 변경, PREPARING이 기존 쓰기 비차단 |
| §12~14 통합 범위·추가 합의·단계 진행 | 14·15 | UI/회귀/역할 검수, 실행 전 계획 및 운영 실행안 검토 |

계획 문서의 검토는 앱 테스트·실제 SQL 안전성 승인·운영 데이터 보존 검증을 대체하지 않는다.

## 계획 자체 검토 기록

2026-09-19 주 작업자가 spec 전체와 직접 대조했다. 위 표로 요구사항 담당 Task를 연결하고, Review Focus 다섯 항목을 원본 비교·DB 동시성·Excel 충돌·과거 resync·IDB/지연 업로드 테스트에 배정했다. 자체 검토에서 복사한 초안의 누락자 표시, 재시도 receipt 보존, 교사 성별 보존, 자격 변경 시각 근거, 기존 복합 PK와 실제 페이지 경로를 보완했다.

**2026-09-19 개정.** 외부 검토에서 나온 문제를 사용자와 질의응답으로 확정해 반영했다: (1) 체크인·신청까지 직렬화하던 전역 잠금을 작업 범위별로 축소하고 `withUserMutation`·공고 행 잠금 도입, (2) 행별 loop를 일괄 쓰기와 명시적 트랜잭션 제한으로 교체, (3) 자정 하드 만료를 최신/오래됨 상태로 완화하고 학년도 불일치만 차단, (4) 검토 기록의 현재 상태 반환·로컬 정리·내보내기 후 강제 초기화, (5) 명부 사본 보존 기간과 정리 함수, (6) 이용 중단 시 `FaceProfile` 삭제, (7) Excel 행 단위 충돌과 행별 선택, (8) 전환 경고 세 가지, (9) Task 4A와 Release A/B 분리, (10) 9월 19일 반영된 `/facecheck` 2단계 확인 흐름·`KioskViewport` 전제 반영, IDB 실브라우저 검증 범위를 v4·v5로 축소. `eligibilityVersion` 카운터는 sequence 기반 `EligibilityEvent.id`로 바꾸고 커밋 순서 역전은 60초 과포함으로 보수 처리했다.

현재 수행한 검증은 문서 경로, 수정 대상 파일 존재, 15개 Task/체크리스트, 미정 문구 검사, TypeScript 코드 블록 문법 및 공백 검사다. 앱 코드 타입 검사·테스트·build, SQL 실행·복원·배포는 아직 수행하지 않았다. 다음 단계는 사용자 계획 검토와 실행 방식 선택이며, 이 문서는 구현 완료 보고가 아니다.
