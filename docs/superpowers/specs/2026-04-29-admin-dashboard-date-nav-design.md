# 관리자 당일현황 — 날짜 이동 + 일자별 Excel 다운로드

작성일: 2026-04-29
상태: Draft

## 배경 / 문제

`/admin` 의 "당일현황" 탭은 현재 **오늘 날짜의 석식 체크인 기록만** 보여주고, "Excel 다운로드" 버튼은 호출 시점의 **이번 달 전체** Excel(`/api/admin/export`)을 내려준다.

운영상 다음이 필요하다:
1. 어제·과거 임의 날짜의 석식 체크인 현황을 같은 화면에서 빠르게 확인.
2. 그렇게 선택한 날짜의 명단만 Excel로 받아 행정 처리에 사용.

## 목표

1. **당일현황 탭**에서 prev/next 화살표 + `<input type="date">` picker + "오늘" 단축 버튼으로 임의 일자를 선택할 수 있다.
2. 화면(요약 5개 카드 + 체크인 상세 표)이 선택된 일자의 데이터를 보여준다.
3. "Excel 다운로드" 버튼은 **현재 선택된 일자**의 단일 일자 Excel을 내려준다.
4. 기본값은 오늘(KST). 페이지 첫 진입과 탭 전환 시 오늘로 초기화.

## 비목표

- 월별 Excel은 본 작업의 출력물이 아니지만 기존 라우트는 `/api/admin/export`로 동일하게 두고, `?date=` 파라미터 유무로 분기한다(월별 경로 제거하지 않음).
- "석식 확인" 탭(AdminMealTable)은 변경하지 않는다.

## API 변경

### `GET /api/admin/dashboard`

**현재**: `?date=YYYY-MM-DD` 옵션 파라미터, 기본값 `todayKST()`. → 이미 지원되어 있음. **변경 불필요.**

### `GET /api/admin/export`

**현재**: `?year=&month=` 로 월별 Excel.

**변경**: 동일 라우트에서 `date` 파라미터 우선 분기.
- `?date=YYYY-MM-DD` 가 있으면 → **단일 일자 Excel** 생성, 응답.
- 없으면 → 기존 월별 동작 유지(옛 호출자 보호).

#### 단일 일자 Excel 포맷

단일 시트 `YYYY-MM-DD` 한 장. 구조:

```
| 1행 | 포산고등학교 석식 현황 — 2026-04-29 (수)                      (병합) |
| 2행 | 합계: 1학년 N · 2학년 N · 3학년 N · 교사 근무 N · 교사 개인 N · 총 N (병합) |
| 3행 | (빈 줄)                                                              |
| 4행 | 구분 | 학년 | 반 | 번호 | 이름 | 교과 | 체크인 시각 |
| 5행 ~ | 데이터 행                                                         |
```

- "구분" 열은 다음 5종 중 하나로 고정: `1학년` · `2학년` · `3학년` · `교사 근무` · `교사 개인`.
- 정렬: 구분(1학년→2학년→3학년→교사 근무→교사 개인) → 학년-반-번호(학생) / 이름(교사) 순.
- 학생 행: 학년·반·번호 채우고 교과 빈칸.
- 교사 행: 학년·반·번호 빈칸, 교과만 채움.
- "체크인 시각" 은 `HH:mm` (KST).
- 0건이어도 1·2·4행 헤더는 출력. 데이터 행은 0개로 끝남.

파일명: `석식현황_YYYY-MM-DD.xlsx`.

## 프론트엔드 변경 — `src/app/admin/page.tsx`

### 새 상태

```ts
const [dashboardDate, setDashboardDate] = useState<string>(() => todayKST());
```

`todayKST()` 는 `@/lib/timezone` 에서 import.

### `fetchDashboard()` 변경

```ts
async function fetchDashboard(date = dashboardDate) {
  const res = await fetch(`/api/admin/dashboard?date=${date}`);
  const data = await res.json();
  setDashboard(data);
}
```

