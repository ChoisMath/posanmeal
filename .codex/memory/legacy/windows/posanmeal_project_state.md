> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/E--Projects-posanmeal/memory/posanmeal_project_state.md`

---
name: Posanmeal 프로젝트 현황 및 변경 이력
description: Posanmeal 주요 기능 구현 현황 — 담임 학생관리/신청현황 개편+사진 볼륨저장(2026-06-16), 조/중/석 3분할(2026-06-11), 교사 admin/subadmin 권한 포함
type: project
originSessionId: 7d99b16e-5dfe-48b3-ab45-4ff11e620822
---
## 현황 (2026-06-16) — 담임 학생관리·신청현황 개편 + 사진 볼륨 저장 **prod 배포 완료**

`main`/`feat/posanmeal-mvp` 동기(**64ed45b**), `dinner` 서비스 빌드 SUCCESS·Online, `meal.posan.kr` 라이브 확인(`/`=200, `/api/teacher/applications`=307 인증리다이렉트=신규 라우트 배포됨, `/api/uploads/없는파일`=307 폴백=신규 스트리밍 배포됨). 볼륨 `posanmeal-volumn`→`/app/uploads`, `UPLOAD_DIR=/app/uploads` 일치 확인.

- **학생관리 음영 규칙**(`StudentTable.tsx`): 칸 단위(`column.key = 날짜:식사`) 판정 — 체크인=식사색+"O" / 신청=`bg-white` / 미신청=`bg-stone-300/80`(뚜렷한 회색, 대비 강화 64ed45b). 행 전체가 아니라 학생별 신청 칸만 흰색.

- **⚠️ 배포 구조 정정 (CLAUDE.md/branch_workflow 메모리와 실제가 다름)**: Railway에 환경은 `production` 1개, 앱 서비스는 `dinner`(main watch, `meal.posan.kr`+`dinner-posan.up.railway.app`) **1개뿐**. **test 서비스도 `posanmeal.up.railway.app`도 없음.** 따라서 "test 먼저 push" 워크플로는 적용 불가 — 배포 경로는 `main` 머지 → prod 직행이 유일. detached 볼륨 `posanmeal-volume`(끝 e) 1개 방치됨.
- **사진 재업로드 안내 필요**: 구 photoUrl 사진은 이번 변경으로 복구 안 됨(원래도 임시저장이라 유실) → 사용자 1회 재업로드 필요. 영속성 실검증(업로드→redeploy→유지)은 사용자가 직접 확인 권장.

- **담임 학생관리 탭 재구성**: `StudentTable.tsx`를 관리자 급식확인(`AdminMealTable`/`MealGrid`)과 동일한 식사별(조/중/석) 컬럼으로 재작성(**읽기전용**). 신청 음영 규칙: 체크인=식사색+"O" / 신청함=흰색(`bg-background`) / 미신청=회색(`bg-muted/60`). `GET /api/teacher/students`에 `mealColumns`(우리 반 승인 조/중 신청일) + 학생별 `appliedDates`({date,mealKind}, `MealRegistrationMealDate` APPROVED) 추가.
- **신청현황 탭 신규**(담임 6탭): `TeacherApplications.tsx`(목록↔상세 마스터-디테일, 서명 썸네일+확대 Dialog). 신규 API `GET /api/teacher/applications`(전체 공고) + `GET /api/teacher/applications/[id]/registrations`(우리 반 APPROVED만, role=TEACHER+homeroom 검증). 서명이 `data:image`면 `<img>`, 아니면(`(관리자 등록)` 등) 텍스트+관리자 배지.
- **사진 저장 경로 수정**: `users/me/photo`가 `public/uploads` 하드코딩(컨테이너 임시→재배포 유실) → `process.env.UPLOAD_DIR`(Railway Volume) 우선 저장 + photoUrl `/api/uploads/{id}.webp?t=...`. `uploads/[filename]`은 redirect-only → `runtime=nodejs`+readFile 스트리밍(없으면 `/uploads/` 정적 폴백). **서명은 변경 없음**(DB `MealRegistration.signature` base64, 볼륨 아님).
- **가드레일 갱신**: `src/lib/__tests__/next-build-warnings.test.ts`가 옛 정적서빙을 강제하던 것 → 볼륨 스트리밍 기준으로 재작성. `.env.example`에 `UPLOAD_DIR` 추가. `npm test` 129개 통과, `npm run build` 성공.
- **배포 전 필수 확인(railway-deploy-advisor)**: Railway test/prod **양 서비스**에 (a) `UPLOAD_DIR=/app/uploads` 환경변수 + (b) **동일 경로 Volume 마운트**가 둘 다 있어야 함(불일치 시 또 유실). **Volume은 서비스별 독립**이라 test 업로드 사진은 prod에 안 보임(DB만 공유). 구 photoUrl 사진은 복구 안 됨 → 재업로드 1회 필요.
- **미반영(기존 앱 전역 패턴, 이번 PR 제외)**: responsive-ui-reviewer가 `teacher/page.tsx`의 `min-h-screen`(→dvh)·모바일 `p-4`(→축소)를 지적했으나 student/admin과 공유되는 기존 패턴이라 별건 처리 권장.
- Spec/Plan: `docs/superpowers/specs/2026-06-16-teacher-meal-management-design.md`, `docs/superpowers/plans/2026-06-16-teacher-meal-management.md`.

---

## 현황 (2026-06-11 오후) — 관리자 대리 신청 모달 + 일괄업로드 양식 개편 **배포 완료** (1087e21, 양 브랜치 동기)

stats 페이지(`/admin/applications/[id]/stats`)에서 ① 명단 행 클릭 또는 수정 버튼 → `AdminApplyDialog`로 학생 신청 화면과 동일한 폼으로 대리 신청/수정 (서명 대신 안내+신청 시각, 신청기간 무시), ② 일괄업로드 양식이 YN=단일/DATE="중식-7월 5일" 날짜별/WEEKDAY="조식-월요일" 요일별(월 공통) 컬럼으로 개편.

- **핵심 구조**: `src/lib/meal-template-columns.ts`가 양식 컬럼 생성↔헤더 역파싱의 단일 진실 (export·import 라우트 공유, 왕복 단위테스트). `ApplicationApplyForm.tsx`가 식사별 신청 폼 공용 컴포넌트 (학생 화면·관리자 모달 공유, footer render-prop, lazy useState 초기화라 **마운트 전 데이터 준비 + key 재마운트 필수**).
- **관리자 대리 신청 표시**: `MealRegistration.addedBy="ADMIN"` + `updatedAt` 활용 (마이그레이션 없음). 관리자가 학생 신청을 모달로 수정하면 POST upsert가 signature="(관리자 등록)"·addedBy=ADMIN으로 덮어씀 — **의도된 동작** (학생 화면·명단 배지에 관리자 신청으로 표시됨). `[regId]` PATCH meals 분기는 현재 미사용(dead code).
- **업로드 의미론**: O 없는 행=건너뜀(취소 아님), 학년 미개설일 O=무시(`ignoredMarks` 집계), WEEKDAY 재업로드는 월별 차등을 합집합으로 평탄화(스펙 명시 수용 손실). `resolveRegistrationSelections`에 `ResolveContext` 옵션 인자 추가(임포트 N+1 제거). MAX_FILE_SIZE_MB 가드.
- 같은 날 사용자가 **다크모드 제거**(2c947d6, 라이트 전용) — 코드의 `dark:` 클래스는 비활성 잔존.
- Spec/Plan: `docs/superpowers/specs/2026-06-11-admin-proxy-apply-bulk-template-design.md`, `docs/superpowers/plans/2026-06-11-admin-proxy-apply-bulk-template.md`.

---

## 현황 (2026-06-11) — 조/중/석 3분할 + 리로스쿨 방식 급식신청 전면 개편 **완료**

**prod/test 양쪽 배포 완료, 구 컬럼/테이블 정리까지 끝남** (양 브랜치 동기 상태, ca74156). 정리는 3-wave로 진행: Wave 1(구 컬럼 제약 완화+쓰기 제거) → Wave 2a(스키마/코드에서 제거 — Prisma는 스키마 전 컬럼을 SELECT하므로 **DROP 전에 반드시 스키마 제거 코드가 양쪽에 떠 있어야 함**) → Wave 2b(DROP 마이그레이션 20260611000004). 구 테이블 데이터는 로컬 `.backup_*.csv` 3개로 백업해 둠 (repo 미커밋). 시간대는 운영자가 조식 00:00~08:30/중식 08:31~14:00/석식 14:01~23:59로 설정 완료. 관리자 탭 명칭 "석식 확인"→"급식 확인".

- 새 테이블 4개: `MealApplicationMeal`(식사별 단가/면제/신청방법 NONE|YN|WEEKDAY|DATE), `MealApplicationMealDate`(학년별 개설일), `MealRegistrationMeal`, `MealRegistrationMealDate`(체크인 자격의 단일 진실). `MealKind`에 LUNCH. 마이그레이션 `20260611000001/2` — additive + 멱등 백필(ON CONFLICT). 구 컬럼(type="MULTI" 마커, applyStart/End)·구 테이블은 prod 호환용 유지, **2차 정리 마이그레이션은 미실시**.
- 새 페이지: `/admin/applications/new`, `[id]/edit`(ApplicationForm + AdminMealCalendar), `[id]/stats`(ApplicationStats — 리로 양식 3시트 엑셀, 일괄신청).
- 체크인 자격 = `MealRegistrationMealDate(오늘, mealKind) + registration.status=APPROVED` 단일 조회. CANCELLED 신청의 날짜 행은 보존되므로 **모든 집계에 status/applied 필터 필수**.
- base-ui `SelectValue`는 원시 value를 렌더 → 라벨≠값이면 함수 children 필수 (이미 전 사용처 적용).
- **남은 일**: 백필된 "기말고사 중식희망신청(연장)" 공고가 석식으로 매핑됨(구 시스템에 중식 없음) — 중식 정정 여부는 사용자 결정 대기. 그 외 완료.
- Spec/Plan: `docs/superpowers/specs/2026-06-11-meal-three-way-split-design.md`, `docs/superpowers/plans/2026-06-11-meal-three-way-split.md`.

---

## 현황 (2026-05-02)

CheckIn 조식/석식 분리 완료, prod·test 동기화. `CheckIn.mealKind` NOT NULL + `@@unique([userId,date,mealKind])`. 같은 날 조식+석식 두 row 가능. 관리자 석식확인·당일현황의 조식 컬럼/카드는 **승인된 BREAKFAST 신청일에만** 노출 (`MealRegistrationDate.where = { status:"APPROVED", application:{type:"BREAKFAST"} }`). 시간대 분기는 `lib/meal-kind.ts:resolveMealKind` 가 KST 시각으로 결정 후 QR 토큰 페이로드에 박힘.

신규 파일: `src/lib/meal-columns.ts` (월별 컬럼 빌더), `src/lib/__tests__/checkin-meal-kind-split.test.ts`. vitest 도입 (`npm test`).

**자세한 배경**: `feedback_prisma_unique_ddl.md`, `project_breakfast_split_2026_05_02.md` 참조.

---

## 현황 (2026-04-30)

석식 신청 취소 후 재신청 허용 기능 배포 완료. 학생/관리자 누가 취소했든 신청 기간(`applyStart..applyEnd`) 내라면 학생이 "신청하기" 버튼으로 자유롭게 재신청 가능. 잠금 UI 도입 안 함.

**구현:** `POST /api/applications/[id]/register` upsert 분기 — 기존 row 가 CANCELLED 면 `update`로 status:APPROVED, signature 갱신, cancelledAt/cancelledBy null 처리. 신규는 create. APPROVED 상태에서 재요청 시 409. update 경로 200, create 경로 201. `src/app/student/page.tsx` `pendingCount`도 CANCELLED 카운트하도록 보정.

**Spec:** `docs/superpowers/specs/2026-04-30-meal-reapplication-design.md`

---

## 현황 (2026-04-29)

PROJECT_MAP.md (`E:\Projects\posanmeal\PROJECT_MAP.md`) 가 전체 아키텍처의 단일 진실 소스다. 세션 시작 시 반드시 먼저 읽을 것.

**Why:** 이 프로젝트는 .claude/memory/ 디렉토리를 별도로 사용하지 않으며, PROJECT_MAP.md가 Tier-2 세부 문서 역할을 겸한다.

**How to apply:** 새 세션 → `E:\Projects\posanmeal\PROJECT_MAP.md` 읽기 → CLAUDE.md 참조.

---

## 2026-04-29: prod/test 브랜치 분리 + 커스텀 도메인 meal.posan.kr 도입

- **main = 운영**, 도메인 `https://meal.posan.kr` (Gabia 구매 도메인 + Railway 커스텀 도메인 + Let's Encrypt SSL).
- **feat/posanmeal-mvp = 테스트**, 도메인 `https://posanmeal.up.railway.app` 그대로 유지.
- Railway에서 main을 watch하는 prod 서비스 신설; 기존 서비스는 test로 재지정.
- **DB·Volume·모든 시크릿 공유**. 환경별로 다른 값은 `NEXT_PUBLIC_SITE_URL`, `AUTH_URL` 두 개.
- 코드 변경: `src/app/layout.tsx`의 `metadataBase`를 `process.env.NEXT_PUBLIC_SITE_URL ?? "https://meal.posan.kr"` 로 환경변수 기반 변경. `.env.example`에 `NEXT_PUBLIC_SITE_URL` 항목 추가.
- 이전 정책(2026-04-14 단일 브랜치 운영)은 폐기.

