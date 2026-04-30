# 석식 신청 — 취소 후 재신청 허용 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 직접 취소하거나 관리자가 취소한 석식 신청을, 신청 기간 내라면 학생이 다시 "신청하기"로 재신청할 수 있도록 한다.

**Architecture:** `MealRegistration` row 1개를 status 토글하며 재사용한다(옵션 A — upsert). `POST /api/applications/[id]/register` 핸들러가 기존 row 가 있으면 `update`, 없으면 `create` 하도록 분기를 추가한다. 학생 페이지는 `pendingCount` 산식만 보정한다. DB 스키마/마이그레이션 변경 없음.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 (`@/generated/prisma/client`), TypeScript, Tailwind v4, sonner toast.

**Spec:** `docs/superpowers/specs/2026-04-30-meal-reapplication-design.md`

**Branch:** `feat/posanmeal-mvp` (이 브랜치에서 직접 작업; CLAUDE.md 정책에 따라 검증 후 main 으로 머지)

---

## File Structure

| 파일 | 동작 | 역할 |
|---|---|---|
| `src/app/api/applications/[id]/register/route.ts` | Modify (POST 핸들러) | 기존 row 가 있으면 update, 없으면 create. APPROVED 상태면 409. |
| `src/app/student/page.tsx` | Modify (`pendingCount` 1줄) | 빨간 배지가 CANCELLED 도 카운트하도록 보정. |

이외 파일·DB 스키마·마이그레이션·관리자 흐름 변경 없음.

---

## Task 1: register POST 핸들러 — upsert 분기로 교체

**Files:**
- Modify: `src/app/api/applications/[id]/register/route.ts:33-43`

- [ ] **Step 1: 현재 POST 핸들러 본문 확인**

다음 명령으로 현재 상태 점검:

```bash
sed -n '33,43p' src/app/api/applications/[id]/register/route.ts
```

기대 출력 (현재 코드):

```ts
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
```

- [ ] **Step 2: try 블록을 upsert 분기로 교체**

`src/app/api/applications/[id]/register/route.ts` 의 33–43줄(위 try 블록 전체)을 아래로 교체:

```ts
  try {
    const existing = await prisma.mealRegistration.findUnique({
      where: { applicationId_userId: { applicationId, userId: session.user.dbUserId } },
    });

    if (existing?.status === "APPROVED") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }

    const registration = existing
      ? await prisma.mealRegistration.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            signature,
            cancelledAt: null,
            cancelledBy: null,
          },
        })
      : await prisma.mealRegistration.create({
          data: { applicationId, userId: session.user.dbUserId, signature },
        });

    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 신청되었습니다." }, { status: 409 });
    }
    throw err;
  }
```

변경 포인트:
- `findUnique` 로 선조회 → APPROVED 면 즉시 409, 그 외(없거나 CANCELLED)면 update/create 분기
- P2002 catch 는 동시성 안전망으로 유지(정상 경로에서는 트리거되지 않음)
- 기간 가드(`today < applyStart`, `today > applyEnd`, `app.status !== "OPEN"`)와 입력 가드(signature 존재/길이)는 위쪽 코드 그대로 — 손대지 않음

- [ ] **Step 3: 타입체크**

```bash
npx tsc --noEmit
```

기대: 에러 없음. (있다면 import/타입 누락 점검)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/applications/[id]/register/route.ts
git commit -m "feat(api): 석식 신청 POST 가 취소된 row 를 재활성화하도록 변경

기존 row 가 CANCELLED 면 status: APPROVED 로 update 하면서 새 서명·
cancelledAt:null·cancelledBy:null 로 갱신. 없으면 create. APPROVED 상태면 409.
spec: docs/superpowers/specs/2026-04-30-meal-reapplication-design.md"
```

---

## Task 2: 학생 페이지 — pendingCount 가 CANCELLED 도 카운트하도록 보정

**Files:**
- Modify: `src/app/student/page.tsx:97-99`

- [ ] **Step 1: 현재 pendingCount 식 확인**

```bash
sed -n '97,99p' src/app/student/page.tsx
```

기대 출력:

```ts
  const pendingCount = applications.filter(
    (a) => a.registrations.length === 0
  ).length;
