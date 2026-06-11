# 관리자 대리 신청 모달 + 일괄업로드 양식 개편 — 설계 스펙

- 날짜: 2026-06-11
- 대상 페이지: `/admin/applications/[id]/stats`
- DB 마이그레이션: **없음** (`MealRegistration.addedBy`, `updatedAt` 기존 필드 활용)
- 배포: `feat/posanmeal-mvp` 커밋 → 검증 → main 머지, 양 브랜치 동시 push (사용자 지시: main 즉시 반영)

## 1. 배경 / 문제

현재 stats 페이지의 관리자 신청 수단 두 가지 모두 날짜·요일을 선택할 수 없다.

1. **신청 추가 다이얼로그**: 학생 + 식사 종류만 선택. DATE/WEEKDAY 방식 식사는 "해당 학년 개설일 전체"로 일괄 등록된다.
2. **일괄업로드 양식**: 조/중/석 3컬럼에 O 표시 → 역시 개설일 전체 신청 처리.

또한 관리자가 등록한 신청임을 학생·관리자 화면 어디에서도 알 수 없다.

## 2. 요구사항 (확정 사항)

| 항목 | 결정 |
|------|------|
| 모달 진입 경로 | 명단 행 클릭(기존 신청 수정) + 신청 추가 버튼(학생 선택 후 신규 신청) **둘 다 통합** |
| 모달 UI | 학생 신청 화면(`StudentApplicationView`)과 동일한 식사별 선택 UI |
| 서명 대체 | 서명 패드 대신 "관리자 대리 신청" 안내 + 신청 시각 표시 |
| 표시 범위 | 관리자 모달 + **학생 본인 화면**에도 관리자 대리 신청 여부·시각 표시 |
| 신청기간 제한 | 관리자는 신청기간(applyStartAt~EndAt)·마감(CLOSED) **무시** (현행 API 동작 유지) |
| 양식 날짜 컬럼 | DATE 방식 → 날짜별 컬럼(`중식-7월 5일`), WEEKDAY 방식 → 요일별 컬럼(`조식-월요일`, **월 구분 없이 공통**), YN 방식 → 단일 컬럼(`조식`) |
| 학년 미개설일 O | **무시하고 나머지만 등록**, 무시 건수를 결과 메시지에 표시 |
| 양식 프리필 | 기존 APPROVED 신청의 선택 내용(날짜·요일·YN)을 O로 **미리 채움** |
| 빈 행(O 없음) | 현행 유지 — 건너뜀. O를 모두 지워도 기존 신청은 취소되지 않음 (취소는 명단의 취소 버튼) |

## 3. 설계

### 3.1 공용 신청 폼 추출 — `src/components/meal/ApplicationApplyForm.tsx` (신규)

`StudentApplicationView`에서 다음을 이동:

- 식사별 섹션 렌더링: YN 라디오, `StudentMealCalendar`(date/weekday/readonly 모드), 면제 체크박스, 식사별 금액
- `MealState` 상태 관리(`applied`/`exempt`/`dates`/`weekdays`)와 토글 핸들러
- 총 납부 금액 계산(`calcMealFee`, `expandWeekdaysPerMonth`)
- 제출 payload(`mealsBody`) 빌드 로직

Props:

```ts
interface ApplicationApplyFormProps {
  application: {            // meals에 openDates 포함 (대상 학생 학년 기준)
    startYear: number; startMonth: number; monthCount: number;
    meals: { mealKind; price; exemptionSelectable; method; openDates: string[] }[];
  };
  initialMeals?: MyRegistrationMeal[];  // 기존 신청 (없으면 신규)
  disabled?: boolean;
  footer: (ctx: { buildMealsBody: () => MealsBody; totalFee: number }) => ReactNode;
}
```

- 폼은 fetch/제출을 모르고, footer 슬롯이 제출 버튼·서명/안내를 렌더링한다.
- `StudentApplicationView`는 학생 API(`/api/applications/[id]`)로 fetch → 폼 + 서명 footer. **학생 동작 변화 없음.**

### 3.2 관리자 모달 — `src/components/meal/AdminApplyDialog.tsx` (신규)

