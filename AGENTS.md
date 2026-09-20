# PosanMeal — Codex 작업 지침

포산고등학교 조식·중식·석식 신청, QR/얼굴 체크인, 관리자·담임 업무 웹앱. 한국어로 간결하게 답한다. 날짜·식사 판정은 Asia/Seoul(KST) 기준이다.

## 세션 시작

1. `.codex/PROJECT_MAP.md`로 구조를 파악한다.
2. `.codex/memory/MEMORY.md`에서 인계 상태와 관련 주제만 읽는다.
3. `.codex/rules/project-navigation.md`를 읽고 `git status --short`로 기존 작업을 확인한다. 사용자의 미커밋 변경을 덮어쓰거나 되돌리지 않는다.
4. 코드 변경 시 `.codex/rules/coding-style.md`, `.codex/rules/nextjs-prisma.md`; UI는 `.codex/rules/responsive-ui.md`; 배포/Volume은 `.codex/rules/railway-stack.md`를 추가로 읽는다.

경로는 모두 프로젝트 루트 기준. Codex가 자동으로 주입하는 진입 문서는 이 파일이다. 참조 문서는 필요 시 직접 읽는다. Claude의 `@파일` 표기나 훅 실행에 의존하지 않는다. 이 프로젝트는 전역 지침의 `.Codex/` 대신 소문자 `.codex/`를 사용한다(대소문자 구별 파일시스템에서도 동일).

## 현재 기준과 과거 기록

- 현재 구조는 코드·설정과 `.codex/PROJECT_MAP.md`를 대조한다. `CLAUDE.md`, 루트 `PROJECT_MAP.md`, `.codex/memory/legacy/`는 보존한 과거 자료다. 오래된 탭 수·MealPeriod·석식 전용 설명을 현재 구현에 적용하지 않는다.
- 기존 specs/plans는 `docs/superpowers/`에서 재사용한다. 계획의 체크 표시만으로 구현/검증 완료를 단정하지 않는다.
- 원본 Claude 설정·전역 사용자 설정은 보존한다. 새 세션 기록은 프로젝트 `.codex/memory/`에만 작성하고 사용자 전역 메모리는 별도 명시 요청 없이 변경하지 않는다.

## 기본 명령

| 목적 | 명령 |
|---|---|
| 의존성 설치(필요 시) | `npm ci` |
| Prisma 클라이언트 생성 | `npx prisma generate` |
| 개발 서버 | `npm run dev` |
| 단위 테스트 | `npm test` |
| 관련 테스트 | `npx vitest run <test-file>` |
| 린트 | `npm run lint` |
| 타입 확인 | `npx tsc --noEmit` |
| 배포 전 로컬 빌드 | `npx prisma generate && npm run build` |
| 로컬 PostgreSQL(필요 시) | `docker compose up -d` |

`.env.example`은 변수 이름 안내다. 실제 비밀값은 복사·출력하지 않는다. Prisma CLI는 `prisma.config.ts`의 dotenv 설정을 사용한다. `migrate dev`, `db seed`는 DB를 변경하므로 일반 설치/검증 과정에 자동 포함하지 않는다. 로컬 전용 DB인지 확인 후 해당 작업 범위에서 실행한다.

## 보존할 설계

- Next.js 16 / React 19 / Tailwind 4 / Prisma 7 + pg adapter / Auth.js v5. `src/proxy.ts` 사용.
- 학생 자격: APPROVED 신청의 `MealRegistrationMealDate`; 체크인 고유키: userId + date + mealKind.
- Prisma 공용 인스턴스와 식사·QR·동기화 유틸을 재사용한다. 새 파일 작성 전에 기존 유틸을 확인한다.
- 얼굴 임베딩 insightface-mobilenet-emore 256차원과 등록/인식 전처리 일관성을 유지한다. 모델 변경 시 FACE_MODEL_VERSION 및 재등록·서버 캐시·로컬 동기화를 함께 검토한다.
- 키오스크 온라인/로컬 판정, IndexedDB, Service Worker 캐시와 QR 폴백을 함께 고려한다. 성능 개선 목적으로 임베딩 모델/입력을 임의 변경하지 않는다.
- 운영 연결 및 배포 정책은 과거 기록 간 충돌이 있으므로 `.codex/rules/railway-stack.md`를 따른다.

## 안내 영상·가이드 페이지 스킬

- 프로젝트 스킬은 `.agents/skills/`에 있다. 안내 영상·목업 기반 도움말 요청 시 `guide-page/SKILL.md`와 `.codex/GUIDE_PAGES.md`를 읽는다. 호출 예: `$guide-page 학생 급식 신청 안내 영상과 가이드 페이지를 만들어줘`.
- Remotion API는 `remotion-best-practices`, 모션은 `remotion-motion-graphics`, 사용자 목소리 내레이션은 `mlx-voice-clone`을 사용한다. 음성 패키지는 `mlx-audio==0.5.3`이다.
- 영상·가이드 이미지는 같은 Remotion 장면을 사용한다. UI 목업에는 그레인·비네트·색 보정·Ken Burns를 적용하지 않는다.
- `guide-page/assets/demo-video/`는 미설치 제작 템플릿이다. 실제 제작 요청 때 루트 `demo-video/`로 복사·설치한다. 스킬 설치만으로 앱에 `/help`나 안내 영상이 구현된 것은 아니다.

## 작업 마무리와 역할

`.codex/config.toml`에 등록된 역할을 해당 조건에서 사용한다. 지원하지 않는 실행 환경에서는 같은 역할 파일의 체크리스트를 직접 수행하고 그 사실을 알린다.

- 구조·API·모델·주요 파일 추가/삭제 후: `project-map-updater` → `.codex/PROJECT_MAP.md`.
- UI/스타일 변경 후: `responsive-ui-reviewer` → 변경 파일 검토.
- Prisma 스키마 변경 후 migrate 실행 전: `prisma-migration-guardian`.
- Railway/환경변수/Volume 작업: `railway-deploy-advisor`.
- 중요 작업 종료 시: `project-memory-keeper` → `.codex/memory/`에 결정·검증·미완료 작업 기록.

검증은 변경 범위에 맞게 수행한다. 문서/에이전트 설정만 변경한 경우 경로·TOML·Codex 지침 로드를 검증하며 앱 빌드나 DB 변경은 필요 없다. 코드 변경은 관련 테스트·린트·타입 검사를, 배포 준비는 build + test를 수행한다. 실행하지 않은 검증은 통과했다고 기록하지 않는다.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
