> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/E--Projects-posanmeal/memory/project_breakfast_split_2026_05_02.md`

---
name: PosanMeal 조식/석식 분리 완료 (2026-05-02)
description: CheckIn.mealKind NOT NULL + 조식 컬럼 노출 조건 = 승인된 BREAKFAST 신청일
type: project
originSessionId: 62daccbe-8662-45a8-94eb-3b655f2fbddd
---
2026-05-02 prod·test 모두 새 스키마로 동기화됨.

- `CheckIn.mealKind` NOT NULL, `@@unique([userId, date, mealKind])` 로 같은 날 조식+석식 동시 체크인 가능
- 관리자 석식확인·당일현황의 **조식 컬럼/카드는 `MealRegistrationDate` 중 status=APPROVED + application.type=BREAKFAST 에 해당하는 날짜에만 노출**. `MealApplicationDate`(공고 허용일) 가 아닌 점 주의 — 승인된 신청자가 0명인 BREAKFAST 공고는 컬럼이 안 생김
- 조식 운영일에는 학년 카드에 "조 N · 석 M" 부제 + records 테이블에 "식사" 컬럼 추가
- mealKind 시간 분기는 QR 토큰 발급 시점에 `resolveMealKind(nowKST(), windows)` 로 결정 (기본 04:00–10:00 조식, 15:00–21:00 석식, `SystemSetting`으로 override). 토큰 페이로드에 박혀 체크인 시 그대로 사용

**Why**: 사용자 요구 — 조식이 신청관리에서 승인된 날짜에 한해 컬럼 분리. 이전엔 마이그레이션 091000이 mealKind=NULL 백필 후 120000이 NOT NULL 전환했으나 SQL 오류로 실패해서 5/30·5/31 셀 토글이 끊겨 있었음.

**How to apply**: 향후 조식 운영일/체크인 흐름을 다룰 때:
- 조식 컬럼 노출 판정은 항상 `prisma.mealRegistrationDate.findMany({ where: { date, registration: { status: "APPROVED", application: { type: "BREAKFAST" } } } })` 패턴
- 같은 user×date 에 조식+석식 두 row 가능 — `findFirst({ userId, date })` 류 코드는 `mealKind` 까지 명시해야 정확
- 학생 본인 이력 조회·테이블 합산도 mealKind 분리 필요 (이미 `MonthlyCalendar`/`StudentTable`/`/api/admin/export` 수정 완료)
