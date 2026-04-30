# 석식 신청 — 취소 후 재신청 허용

작성일: 2026-04-30
대상: 학생 신청 페이지 + 신청 API

## 배경

`MealRegistration` 은 `@@unique([applicationId, userId])` 제약 때문에 같은 학생이 같은 공고에 대해 row 를 두 개 만들 수 없다. 현재 흐름:

- 학생이 신청 → row 생성 (`status: APPROVED`)
- 학생 본인 취소 → `status: CANCELLED`, `cancelledBy: "STUDENT"`
- 관리자 취소 → `status: CANCELLED`, `cancelledBy: "ADMIN"`
- 취소 후 학생이 다시 "신청하기" 버튼을 누르면 → `prisma.create` 가 P2002 로 실패 → 토스트 "이미 신청되었습니다."

학생 페이지의 분기는 `isRegistered = registrations[0]?.status === "APPROVED"` 라서 CANCELLED 상태일 때 "신청하기" 버튼이 노출되지만, 누르면 위 P2002 로 막힌다. 즉 **취소 후 재신청 경로가 끊겨 있다**.

이 문서는 그 경로를 살리는 변경을 정의한다.

## 결정사항

- **방향**: 관리자/학생 누가 취소했든, **신청 기간(`applyStart..applyEnd`) 내** 라면 학생이 "신청하기" 버튼으로 자유롭게 재신청 가능.
- **잠금 UI(취소됨 회색 버튼 + "관리자에게 말씀하세요" 안내) 도입하지 않음.**
- **재신청 구현**: 기존 row 를 update (옵션 A — upsert). row 1개를 토글하며 재사용.

근거:
- 관리자 화면이 CANCELLED 행을 표시하고 토글하는 흐름이 있으므로 row 보존이 자연스럽다.
- DB 스키마/마이그레이션 변경 없이 처리 가능 — 변경 면적 최소.
- 학생 본인 취소·관리자 취소를 구분하지 않으므로 UI/API 분기 없이 동일 처리.

## 동작 정의

### 상태별 학생 신청 탭 UI

| `registrations[0]?.status` | 우상단 배지 | 우하단 버튼 | 동작 |
|---|---|---|---|
| (없음) | "신청 가능" (파랑) | "신청하기" | 다이얼로그 → 신규 create |
| `APPROVED` | "신청 완료" (초록) | "신청 취소" | DELETE → CANCELLED |
| `CANCELLED` | "신청 가능" (파랑) | "신청하기" | 다이얼로그 → 기존 row update |

### 빨간 배지(pending count)

"신청" 탭 라벨 옆 배지는 다음을 카운트:
- `registrations.length === 0` (한 번도 신청 안 함)
- 또는 `registrations[0]?.status === "CANCELLED"` (취소되어 다시 액션 필요)

`APPROVED` 는 카운트 제외.

## API 변경

### `POST /api/applications/[id]/register`

기존 `prisma.create` 를 다음 로직으로 교체:

```ts
const existing = await prisma.mealRegistration.findUnique({
  where: { applicationId_userId: { applicationId, userId } },
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
      data: { applicationId, userId, signature },
    });

return NextResponse.json({ registration }, { status: 201 });
```

기간 검증(`today >= applyStart && today <= applyEnd`, `app.status === "OPEN"`)과 입력 검증(`signature` 필수, 200KB 제한)은 기존 코드 그대로 유지. P2002 catch 는 동시성 안전망으로 남기되, `existing` 분기로 정상 경로에서는 트리거되지 않는다.

### 변경 없는 엔드포인트

- `DELETE /api/applications/[id]/register` (학생 취소): 그대로
- `PATCH /api/admin/applications/[id]/registrations/[regId]` (관리자 토글): 그대로
- `GET /api/applications` (목록): 그대로. `cancelledBy` 노출 불필요 — UI 가 누가 취소했는지 구분하지 않음.

## UI 변경

### `src/app/student/page.tsx`

**pendingCount 보정**

```ts
// 변경 전
const pendingCount = applications.filter(
  (a) => a.registrations.length === 0
).length;

// 변경 후
const pendingCount = applications.filter(
  (a) => a.registrations.length === 0 || a.registrations[0]?.status === "CANCELLED"
).length;
```

**`isRegistered` 분기**: 변경 없음. 이미 `status === "APPROVED"` 기준이라 CANCELLED 일 때 자동으로 "신청하기" 분기로 들어감.

**다이얼로그/`handleRegister`**: 변경 없음. POST 로 새 서명을 보내면 API 가 알아서 update/create.

## DB

스키마 변경 없음. 마이그레이션 없음. 기존 데이터 그대로 사용 가능.

## 에지 케이스

1. **신청 기간 종료 후 재신청 시도**: `today > applyEnd` 가드로 400 "신청 기간이 아닙니다." (현재 코드 동일).
2. **공고 `status: CLOSED`**: 동일 가드로 차단.
3. **APPROVED 상태에서 재신청 시도** (UI 외 직접 호출): 409 "이미 신청되었습니다."
4. **동시 클릭**: unique 제약으로 한 쪽 P2002 → catch 에서 409.
5. **취소 → 재신청 → 재취소 반복**: row 한 개를 status 토글, signature 는 마지막 신청 서명으로 갱신.
6. **재신청 시 서명**: 학생이 다이얼로그에서 새 서명. 기존 신규 신청 흐름과 동일.
7. **관리자 화면 반영**: 학생 재신청 시 admin 목록에서 해당 행이 APPROVED 로 표시되는지 확인.

## 수동 검증 시나리오 (staging)

1. 학생이 신청 → "신청 취소" → 다시 "신청하기" 표시 → 새 서명 → APPROVED 복귀.
2. 학생이 신청 → 관리자가 취소 토글 → 학생 페이지 새로고침 시 "신청하기" 표시 → 재신청 → APPROVED 복귀.
3. 신청 기간 종료 후 재신청 시도 → "신청 기간이 아닙니다." 토스트.
4. "신청" 탭 빨간 배지: 신청 안 한 공고 + 취소된 공고 합산이 표시되는지 확인.
5. 관리자 화면이 재신청 결과(APPROVED) 를 반영하는지 확인.

## 변경 면적

- `src/app/api/applications/[id]/register/route.ts` — POST 핸들러 1곳
- `src/app/student/page.tsx` — `pendingCount` 1줄

이외 파일·스키마·마이그레이션·관리자 흐름 변경 없음.
