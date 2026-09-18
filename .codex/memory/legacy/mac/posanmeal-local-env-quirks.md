> 과거 Claude 메모리 사본(2026-09-18 이관). 현재 지침이 아니며 경로·배포 상태·우회 명령은 재검증 필요.
> 원본: `/Users/chois/.claude/projects/-Users-chois-Library-CloudStorage-GoogleDrive-complete860127-gmail-com--------projects-posanmeal/memory/posanmeal-local-env-quirks.md`

---
name: posanmeal-local-env-quirks
description: "이 맥 로컬 환경의 제약 — Docker/.env 없음, 샌드박스에서 vitest·next build 지연, Google Drive 콜드리드, git push postBuffer, next dev 기동 11분, Playwright MCP 가짜 카메라 스모크 테스트 패턴, eslint·tsc 로컬 복사본 우회"
metadata: 
  node_type: memory
  type: project
  originSessionId: ce395fb3-e681-400f-87f3-c0f41f34090f
  modified: 2026-09-07T06:38:29.765Z
---

posanmeal 작업 환경(사용자 맥, 프로젝트가 Google Drive 동기 폴더에 있음)의 제약:

- Docker와 `.env`가 없어 `prisma migrate dev`를 못 돌린다. 마이그레이션 SQL은 수기로 작성하고 `migrate deploy`는 Railway 시작 시 적용된다.
- `vitest run`·`next build`는 샌드박스에서 병리적으로 느려지므로 Bash `dangerouslyDisableSandbox: true`로 실행한다.
- Google Drive 콜드리드 때문에 `meal-stats-excel.test.ts`("A3 = 순번")가 첫 실행에서 타임아웃될 수 있다. 격리 재실행이 통과하면 아티팩트로 판정.
- `public/models/`(≈10MB human 모델) 때문에 push 시 `git -c http.postBuffer=524288000 push`가 필요하다.
- `npm run dev`는 Drive 콜드리드 때문에 "Ready"까지 약 11분 걸린다. 백그라운드로 띄우고 `curl --retry 40 --retry-delay 3 --retry-connrefused --retry-all-errors`로 준비를 기다린다.
- 카메라 페이지(`/facecheck`, `/check`) 스모크 테스트는 Playwright MCP `browser_run_code_unsafe`에서 `page.context().addInitScript`로 `navigator.mediaDevices.getUserMedia`를 `canvas.captureStream()`으로 바꿔치기하면 된다(2026-09-05 검증). 이 맥의 Playwright Chromium은 WebGPU를 지원해 `/facecheck`가 webgpu(≈22ms)로 뜨고, `?backend=webgl`이면 webgl(≈75ms)로 뜬다. 로컬 DB/Auth가 없어 `/api/auth/session` 500은 항상 난다(무시).
- 서브에이전트(project-map-updater 등)는 세션 한도(429)로 중단될 수 있으니, 중단되면 직접 처리한다.

- `eslint`·`tsc`는 Drive 위 `node_modules` 콜드리드 때문에 모듈 하나마다 수 분씩 멈춰 사실상 끝나지 않는다(2026-09-06 확인: 5분에 CPU 0.26초). 우회: 소스·설정만 로컬 디스크로 복사해 거기서 검증한다. `src/generated/prisma`가 같이 복사되므로 `prisma generate`는 불필요. `npm ci` 약 11초, eslint·tsc·vitest 각 2초 안팎.
  ```
  rsync -a src tests prisma prisma.config.ts package.json package-lock.json tsconfig.json eslint.config.mjs next.config.ts postcss.config.mjs vitest.config.ts components.json next-env.d.ts ~/posanmeal-verify/
  cd ~/posanmeal-verify && npm ci --no-audit --no-fund && npx eslint <파일> && npx tsc --noEmit && npx vitest run
  ```
- `tsc --noEmit`에는 손대지 않은 `tests/admin-sheet-import-guide.test.ts`의 es2018 정규식 플래그 오류 2건이 원래 있다(`next build`는 통과).
- macOS에는 `timeout`이 없다. `perl -e 'alarm 20; exec @ARGV' -- <명령>`으로 대체.
- Playwright MCP가 연결 실패할 때는 스크립트로 직접 돌린다(2026-09-07 검증): `import { chromium } from "/Users/chois/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs"`(1.63 alpha)는 headless shell 1243을 찾지만 설치된 건 1228뿐 → `chromium.launch({ executablePath: "~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell" })`로 동작. `~/posanmeal-verify`에서 `next build` 후 `next start -p 3100`(env `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, 더미 `DATABASE_URL`)으로 `/check`·`/facecheck`가 뜨고 SW·모델 캐시도 동작(webgl). 이 조합에서 `context.setOffline(true)`는 `navigator.onLine`을 바꾸지 못하므로 오프라인 검증은 서버 프로세스를 kill해서 한다. 스크립트가 중간에 죽으면 `lsof -ti :3100 | xargs kill`.

**Why:** 세션마다 같은 함정에 시간을 쓰지 않기 위해.
**How to apply:** 빌드/테스트/푸시 명령을 실행하기 전에 위 옵션을 먼저 적용한다. 관련: [[railway-cli-quirks]]