---

## 2026-04-14: 교사 admin/subadmin 권한 시스템 도입

(브랜치 정책 관련 내용은 2026-04-29 재정의로 무효화됨. 권한 시스템만 유효)

### 교사 admin/subadmin 권한
- **Schema**: `AdminLevel` enum (`NONE | SUBADMIN | ADMIN`) + `User.adminLevel` 컬럼 (default NONE) + `@@index([role, adminLevel])`.
- **환경변수 admin**과 **DB 교사 admin**이 공존. 교사 admin = 같은 권한. subadmin = `/admin` 읽기 전용 + 월별 Excel 다운로드만.
- **서버 권한 헬퍼**: `src/lib/permissions.ts` — `canWriteAdmin`, `canReadAdmin`, `getEffectiveAdminLevel`. 환경변수 admin(`role==="ADMIN"`)은 항상 ADMIN으로 간주.
- **미들웨어**: `/admin`, `/api/admin` 진입은 `canReadAdmin` 통과. 쓰기 차단은 각 API 핸들러에서 `canWriteAdmin`.
- **클라이언트 훅**: `src/hooks/useAdminPermission.ts` — `canWrite/canRead/isSubadmin/isTeacher/isEnvAdmin/displayName/badgeLabel/dbUserId` 반환.
- **API 매트릭스**: spec `docs/superpowers/specs/2026-04-14-teacher-admin-roles-design.md` §4. subadmin은 `/api/admin/applications/**` 전체, `/api/admin/users POST/PUT/DELETE`, `/api/admin/import`, `/api/admin/checkins PATCH`, `/api/system/settings PUT`, `/api/sync/**` 모두 403.
- **UI**: subadmin은 신청관리/설정 탭 미노출, 사용자관리 쓰기 버튼·권한 드롭다운 disabled, 석식확인 셀 토글 비활성, 당일현황 교사 type 토글 비활성.
- **권한 변경 반영 시점**: JWT rolling refresh가 DB 재조회를 안 하므로 **대상자 재로그인 시 적용**. admin UI는 이 점을 toast로 안내 ("다음 로그인 시 적용됩니다").
- **자기 자신 강등 금지 / 학생에게 admin 부여 금지**: 서버 + UI 양쪽 가드. 마지막 admin 보호는 구현 안 함 (환경변수 admin이 안전망).
- **Spec & Plan 문서**: `docs/superpowers/specs/2026-04-14-teacher-admin-roles-design.md`, `docs/superpowers/plans/2026-04-14-teacher-admin-roles.md`.

