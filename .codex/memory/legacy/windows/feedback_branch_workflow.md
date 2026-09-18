> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/E--Projects-posanmeal/memory/feedback_branch_workflow.md`

---
name: Posanmeal 브랜치 정책 (단일 서비스)
description: main=운영(meal.posan.kr, dinner 서비스) 단일 서비스; 검증은 로컬, main push가 유일한 배포 트리거. test 서비스 없음
type: feedback
originSessionId: 49a2f5e7-f168-4652-b774-c946c2c4a439
---
Posanmeal은 **단일 Railway 서비스**로 운영된다 (2026-06-16 확정 — 옛 2-서비스 test/prod 정책 폐기).

| 브랜치 | 역할 | 도메인 | Railway 서비스 |
|--------|------|--------|----------------|
| `main` | production | `https://meal.posan.kr` (+ `dinner-posan.up.railway.app`) | `dinner` (watch=main) |

- Railway에는 **환경 `production` 1개 + 앱 서비스 `dinner` 1개**만 존재. **test/staging 서비스도 `posanmeal.up.railway.app` 도메인도 없다.**
- PostgreSQL · Volume(`posanmeal-volumn` → `/app/uploads`, `UPLOAD_DIR` 일치) · 시크릿 모두 이 단일 서비스 귀속. `NEXT_PUBLIC_SITE_URL`·`AUTH_URL` = `https://meal.posan.kr`.
- (이름 비슷한 `posanmeal-volume`(끝 e) 볼륨이 detached로 방치돼 있음 — 정리 대상.)

**Why:**
- 사용자가 별도 test 배포 환경을 더는 사용하지 않기로 함. 검증은 로컬에서 충분.
- `main`만 watch하므로 `feat/*` push로는 아무 배포도 일어나지 않음(브랜치 보관용).

**How to apply:**
1. 개발은 feature 브랜치(`feat/posanmeal-mvp` 등)에서.
2. **로컬 검증이 게이트**: `npm run build` + `npm test` (+ 필요 시 `npm run dev` 수동 확인).
3. `main`으로 fast-forward/머지 → `git push origin main` → `dinner` 서비스가 `meal.posan.kr`에 배포.
4. 배포 후 `railway status` + 사이트 헬스체크(`/` 200 등)로 확인.
5. **마이그레이션은 항상 additive 우선**. `main` push 시 운영 단일 DB에 `prisma migrate deploy` 즉시 적용. destructive(컬럼 drop/rename/기본값 없는 NOT NULL) 금지, 2단계로. Prisma가 전체 컬럼 SELECT하므로 DROP은 스키마 제거 코드 배포 다음 릴리스에서. 위험 변경은 `prisma-migration-guardian` 검수.
6. 라이브 사이트 직접 배포이므로, 사용자에게 영향 큰 변경은 push 전 확인.

CLAUDE.md "브랜치 전략 (2026-06-16 개정)"·"Railway 배포 설정", PROJECT_MAP.md §11이 이 정책으로 정렬됨. 이전 정책(2026-04-29 2-서비스, 2026-04-14 단일 브랜치, 2026-03~04 feat=prod)은 모두 폐기.