```

- [ ] **Step 2: 산식 교체**

`src/app/student/page.tsx` 97–99줄을 아래로 교체:

```ts
  const pendingCount = applications.filter(
    (a) =>
      a.registrations.length === 0 ||
      a.registrations[0]?.status === "CANCELLED"
  ).length;
```

- [ ] **Step 3: 타입체크 + 빌드 (린트 포함)**

```bash
npx tsc --noEmit
```

기대: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/student/page.tsx
git commit -m "feat(student): 신청 탭 배지가 취소된 항목도 pending 으로 카운트

취소 후 재신청 허용에 맞춰 학생이 다시 액션해야 하는 항목을 표시.
spec: docs/superpowers/specs/2026-04-30-meal-reapplication-design.md"
```

---

## Task 3: 빌드 검증 + dev 서버 기동

**Files:** (없음 — 검증 단계)

- [ ] **Step 1: 프로덕션 빌드 검증**

```bash
npm run build
```

기대: 성공. (Next.js turbopack 빌드 통과, 타입/린트 에러 없음)

- [ ] **Step 2: dev 서버 기동**

별도 터미널에서:

```bash
npm run dev
```

`http://localhost:3000` 접속 가능 확인.

---

## Task 4: 수동 검증 — 학생 본인 취소 → 재신청

**전제:** 로컬 DB(`docker compose up -d`)에 OPEN 상태의 `MealApplication` 이 있고, 신청 기간이 오늘을 포함해야 함. 학생 계정으로 Google OAuth 로그인 가능해야 함. 없다면 관리자 화면에서 신청 공고를 새로 만든 뒤 진행.

- [ ] **Step 1: 학생으로 로그인 → "신청" 탭 진입**

화면 확인 — 우상단 빨간 배지에 미신청 공고 수가 표시되는지.

- [ ] **Step 2: 공고 카드의 "신청하기" 클릭 → 서명 → "신청 완료" 클릭**

기대:
- 토스트 "신청이 완료되었습니다."
- 카드 우상단 배지가 "신청 완료"(초록) 로 변함
- 우하단 버튼이 "신청 취소" 로 바뀜
- 탭 빨간 배지 카운트가 1 줄어듦

- [ ] **Step 3: 같은 공고에서 "신청 취소" 클릭 → confirm 확인**

기대:
- 토스트 "신청이 취소되었습니다."
- 카드 우상단 배지가 "신청 가능"(파랑) 으로 돌아옴
- 우하단 버튼이 "신청하기" 로 다시 표시
- 탭 빨간 배지 카운트가 1 늘어남 (취소된 항목도 pending 에 포함)

- [ ] **Step 4: 다시 "신청하기" → 새 서명 → "신청 완료"**

기대: Step 2와 동일 결과. 토스트 "이미 신청되었습니다." 가 **나오지 않아야 함**. APPROVED 로 복귀.

- [ ] **Step 5: DB 에서 row 가 1개로 유지되는지 확인**

```bash
npx prisma studio
```

`MealRegistration` 테이블에서 해당 (`applicationId`, `userId`) 조합의 row 가 정확히 1개이며 `status: APPROVED`, `cancelledAt: null`, `cancelledBy: null`, `signature` 가 마지막에 그린 서명으로 갱신되어 있는지 확인.

---

## Task 5: 수동 검증 — 관리자 취소 → 학생 재신청

- [ ] **Step 1: 관리자 로그인** (`/admin/login`)

`ADMIN_USERNAME` / `ADMIN_PASSWORD` 환경변수로 로그인.

- [ ] **Step 2: 해당 공고의 등록 목록 화면으로 이동**

Task 4에서 학생이 신청해 둔 상태에서, 관리자가 그 행의 상태를 `CANCELLED` 로 토글한다.

기대: PATCH 응답 OK, 행 상태가 CANCELLED 로 표시.

- [ ] **Step 3: 학생 페이지로 돌아가 새로고침**

