> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/E--Projects-posanmeal/memory/feedback_prisma_unique_ddl.md`

---
name: Prisma unique 마이그레이션은 INDEX 패턴
description: PosanMeal 마이그레이션 작성 시 손으로 unique를 지우려면 DROP CONSTRAINT가 아니라 DROP INDEX IF EXISTS 사용
type: feedback
originSessionId: 62daccbe-8662-45a8-94eb-3b655f2fbddd
---
PosanMeal 의 `@@unique` 는 init 마이그레이션에서 `CREATE UNIQUE INDEX <Table>_<cols>_key` 로 생성된다. 이걸 손으로 지우는 마이그레이션을 쓸 때 `ALTER TABLE ... DROP CONSTRAINT "<Table>_<cols>_key"` 를 사용하면 PostgreSQL E42704 ("constraint does not exist") 로 실패한다 (`prisma migrate deploy` P3018 → 컨테이너 시작 실패 → P3009 가 다음 배포부터 누적).

**Why**: 2026-05-02 `20260502120000_make_checkin_mealkind_required` 가 이 패턴으로 작성되어 test 컨테이너가 떠지지 않고 prod도 같은 DB라 위험. 복구는 `prisma migrate resolve --rolled-back <name>` + 마이그레이션 SQL을 `DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX` 로 교체.

**How to apply**: PosanMeal 에서 `@@unique` 를 변경/제거하는 마이그레이션은 항상 다음 두 패턴 중 하나로 작성:
1. (선호) `prisma migrate dev` 가 자동 생성한 SQL 그대로 사용 — Prisma가 정확한 DROP/CREATE INDEX DDL을 만들어줌
2. 수동 작성 시: `DROP INDEX IF EXISTS "<Table>_<cols>_key"` + `CREATE UNIQUE INDEX "<Table>_<newcols>_key" ON "<Table>"(<newcols>)`. `DROP CONSTRAINT IF EXISTS` 도 함께 두면 향후 init 패턴이 바뀌어도 안전.

위험 마이그레이션 직전에는 `prisma-migration-guardian` 에이전트로 검수 권장.
