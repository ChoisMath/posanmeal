> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/E--Projects-posanmeal/memory/MEMORY.md`

- [Posanmeal 브랜치 정책](feedback_branch_workflow.md) — **단일 서비스(2026-06-16)**: main=운영(meal.posan.kr, dinner 서비스)뿐. test 서비스 없음 → 검증은 로컬(npm build/test), main push가 유일한 배포 트리거
- [Posanmeal 프로젝트 현황](posanmeal_project_state.md) — 2026-06-16 담임 학생관리(식사별 컬럼+신청 음영)·신청현황 탭·사진 볼륨 저장 **prod 배포 완료**(5d7b518, meal.posan.kr 라이브); 2026-06-11 조/중/석 3분할; PROJECT_MAP.md가 단일 진실 소스
- [Prisma unique 마이그레이션 DDL](feedback_prisma_unique_ddl.md) — DROP CONSTRAINT가 아니라 DROP INDEX IF EXISTS 사용 (init이 CREATE UNIQUE INDEX로 만들었기 때문)
- [조식/석식 분리 (2026-05-02)](project_breakfast_split_2026_05_02.md) — CheckIn.mealKind NOT NULL, 조식 컬럼은 승인된 BREAKFAST 신청일에만 노출