기대:
- 카드 배지 "신청 가능"(파랑)
- 우하단 버튼 "신청하기"
- 탭 빨간 배지에 카운트 +1 반영

- [ ] **Step 4: "신청하기" → 새 서명 → "신청 완료"**

기대: APPROVED 복귀, 토스트 "신청이 완료되었습니다.", 에러 없음.

- [ ] **Step 5: 관리자 화면에서 해당 행이 APPROVED 로 표시되는지 확인**

기대: 관리자 화면을 새로고침하면 같은 행이 다시 APPROVED 로 보인다.

---

## Task 6: 수동 검증 — 신청 기간 종료 시 차단

- [ ] **Step 1: DB 에서 테스트용 공고의 `applyEnd` 를 어제 날짜로 임시 변경**

```bash
npx prisma studio
```

`MealApplication` 테이블에서 해당 행의 `applyEnd` 를 (오늘-1일) 로 수정·저장.

- [ ] **Step 2: 학생 페이지에서 "신청하기" 클릭 (CANCELLED 상태에서 시도)**

기대: 토스트 "신청 기간이 아닙니다." (400). row 상태 변경 없음.

- [ ] **Step 3: `applyEnd` 원복**

`applyEnd` 를 원래 날짜로 되돌린다. (이후 Task 7로 진행)

---

## Task 7: 동시성 / 직접 호출 케이스 (최소 확인)

- [ ] **Step 1: APPROVED 상태에서 직접 POST 호출 → 409 확인**

학생으로 신청 완료(APPROVED) 상태에서 브라우저 devtools 콘솔:

```js
fetch(`/api/applications/${APP_ID}/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ signature: "data:image/png;base64,test" }),
}).then(r => r.status).then(console.log)
```

`APP_ID` 는 해당 공고 id. 기대 출력: `409`.

---

## Task 8: 푸시 → test 환경 검증 → main 머지

CLAUDE.md 의 브랜치 정책: 항상 `feat/posanmeal-mvp` 먼저 → test 검증 → main 머지.

- [ ] **Step 1: 현재 브랜치 확인**

```bash
git status
git log --oneline -5
```

기대: `feat/posanmeal-mvp` 브랜치, 위 두 commit 이 최상위.

- [ ] **Step 2: origin 으로 푸시**

```bash
git push origin feat/posanmeal-mvp
```

- [ ] **Step 3: Railway test 서비스 배포 완료까지 대기 후 `https://posanmeal.up.railway.app` 에서 Task 4·5 시나리오를 한 번 더 실행**

(staging DB 가 prod 와 공유이므로 테스트 데이터에 주의 — 실제 신청 건이 영향 받지 않는 더미 공고를 사용하거나, 본인 계정으로만 시나리오 진행)

- [ ] **Step 4: main 으로 머지 후 푸시**

```bash
git checkout main
git pull --ff-only
git merge --ff-only feat/posanmeal-mvp
git push origin main
git checkout feat/posanmeal-mvp
```

기대: fast-forward 머지 성공. (충돌이 나면 별도 처리 필요 — 정책상 두 브랜치 차이는 분 단위)

- [ ] **Step 5: prod 배포 완료 후 `https://meal.posan.kr` 에서 학생 1명으로 Task 4 시나리오 한 번 smoke test**

문제 없으면 종료.

---

## Self-Review

- [x] Spec coverage: 동작 정의(상태 매핑/배지)/API 변경(POST upsert)/UI 변경(pendingCount)/에지 케이스(기간 종료/APPROVED 직접 호출/동시성)/수동 검증 5 시나리오 — 각각 Task 1·2·4·5·6·7 이 커버. 잠금 UI 미도입 결정도 변경 항목에서 누락 없이 반영.
- [x] Placeholder scan: TBD/TODO/"적절히 처리"/모호 단계 없음. 각 step 에 실제 명령·실제 코드 포함.
- [x] Type consistency: `cancelledAt`, `cancelledBy`, `status`, `signature` 등 Prisma 모델 필드명과 schema.prisma 정의 일치. `applicationId_userId` 복합 unique 키 이름은 Prisma 가 생성하는 표준 형식 그대로.

오류·누락 없음.
