# 조식/중식/석식 3분할 + 리로스쿨 방식 급식신청 전면 개편 — 설계 스펙

- 작성일: 2026-06-11
- 상태: 사용자 승인됨 (설계 단계)
- 참고: 리로스쿨(posan.riroschool.kr) 급식신청 생성/신청/통계 페이지, 사용자 제공 스크린샷 5종, 신청페이지 디자인 HTML, 샘플 엑셀(`2025년_04월_4월_석식급식신청_내역서`)

## 1. 목표

1. 식사 구분을 조식/석식 2종 → **조식(BREAKFAST)/중식(LUNCH)/석식(DINNER)** 3종으로 확장.
2. 관리자 설정 탭에서 조/중/석 **시간대(window)** 를 각각 설정.
3. 신청 공고 생성 페이지를 리로스쿨 write_form 구조로 전면 개편: 공고 1건 안에 조/중/석 각각 단가·면제유무·신청방법·학년별 개설일 달력을 설정.
4. 학생 신청 페이지를 리로스쿨 view 구조로 전면 개편: 식사별 달력, 신청방법별 입력 UI, 총 급식비 표시.
5. 통계(신청결과) 페이지를 리로스쿨 stat 구조로 전면 개편 + 3시트 엑셀(전체신청내역/요일별/에듀파인) 다운로드.
6. 디자인은 리로스쿨 화면(색상: 조식 #CAE9FF 계열, 중식 #FFE0CA 계열, 석식 #FFCFD2 계열)을 차용하되 기존 Warm Modern 테마/Tailwind 체계 안에서 구현.

## 2. 확정된 요구사항 결정 (Q&A)

| 항목 | 결정 |
|---|---|
| 면제유무 | **리로 방식 그대로**: 공고에서 식사별 "면제 선택가능" 설정 시 학생이 신청할 때 면제 체크 가능. 면제 학생은 급식비 0원 계산, 통계·엑셀 면제 컬럼에 표시. 식사 자격은 면제와 무관하게 동일 |
| 기존 데이터 | **새 구조로 변환** (백필 마이그레이션). 기존 신청·체크인 이력 유지 |
| 서명 | **유지**: 신청 확정 시 SignaturePad 서명 입력 |
| 신청 수정 | **신청기간 내 자유 수정** (마지막 제출이 최종) |
| 요일선택 | **월별로 요일 선택**: 각 월 달력마다 요일 체크박스, 월마다 다른 요일 조합 가능. 선택한 요일은 그 달 개설일(본인 학년) 중 해당 요일 전부에 적용 |
| 중식 체크인 | **학생+교사 모두**: 중식 시간대 QR 체크인 시 LUNCH로 기록. 학생은 해당 날짜+식사 승인 신청 필요, 교사는 제한 없음 (현행 조/석과 동일) |
| 학생 버튼 | **신청하기 + 신청내역**만. 배식내역은 기존 "확인" 탭이 담당, 알림문자 제외 |
| 통계 기능 | **전부 포함**: 학년/학급 필터, 학년별·성별 합계, 개별 신청 수정/삭제, 일괄신청(양식 다운로드→업로드), 리로 양식 3시트 엑셀 |
| 파일첨부 | 공고 첨부1·2는 **이번 범위 제외** |
| 내용 입력 | plain multiline textarea (CKEditor 미도입, 추후 확장 가능) |
| 신청방법 | 리로 5종 중 4종: 신청불가/신청·미신청/요일선택/날짜선택 ("일별메뉴선택" 제외) |

## 3. 데이터 모델

### 3.1 Enum

```prisma
enum MealKind { BREAKFAST, LUNCH, DINNER }          // LUNCH 추가 (additive)
// MealApplyMethod 는 String 으로 저장 ("NONE" | "YN" | "WEEKDAY" | "DATE")
// — 기존 MealApplication.type/status 패턴(String)과 일관성 유지
```

### 3.2 테이블

```prisma
model MealApplication {            // 기존 테이블에 컬럼 추가
  // 기존: id, title, description?, type(구조 전환 후 미사용), applyStart/End(@db.Date, 미사용 예정),
  //       mealStart/End?, status, createdAt, updatedAt
  applyStartAt DateTime?           // 신청 시작 (날짜+시간, KST 기준 저장)
  applyEndAt   DateTime?           // 신청 마감 (날짜+시간)
  startYear    Int?                // 제목 "2026년"
  startMonth   Int?                // 제목 "06월"
  monthCount   Int?                // "1개월간" (1~6)
  meals        MealApplicationMeal[]
  mealDates    MealApplicationMealDate[]
}

model MealApplicationMeal {        // 공고 × 식사 설정
  applicationId       Int
  mealKind            MealKind
  price               Int          // 원/1식
  exemptionSelectable Boolean @default(false)
  method              String       // "NONE" | "YN" | "WEEKDAY" | "DATE"
  @@id([applicationId, mealKind])
}

model MealApplicationMealDate {    // 공고 × 식사 × 학년 × 개설일
  applicationId Int
  mealKind      MealKind
  grade         Int                // 1 | 2 | 3
  date          DateTime @db.Date
  @@id([applicationId, mealKind, grade, date])
  @@index([date, mealKind])
}

model MealRegistration {           // 기존 유지
  // applicationId+userId unique, signature, status(APPROVED/CANCELLED),
  // cancelledAt/By, addedBy, 취소 후 재활성화 패턴 유지
  meals     MealRegistrationMeal[]
  mealDates MealRegistrationMealDate[]
}

model MealRegistrationMeal {       // 신청 × 식사
  registrationId  Int
  mealKind        MealKind
  applied         Boolean          // YN 방식의 신청함/신청안함, WEEKDAY/DATE 는 선택 존재 여부
  exempt          Boolean @default(false)
  weekdaysByMonth String?          // JSON {"2026-07":[1,3,5]} — WEEKDAY 방식 UI 복원 전용
  @@id([registrationId, mealKind])
}

model MealRegistrationMealDate {   // 신청 × 식사 × 확정 날짜 (자격 판정의 단일 진실)
  registrationId Int
  mealKind       MealKind
  date           DateTime @db.Date
  @@id([registrationId, mealKind, date])
  @@index([date, mealKind])
}
```

### 3.3 설계 원칙

- **요일선택도 날짜로 풀어서 저장**: 식사 자격 판정은 항상 `MealRegistrationMealDate` 조회. `weekdaysByMonth` JSON 은 수정 화면 복원 전용.
- **금액은 저장하지 않음**: 총 급식비 = 단가 × (비면제) 선택일수, 항상 파생 계산. 단가 수정 시 불일치 방지.
- **YN 방식**: applied=true 시 본인 학년 개설일 전부를 `MealRegistrationMealDate` 에 복제. 공고의 개설일이 수정되면 YN 신청자의 날짜 rows 를 재동기화한다 (공고 수정 API 가 수행).
- 구 컬럼(`type`, `applyStart/End`)과 구 테이블(`MealApplicationDate`, `MealRegistrationDate`)은 1차 릴리스에서 유지(구 prod 코드 호환), 2차 정리 릴리스에서 drop.

## 4. 마이그레이션 전략 (prod/test DB 공유)

1. **1차 마이그레이션 (additive)**: `MealKind` 에 `LUNCH` 추가, 새 테이블 4개 생성, `MealApplication` 새 컬럼(전부 nullable) 추가. 구 코드(prod)가 새 스키마 위에서 그대로 동작.
2. **백필 (같은 마이그레이션 내 SQL)**:
   - 기존 공고 → `MealApplicationMeal` 1행: mealKind = type 매핑(BREAKFAST→BREAKFAST, DINNER/OTHER→DINNER), method="DATE", price=0, exemptionSelectable=false.
   - `MealApplicationDate` → `MealApplicationMealDate` 로 학년 1·2·3 복제.
   - `MealRegistration` → `MealRegistrationMeal` (applied=status가 APPROVED, exempt=false).
   - `MealRegistrationDate` → `MealRegistrationMealDate`. 선택일이 없는 신청(전체 신청 의미)은 공고 개설일 전체를 복제.
   - `applyStartAt/EndAt` = 기존 `applyStart` 00:00 / `applyEnd` 23:59 (KST). `startYear/Month/monthCount` 는 mealStart 또는 개설일 범위에서 유도.
3. 새 코드 배포: test(feat/posanmeal-mvp) → 검증 → main 머지 (분 단위로 좁힘).
4. **2차 정리 마이그레이션 (별도 릴리스)**: 구 컬럼·테이블 drop. 실행 전 `prisma-migration-guardian` 검수.

## 5. 시간대 설정 / 체크인

- `SystemSetting` 에 `lunch_window_start`, `lunch_window_end` 추가 (마이그레이션 불필요, 설정 UI 에서 생성).
- 관리자 설정 탭: 조식/중식/석식 3개 시간대 입력. `meal-windows-validation` 확장: 형식 검증 + 3개 윈도우 상호 겹침 금지.
- `lib/meal-kind.ts` `resolveMealKind(now, windows)`: BREAKFAST/LUNCH/DINNER/null 판정으로 확장. `meal-kind-local.ts`(오프라인 태블릿), QR 토큰 페이로드, `/api/checkin` 동일 적용.
- **학생 체크인 자격**: `MealRegistrationMealDate` 에 (오늘, mealKind) row 존재 + registration.status=APPROVED. 면제 여부 무관.
- 교사: WORK/PERSONAL 체크인에 mealKind 만 LUNCH 추가로 기록. 신청 시스템 대상 아님.

## 6. 관리자 — 공고 생성/수정 페이지

라우트: `/admin/applications/new`, `/admin/applications/[id]/edit` (모달 → 전용 페이지 전환). 신청관리 탭은 공고 목록 + 작성 버튼 + 상태 관리(마감 등) 유지.

### 6.1 폼 구조 (리로 write_form 차용)

1. **제목줄**: `[년도▾] [월▾] 부터 [N개월간▾(1~6)]` + 제목 텍스트(기본 "급식신청"). 기본값: 오늘이 속한 년/월, 1개월. 화면 표기 제목은 `"{년}년 {월}월 {제목}"` 조합.
2. **내용**: 멀티라인 textarea.
3. **신청 기간**: 시작/마감 각각 날짜(date picker) + 시(0~23) + 분(5분 단위) 선택. 마감 < 시작 검증.
4. **설정 사항** — 조식(파랑)/중식(주황)/석식(분홍) 3개 섹션, 각각:
   - 단가(원/1식, 숫자), 면제유무(선택불가/선택가능), 신청방법(신청불가/신청·미신청/요일선택/날짜선택) 드롭다운.
   - 신청방법 ≠ 신청불가일 때 개월수만큼 월 달력 반복 표시:
     - 헤더: `"{년}년 {월}월 급식일 선택"` + 월 전체 토글 체크박스.
     - 요일 행: 일~토 각 요일 체크박스 (해당 요일 열의 모든 학년·날짜 토글).
     - 학년 행: 요일×학년(1·2·3) ⬇ 버튼 (그 요일·학년 열 전체 토글).
     - 날짜 행: 날짜마다 1·2·3학년 체크박스 3개.
   - 신청방법 = 신청불가 시 달력 영역 비활성(회색).
5. 하단: [취소] [저장].

### 6.2 검증/저장

- 저장 시 단가 ≥ 0, 신청불가가 아닌 식사는 개설일 1개 이상.
- 수정 저장 시: 개설일이 줄어든 경우 기존 신청자의 해당 날짜 rows 삭제, YN 신청자는 새 개설일로 재동기화. 통계에 반영.

## 7. 학생 — 신청 페이지 (/student 신청 탭)

- 공고 목록(OPEN + 기간 내) → 공고 상세.
- 상단: 공고 제목/내용, 신청 기간(`06-10 17시00분 ~ 06-12 16시00분` 형식), 신청 인원, 신청자(이름·학번).
- **식사별 섹션** (method ≠ NONE 인 식사만, 리로 색상): 개월수만큼 월 달력. **본인 학년 개설일만** 노란색 하이라이트.
  - `YN`: 섹션 헤더에 라디오 [신청함/신청안함], 달력은 표시 전용.
  - `WEEKDAY`: 각 월 달력 요일 헤더에 체크박스. 체크 시 그 달 개설일 중 해당 요일 전부 선택 (달력 셀에 선택 표시).
  - `DATE`: 개설일 셀마다 체크박스.
  - exemptionSelectable 시 "면제 대상" 체크박스 (체크 시 해당 식사 0원).
- 섹션마다 `총 급식비 : 45,440원(5,680원×8일)` 실시간 표시, 페이지 하단 전체 합계.
- 하단: 서명(SignaturePad) + [신청하기] [신청내역]. 기간 내 재진입 시 기존 신청 복원·자유 수정. 신청내역은 본인 신청 요약(식사별 일수·금액·선택일).
- 서버 검증: 신청기간 내, 선택 날짜가 본인 학년 개설일 부분집합, YN 은 서버에서 날짜 전개.

## 8. 통계 페이지 + 엑셀

라우트: `/admin/applications/[id]/stats` (신청관리 탭에서 진입).

### 8.1 화면 (리로 stat 차용)

- 필터: 학년/학급 드롭다운, 학생 검색.
- 표: 순번 | 입력시간 | 아이디(이메일 앞부분) | 학번 | 이름 | 성별 | 식사별(개설된 식사만) {면제, 신청일수} | 관리(수정/삭제).
- 하단 합계 행: 1·2·3학년 합계 + 전체 합계, 남/여 구분 카운트.
- 관리 기능: 개별 신청 수정(학생과 동일한 편집 다이얼로그/페이지, addedBy=ADMIN), 삭제(취소 처리), 일괄신청(양식 엑셀 다운로드 → 업로드, 기존 import 개편).
- 반응형 규칙 준수: sticky header, `overflow-x-auto`, 셀 `whitespace-nowrap`.

### 8.2 엑셀 (샘플 파일과 동일한 3시트)

1. **전체신청내역**: 3행 헤더 — 1행: 순번/시간/아이디/학번/이름/수납액/합계/면제(3병합)/단가(3병합)/식수(3병합)/날짜별(MM/DD 3병합), 2행: 요일, 3행: 조/중/석. 데이터: 면제=1, 단가 행(2행 K~M)에 식사별 단가, 식수, 날짜×식사에 1. **수식 포함**: 수납액 `=(1-H4)*K4+...`, 합계 `=SUM(K4:M4)`, 금액 `=K$2*N4`, 하단 합계 행 `SUM/COUNTA`.
2. **요일별**: 첫 주 기준 요일별 조/중/석 식수.
3. **에듀파인**: 주야/계열/학과/학년/반/번호/성명/대상금액/조·중·석 면제/조·중·석 식수/조·중·석 금액/금액합계/신청시간 — `전체신청내역` 시트 셀 참조 수식.

파일명: `{년}년_{월}월_{제목}_내역서({신청수}).xlsx`.

## 9. 기존 화면 영향 (조/중/석 일반화)

- **석식확인 표(AdminMealTable) / 당일현황 / 월별 엑셀**: "승인된 조식 신청일에만 조 컬럼" 로직을 3식사로 일반화 — 날짜별로 승인 신청이 존재하는 식사 컬럼만 표시 (`buildMonthlyMealColumns` 확장). 석식은 항상 표시(기본 식사) 유지 여부 포함해 기존 동작 보존.
- **학생/교사 확인 탭(MonthlyCalendar)**: 체크인 mealKind 3종 표시.
- **체크인 토글 API**: mealKind=LUNCH 지원.
- 기존 `/api/applications/*` 학생 API, `/api/admin/applications/*` 관리자 API 는 새 구조 기준으로 재작성 (요청/응답 shape 변경).

## 10. 범위 제외

- 공고 파일첨부, 알림문자(SMS), 일별메뉴선택 신청방법, CKEditor 리치 텍스트, 실제 결제/수납 처리(금액은 표시·집계만).

## 11. 검증 계획

- vitest 단위 테스트: 요일→날짜 전개, 금액 계산(면제 포함), `resolveMealKind` 3윈도우, 윈도우 겹침 검증, 엑셀 빌더(헤더/수식 셀 주소).
- 로컬: `npm run build` + Playwright 로 공고 생성→학생 신청(3가지 방법)→수정→통계→엑셀 다운로드 흐름.
- 배포: test 서비스(`posanmeal.up.railway.app`) 검증 후 main 머지. 마이그레이션 푸시는 CLAUDE.md 의 test→prod 순서 엄수.
