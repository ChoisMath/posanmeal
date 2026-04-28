# 관리자 수기 체크인 편집 — 설계

**작성일**: 2026-04-15
**브랜치**: `feat/posanmeal-mvp`

## 배경

관리자 `/admin` → 석식확인 탭에서 현재는 교사 셀의 `근무 ↔ 개인` 토글만 가능하다. 수기 장부에 적힌 체크인을 데이터로 옮기는 흐름이 없어, 누락된 체크인을 관리자가 직접 보완할 수 없다.

## 목표

1. **교사 탭**: 셀 클릭 시 `근무 → 개인 → 빈칸 → 근무` 순환
2. **학생 탭 (1/2/3학년)**: 셀 클릭 시 `빈칸 ↔ 체크인(STUDENT)` 토글
3. **주말 셀도 클릭 가능** (주말 근무/보충 수기 입력 대응)
4. **권한**: 최고관리자(ENV) + 교사-관리자(`adminLevel=ADMIN`). 서브관리자는 현재대로 read-only.

## 비목표

- 체크인 시각(`checkedAt`) 직접 편집 — 관리자가 클릭한 시점의 `new Date()`로 저장
- 과거 체크인 일괄 import — 이번 범위 밖
- 체크인 타입 세분화 — WORK/PERSONAL/STUDENT 기존 스키마 그대로

## API 설계

### 신규: `POST /api/admin/checkins/toggle`

**요청**
```json
{
  "userId": 123,
  "date": "2026-04-15",
  "action": "cycle" | "toggle"
}
```

- `action: "cycle"` — 교사용. 서버가 현재 상태 판독 후 전환:
  - 없음 → `type=WORK` 생성
  - `WORK` → `type=PERSONAL` 업데이트
  - `PERSONAL` → 삭제
- `action: "toggle"` — 학생용:
  - 없음 → `type=STUDENT` 생성
  - 있음 → 삭제

**응답**
```json
{ "success": true, "state": "WORK" | "PERSONAL" | "STUDENT" | "empty" }
```

**권한 검증**: `canWriteAdmin(session)` → 아니면 403.

**검증 로직**:
- `action="cycle"`: 대상 user.role === `TEACHER`이어야 함 (아니면 400)
- `action="toggle"`: 대상 user.role === `STUDENT`이어야 함 (아니면 400)
- `date` 파싱: `YYYY-MM-DD` → KST 기준 해당 날짜의 00:00 UTC date로 저장 (기존 체크인 생성 경로와 동일 규칙 준수)

### 기존 PATCH 유지

`/api/admin/checkins` PATCH는 그대로 유지 (내부적으로 다른 경로가 사용 중일 수 있으므로 손대지 않음). 신규 cycle 로직은 toggle 엔드포인트로 분리.

## 클라이언트 변경 — `src/components/AdminMealTable.tsx`

### 셀 onClick 통합

현재 `isTeacher && checkIn && !readonly` 조건에서만 클릭 가능. 다음과 같이 확장:

```ts
const canEdit = !readonly;
const handleCellClick = (userId: number, day: number, checkIn?: CheckInRecord) => {
  const date = formatDate(year, month, day); // "YYYY-MM-DD" KST
  const action = isTeacher ? "cycle" : "toggle";
  fetch("/api/admin/checkins/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, date, action }),
  }).then((r) => { if (r.ok) mutateGrid(); });
};
```

- `onClick`: `canEdit`이면 항상 연결 (교사/학생 모두, 빈 셀 포함, 주말 포함)
- `cursor-pointer hover:opacity-70 select-none` 클래스도 동일 조건에서 적용
- `title`: 빈 셀은 "클릭하여 추가", 체크인 셀은 기존 시각 + "(클릭하여 변경/삭제)"

### `readonly=true` (서브관리자) 동작

- 모든 onClick 미연결, cursor/hover 스타일 없음 → 현재와 동일 (변화 없음)

### 기존 PATCH 호출부 제거

`handleToggleType` 함수는 삭제하고 새 `handleCellClick`으로 대체. 교사 WORK↔PERSONAL 전환도 신규 cycle 경로를 통해 이루어짐 (동일 결과).

## 데이터 흐름

```
User click cell
  → handleCellClick(userId, day, checkIn?)
  → POST /api/admin/checkins/toggle
  → 서버: canWriteAdmin 검증 → user.role 검증 → 현재 체크인 조회 → upsert/delete
  → 클라이언트: mutateGrid() → SWR 재검증 → UI 갱신
```

**낙관적 업데이트 미적용** — 정확성 우선, 월별 그리드이므로 1회 클릭 지연은 허용 가능.

## 날짜 처리

기존 체크인 date 저장 규칙을 그대로 따른다 — KST 해당 일자의 0시를 UTC로 저장. 기존 체크인 생성 경로(`/api/checkin`)를 참조해 동일 유틸을 공유하거나 동일 패턴으로 구현.

## 테스트 시나리오 (수동)

1. 최고관리자 로그인 → 교사 탭 → 빈 셀 클릭 → `근`(WORK) 표시, 합계 +1
2. 같은 셀 재클릭 → `개`(PERSONAL) 표시
3. 재클릭 → 빈 셀, 합계 -1
4. 학생 탭 → 빈 셀 클릭 → `O` 표시
5. 같은 셀 재클릭 → 빈 셀
6. 주말 셀에서도 동일 동작 확인
7. 서브관리자 로그인 → 모든 셀 클릭 무반응 (현재와 동일)
8. 교사-관리자 로그인 → 최고관리자와 동일하게 동작

## 영향 파일

- 신규: `src/app/api/admin/checkins/toggle/route.ts`
- 수정: `src/components/AdminMealTable.tsx`
- PROJECT_MAP 업데이트 (구현 후)
