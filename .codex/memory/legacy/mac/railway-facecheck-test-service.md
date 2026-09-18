> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/-Users-chois-Library-CloudStorage-GoogleDrive-complete860127-gmail-com--------projects-posanmeal/memory/railway-facecheck-test-service.md`

---
name: railway-facecheck-test-service
description: feat/facecheck 테스트용 Railway 서비스(dinner-facecheck) 구성과 배포 방법 — main 배포와 분리됨
metadata:
  type: project
---

2026-09-03에 Railway 프로젝트 `posanmeal`(production 환경)에 테스트 전용 리소스를 CLI로 생성했다.

- 앱 서비스 `dinner-facecheck` (id 2b64afe6-9a35-4a8d-81ed-759f75821f65), 도메인 `https://dinner-facecheck-production.up.railway.app`
- DB 서비스 `Postgres-vXG_` (private host `postgres-vxg.railway.internal`), 앱의 `DATABASE_URL`은 `${{Postgres-vXG_.DATABASE_URL}}` 참조
- Volume `dinner-facecheck-volume` → `/app/uploads`
- 변수: `dinner`에서 ADMIN_*, AUTH_GOOGLE_*, NEIS_API_KEY, MAX_FILE_SIZE_MB, QR_TOKEN_EXPIRY_SECONDS, TZ, UPLOAD_DIR 복사. AUTH_SECRET·QR_JWT_SECRET·FACECHECK_KIOSK_KEY는 테스트용으로 새로 생성(운영과 다름). NEXT_PUBLIC_SITE_URL·AUTH_URL은 위 도메인.
- 2026-09-04 사용자가 대시보드에서 GitHub 소스 `ChoisMath/posanmeal` 브랜치 `feat/facecheck`를 연결했다. 이후 `feat/facecheck` push가 자동 배포되며 `railway up`은 불필요(동시 실행 시 CLI 배포가 REMOVED 됨). 빌드/시작 명령은 서비스 설정에 직접 저장됨(`npx prisma generate && npm run build` / `npx prisma migrate deploy && npm start`). 운영 `dinner` 서비스(watch=main)는 건드리지 않았다.

- 2026-09-04 `feat/facecheck`(bb5f5f6)를 main에 fast-forward 머지해 운영(`dinner`, meal.posan.kr)에 배포했다. 운영 `FACECHECK_KIOSK_KEY`는 사용자가 직접 설정. 테스트 서비스는 그대로 두었으며 이후 브랜치 push는 계속 테스트 서비스로만 간다.

- 2026-09-06 `feat/facecheck-insightface`(b7d2348, insightface-emore 모델 교체)를 `feat/facecheck`(테스트, 빌드 약 1.5분)에 이어 `main`에 fast-forward push해 운영 배포. `railway service status --service <svc> --json`으로 BUILDING→DEPLOYING→SUCCESS 폴링(약 1.5분).

**Why:** Railway는 main push만 배포하므로 feat/facecheck를 웹에서 검증하려면 별도 서비스가 필요했고, 사용자가 CLI 생성을 선택했다.
**How to apply:** feat/facecheck 재배포는 브랜치 push로; 테스트 DB는 빈 상태에서 마이그레이션만 적용되므로 사용자 데이터는 관리자 import로 준비. Google OAuth 리디렉션 URI에 이 도메인이 추가되어야 로그인이 된다. 관련: [[railway-cli-quirks]]