- **진입 1 — 명단 행 클릭**: `ApplicationStats` 표의 행(관리 버튼 제외 영역) 클릭 → 해당 registration으로 모달 오픈 (취소된 행 포함 — 재활성화 용도).
- **진입 2 — 신청 추가 버튼**: 모달 1단계에서 학년/반 필터 + 학생 목록 선택(기존 `AddDialog`의 학생 선택 UI 재활용, "전체 적용" 식사 토글 로직은 제거) → 2단계에서 신청 폼.
- 데이터 소스:
  - 공고 상세·개설일: `GET /api/admin/applications/[id]` (기존 — meals에 grade별 dates 포함). 대상 학생 학년으로 필터해 `openDates` 구성.
  - 기존 신청 상세: `GET /api/admin/applications/[id]/registrations/[regId]` (**신규 GET**) — meals(applied/exempt/weekdaysByMonth) + selectedDates 반환.
- 서명 자리: 안내 박스 — "관리자 대리 신청으로 등록됩니다." + 기존 신청이면 "신청 시각: {updatedAt KST}" 표시.
- 제출: 기존 `POST /api/admin/applications/[id]/registrations` `{userId, meals}` (upsert — 신규/수정 공용). 성공 시 `mutate()` 후 모달 닫기.
- 신청기간·마감 검증 없음 (현행 POST 동작 그대로).

### 3.3 관리자 표시 — `ApplicationStats` 표

- `addedBy === "ADMIN"` 행: 이름 옆 "관리자" 배지.
- 기존 `AddDialog` 컴포넌트 제거, `AdminApplyDialog`로 대체.

### 3.4 학생 화면 표시

- `GET /api/applications/[id]` 응답의 `myRegistration`에 `addedBy`, `updatedAt` 필드 추가.
- `StudentApplicationView`: `addedBy === "ADMIN"`이면 안내 박스 — "이 신청은 관리자가 대리 신청했습니다 ({updatedAt KST})".

### 3.5 양식 컬럼 빌더 — `src/lib/meal-template-columns.ts` (신규)

다운로드·업로드가 공유하는 단일 진실. 서버 전용 의존성 없이 순수 함수로 작성.

```ts
type TemplateColumn =
  | { kind: MealKind; type: "YN" }                         // 헤더 "조식"
  | { kind: MealKind; type: "DATE"; date: string }          // 헤더 "중식-7월 5일"
  | { kind: MealKind; type: "WEEKDAY"; weekday: number };   // 헤더 "조식-월요일"

buildTemplateColumns(meals, openDatesUnion): TemplateColumn[]
columnHeader(col): string          // 컬럼 → 헤더 문자열
parseColumnHeader(header, months): TemplateColumn | null  // 헤더 → 컬럼 (역파싱)
```

- DATE 컬럼: 전 학년 개설일 합집합, 날짜순. 헤더는 `{식사}-{M}월 {D}일`. 역파싱 시 공고 대상 월 목록(`monthsOf`)에서 연도를 복원한다(같은 월이 두 해에 걸치는 공고는 현재 운영상 없음 — monthCount가 12 미만이면 월은 유일).
- WEEKDAY 컬럼: 개설일에 등장하는 요일의 합집합, 일~토 순. 헤더는 `{식사}-{요일}요일`.
- YN 컬럼: 단일. method가 NONE이거나 미설정인 식사는 컬럼 자체를 생성하지 않는다 (기존 "(신청불가)" 컬럼 제거).

### 3.6 양식 다운로드 — `export/route.ts` (template 분기 개편)

- 1행 헤더: `학년, 반, 번호, 이름` + `buildTemplateColumns` 결과. 식사별 헤더 배경색 구분(조/중/석).
- 2행 안내문: "신청할 날짜/요일에 O 표시. O를 모두 지워도 기존 신청은 취소되지 않습니다 (취소는 신청 명단에서)."
- 3행~: 전체 학생(학년·반·번호 순). 프리필:
  - YN: 해당 식사 `applied=true`면 O
  - DATE: registration의 확정일(`mealDates`)에 해당하는 컬럼에 O
  - WEEKDAY: `weekdaysByMonth` **합집합**(어느 달이든 선택된 요일)에 O
