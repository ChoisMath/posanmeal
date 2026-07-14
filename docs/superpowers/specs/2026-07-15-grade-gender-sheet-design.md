# 설계: 신청 통계 엑셀 "학년별-성별" 시트 추가

- 날짜: 2026-07-15
- 상태: 승인됨
- 관련 파일: `src/lib/meal-stats-excel.ts`, `src/app/api/admin/applications/[id]/export/route.ts`

## 배경

관리자 `/admin` 신청관리 탭 → 공고 통계(`/admin/applications/[id]/stats`) → "엑셀저장"은
`GET /api/admin/applications/[id]/export`가 `buildStatsWorkbook`(`src/lib/meal-stats-excel.ts`)으로
3시트(전체신청내역·요일별·에듀파인)를 생성한다. 여기에 학년별 남/여 인원을 분석한
"학년별-성별" 시트를 4번째로 추가한다.

`StatsExcelInput.rows`에 `gender?: string | null` 필드가 이미 선언되어 있으나,
export 라우트의 user select에 `gender`가 빠져 있어 실제 값은 전달되지 않는 상태다.
DB `User.gender`(MALE/FEMALE, nullable)는 존재하며 학생은 API 검증상 필수이나
과거 데이터에 누락이 있을 수 있다.

## 요구사항

1. 공고에 조식·중식·석식이 함께 포함되면 **식사별로 표를 분리**해 세로로 배치한다.
   위에서부터 조식 라벨/조식 표 → 중식 라벨/중식 표 → 석식 라벨/석식 표 순.
   공고가 제공하지 않는 식사(method=NONE 또는 미포함)는 표를 만들지 않는다.
2. 각 표는 학년(1·2·3학년) × 성별(남/여) 인원수 + 계 열 + 합계 행으로 구성한다.
3. 성별 정보가 없는 신청자는 **미지정 열을 조건부**로 추가해 집계한다.

## 시트 레이아웃

시트명: `학년별-성별` (4번째 시트, 에듀파인 뒤)

```
조식                       ← 라벨 행 (bold)
구분 | 남 | 여 | 계        ← 헤더 (기존 HEADER_FILL 회색 + THIN_BORDER 재사용)
1학년 | 12 | 10 | 22
2학년 | ...
3학년 | ...
합계  | ...
(빈 행)
중식
...
(빈 행)
석식
...
```

- **미지정 열**: 시트 전체 기준으로 성별 누락 신청자가 1명이라도 있으면
  모든 표를 `남 | 여 | 미지정 | 계` 4열로 통일. 없으면 3열.
  (표마다 열 수가 달라지는 혼란 방지)
- **학년미상 행**: 학년 정보가 없는 신청자가 있으면 3학년 아래에 "학년미상" 행을
  조건부 추가. 합계 행에 포함.
- 값은 서버에서 계산한 정적 숫자 (시트2 요일별과 동일 방식 —
  시트1에 성별 컬럼이 없어 수식 참조 불가).

## 집계 규칙

- **카운트 기준**: 해당 식사의 확정일이 1일 이상인 신청자 —
  `(row.dates[kind]?.length ?? 0) > 0`. 시트1 "식수" 컬럼과 동일 기준이라
  두 시트 간 숫자가 일치한다. 면제(exempt) 학생도 식사는 하므로 포함.
- **성별 매핑**: `MALE`→남, `FEMALE`→여, 그 외(null/undefined/빈값)→미지정.
- 식사가 제공되지만 신청자가 0명이면 표는 0으로 채워 표시한다.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/lib/meal-stats-excel.ts` | `buildSheet4` 추가, `buildStatsWorkbook`에서 호출 |
| `src/app/api/admin/applications/[id]/export/route.ts` | user select에 `gender: true`, rows 매핑에 `gender: u.gender` 추가 |
| `src/lib/__tests__/meal-stats-excel.test.ts` | 시트4 테스트 추가 (기존 셀 값 검사 스타일) |

DB 스키마 변경 없음(마이그레이션 불필요), UI 변경 없음.

## 테스트

기존 `meal-stats-excel.test.ts` 스타일(워크북 생성 후 셀 값 검사)로:

1. 식사별 표 세로 배치 — 조식/중식/석식 라벨 위치, 미제공 식사 표 생략
2. 남/여 카운트 정확성 (dates 기반, 확정일 0일 신청자 제외)
3. 미지정 열: 성별 누락 없으면 3열, 있으면 4열
4. 합계 행 값

검증: `npm test` + `npm run build`.