---

## 2026-04-12: MealPeriod → MealApplication/MealRegistration 전면 교체

**배경:** 기존 MealPeriod(학생 1:1 기간 설정) → 관리자가 신청 공고를 만들고 학생이 서명으로 등록하는 구조로 전환.

**삭제된 모델/파일:**
- `MealPeriod` DB 모델
- `src/app/api/admin/meal-periods/route.ts`

**추가된 모델:**
- `MealApplication`: 신청 공고 (type DINNER/BREAKFAST/OTHER, applyStart~applyEnd, mealStart~mealEnd, status OPEN/CLOSED)
- `MealRegistration`: 학생 등록 (signature Base64 PNG, status APPROVED/CANCELLED, addedBy, cancelledBy)

**추가된 파일:**
- `src/components/SignaturePad.tsx`
- `src/app/api/applications/` (route.ts, my/route.ts, [id]/register/route.ts)
- `src/app/api/admin/applications/` (route.ts, [id]/route.ts, [id]/close/, [id]/registrations/, [id]/registrations/[regId]/, [id]/export/)

**로컬 오프라인 모드 변경:**
- IndexedDB DB v3 (구 `mealPeriods` store → `eligibleUsers` store)
- `/api/sync/download` 가 eligibleUserIds 배열 반환

**QR 자격 확인 로직:**
- status=APPROVED인 MealRegistration이 존재하고 application.mealStart <= today <= application.mealEnd 이면 체크인 가능