- APPROVED 신청만 프리필 대상 (현행과 동일).

### 3.7 일괄업로드 — `import/route.ts` 개편

1. 1행을 `parseColumnHeader`로 읽어 컬럼 인덱스 → `TemplateColumn` 맵 구성. 인식 불가 헤더 컬럼은 무시. (하드코딩 E/F/G 제거)
2. 3행~ 각 행: 학년·반·번호로 학생 매칭 (현행 유지, 미발견 → `skippedNotFound`).
3. O 파싱(`isOMarked` 현행 유지: O/o/ㅇ, richText 처리)으로 식사별 입력 구성:
   - YN 컬럼 O → `{ applied: true }`
   - DATE 컬럼 O들 → `selectedDates` 배열. **학생 학년에 미개설인 날짜는 제외**하고 `ignoredMarks++`
   - WEEKDAY 컬럼 O들 → 모든 대상 월에 동일 적용한 `weekdaysByMonth`
4. 행에 O가 하나도 없으면 건너뜀 (기존 신청 유지).
5. 특정 식사의 유효 선택이 0이 되면(전부 미개설 등) 그 식사만 행에서 제외. 행에 남은 식사가 없으면 `skippedInvalid++`.
6. 등록: 현행과 동일 — `resolveRegistrationSelections` → `writeRegistration(tx, ..., "(관리자 일괄등록)", resolved, "ADMIN")`.
7. 응답: `{ added, updated, skippedNotFound, skippedInvalid, ignoredMarks, total }`. `ApplicationStats`의 결과 토스트에 "무시된 표시 N개" 추가.

## 4. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `src/components/meal/ApplicationApplyForm.tsx` | **신규** — 공용 신청 폼 |
| `src/components/meal/AdminApplyDialog.tsx` | **신규** — 관리자 대리 신청 모달 (학생 선택 + 폼) |
| `src/lib/meal-template-columns.ts` | **신규** — 양식 컬럼 빌더/헤더 파서 (+ 단위 테스트) |
| `src/components/meal/StudentApplicationView.tsx` | 폼 추출 후 래퍼화, 관리자 대리 신청 안내 박스 |
| `src/components/meal/ApplicationStats.tsx` | 행 클릭 핸들러, AddDialog → AdminApplyDialog 교체, 관리자 배지, 토스트 메시지 |
| `src/app/api/admin/applications/[id]/registrations/[regId]/route.ts` | GET 추가 (신청 상세: meals + selectedDates + weekdaysByMonth) |
| `src/app/api/applications/[id]/route.ts` | `myRegistration`에 `addedBy`/`updatedAt` 추가 |
| `src/app/api/admin/applications/[id]/export/route.ts` | template 분기 개편 |
| `src/app/api/admin/applications/[id]/import/route.ts` | 헤더 파싱 기반 개편 |

## 5. 에러 처리

- 모달: 개설일/신청 상세 로드 실패 시 토스트 후 모달 유지(재시도 가능). 제출 실패는 서버 에러 메시지 토스트 (현행 패턴).
- 업로드: 시트 없음/헤더 인식 불가(필수 4컬럼 또는 식사 컬럼 0개) → 400 "양식 형식이 올바르지 않습니다. 양식을 다시 다운로드해 사용해주세요."
- 업로드 행 단위 실패는 전체를 중단하지 않고 카운트로 집계 (현행 패턴 유지).

## 6. 테스트

- `meal-template-columns` 단위 테스트(vitest): 컬럼 생성 순서, 헤더 생성↔역파싱 왕복, 연도 복원, WEEKDAY 합집합.
- 수동 검증 (test 도메인): 행 클릭 수정 / 신청 추가 신규 / DATE·WEEKDAY·YN 혼합 공고 양식 다운로드 → 수정 → 업로드 / 학생 화면 안내 박스 / 기존 학생 신청 플로우 회귀 확인.

## 7. 제외 범위 (YAGNI)

- 업로드로 신청 취소 처리 (빈 행 = 건너뜀 유지)
- 면제(exempt) 컬럼의 양식 반영 — 양식에서는 면제 입력 불가, 모달에서만 가능
- 교사 신청 양식 (양식은 학생 전용, 현행 동일)
