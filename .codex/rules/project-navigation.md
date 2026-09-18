# 프로젝트 탐색

1. `.codex/PROJECT_MAP.md`, `.codex/memory/MEMORY.md`를 먼저 읽고 `git status --short`로 기존 변경을 확인한다.
2. 맵의 관련 섹션을 따라 필요한 파일만 읽는다. `rg` / `rg --files`를 우선한다.
3. 자동 탐색 제외: `node_modules/`, `.git/`, `.next/`, 빌드·캐시·coverage, 잠금 파일, `*.log`, `*.tsbuildinfo`, 생성된 Prisma 클라이언트, 정적 바이너리. 의존성 문제나 이력 조사 등 작업상 필요한 경우에만 범위를 제한한다.
4. 예외: 코드 작성 전 `node_modules/next/dist/docs/`의 관련 Next.js 문서는 반드시 확인한다.
5. 루트 `PROJECT_MAP.md`는 2026-04의 과거 맵이다. `.claude/PROJECT_MAP.md`는 이관 원본이다. Codex는 `.codex/PROJECT_MAP.md`만 유지한다.
6. Claude SessionStart/PostToolUse 훅은 이 프로젝트의 Codex 설정에 등록하지 않았다. 매 세션 시작/종료 시 git diff와 untracked 파일을 직접 확인하고 구조 변경 후 project-map-updater를 호출한다. Claude pending 로그는 지우지 않는다.