### `handleExport()` 변경

```ts
async function handleExport() {
  const res = await fetch(`/api/admin/export?date=${dashboardDate}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `석식현황_${dashboardDate}.xlsx`;
  a.click(); URL.revokeObjectURL(url);
}
```

### useEffect / 탭 변경 핸들러

- `dashboardDate` 가 바뀌면 자동으로 `fetchDashboard()` 트리거하는 `useEffect` 추가.
- 탭 변경 시 `if (v === "dashboard") fetchDashboard()` 호출은 그대로(현재 dashboardDate 사용).
- 페이지 첫 진입의 `useEffect([userFilter])` 에서 `fetchDashboard()` 는 dashboardDate(=오늘) 그대로 사용.

### UI — "오늘의 석식 현황" 헤더 영역

기존:
```
오늘의 석식 현황                     [refresh] [Excel 다운로드]
```

변경:
```
[‹ 이전] [<input type=date>] [다음 ›] [오늘]   [refresh] [Excel 다운로드]
```

- 모바일에서 줄바꿈 대비:
  - 좌측 컨트롤 그룹과 우측 액션 그룹은 `flex flex-wrap gap-2`.
  - 모든 버튼/picker `whitespace-nowrap`, `min-h-9`.
- 카드 제목 `<h3>오늘의 석식 현황</h3>` 은 카드 위쪽에 별도 행으로 둘 수도 있고, 제거해도 좋다.
  - 결정: 제목을 **선택된 날짜로 동적 변경**한다 → `2026-04-29 (수) 석식 현황` 형식. 제목과 컨트롤 그룹을 한 행에 두되 모바일에서는 줄바꿈 허용.

### 키보드 / 접근성

- prev/next 버튼에 `aria-label="이전 날짜"` / `aria-label="다음 날짜"`.
- date picker 는 `<input type="date">` 사용 — 모바일 OS 네이티브 picker 활용.
- "오늘" 버튼은 `dashboardDate === todayKST()` 일 때 disabled.

## 데이터 흐름

```
[date picker / arrow] → setDashboardDate
                                 ↓
                         useEffect([dashboardDate])
                                 ↓
                         fetchDashboard(date)
                                 ↓
                  GET /api/admin/dashboard?date=YYYY-MM-DD
                                 ↓
                          setDashboard(data)
                                 ↓
                          UI re-render

[Excel 다운로드 클릭]
        ↓
GET /api/admin/export?date=YYYY-MM-DD
        ↓
ExcelJS 서버에서 단일 일자 시트 생성 → 다운로드
```

## 에러 / 엣지 케이스

- 잘못된 date 형식: API는 새 `Date(...)` 결과가 Invalid이면 400 반환. (현재 dashboard 라우트는 검증 없음 — date 검증 한 줄 추가.)
- 미래 날짜 선택: 허용한다(데이터는 0건). 별도 차단 없음.
- 시간대: 모든 비교는 `YYYY-MM-DD` 문자열 또는 KST 자정 기준. `todayKST()` 형식과 일치.

## 테스트 / 검증 계획

- TypeScript 컴파일: `npx tsc --noEmit`.
- 로컬 dev server에서 다음 플로우 수동 확인:
  1. /admin 진입 → 당일현황 탭 → 오늘 데이터 표시.
  2. ‹ 클릭 → 어제 데이터.
  3. picker로 임의 날짜 선택 → 해당 데이터.
  4. Excel 다운로드 → 파일명·내용이 선택 일자.
  5. "오늘" 버튼 → 오늘 복귀, disabled.
- Responsive: 모바일 너비에서 컨트롤 그룹이 줄바꿈으로 자연스럽게 흐르는지 확인.

## 마이그레이션 / 배포 메모

- DB 스키마 변경 없음.
- 환경변수 변경 없음.
- 브랜치: `feat/posanmeal-mvp` → 검증 후 `main` 머지 (CLAUDE.md 표준 워크플로).
