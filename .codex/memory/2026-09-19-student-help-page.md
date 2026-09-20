# 2026-09-19 학생 안내 페이지

사용자가 제공한 [YouTube 영상](https://youtu.be/rOww_TPHGR0)을 연결한 공개 학생 안내 페이지 구현·로컬 검증을 완료했다. 운영 배포는 하지 않았으며 배포 후 주소는 `https://meal.posan.kr/help/student`이다. 앞선 [학생 안내 영상 v4 제작](2026-09-19-student-guide-video.md)과 별도 후속 작업이며 이번에는 영상·음성을 수정하지 않았다.

## 완료한 변경

- `src/app/help/student/page.tsx`에 공개 안내 페이지를 추가했다. `/help`는 `/help/student`로 리다이렉트하고, `src/lib/public-paths.ts`는 `/help`와 그 하위 경로만 공개한다. 로그인 화면·학생 헤더의 공용 `HelpButton`은 안내를 새 탭으로 열어 기존 화면을 유지한다.
- `src/app/help/student/content.ts`에 영상 ID `rOww_TPHGR0`, URL, 4개 목차·9단계 설명·영상 시작 시각·목업 정보를 모았다. 목차는 접속과 로그인, 식단과 급식 신청, QR과 얼굴 체크인, 식사 기록 확인이다.
- 주소 강조 직후 Android Chrome·iPhone Safari 설치 절차를 안내한다. 등록된 Google 계정과 잘못된 계정 복구, 기본 탭, 신청 공고·선택·서명·제출·수정·취소, 고정 QR 보안과 담임 인쇄 요청, 선택적 얼굴 동의·베타 기능·본인 확인, 식사 기록의 도용·누락 확인, `?` 도움말 재방문을 포함했다.
- `GuideVideo`는 클릭 후 `youtube-nocookie.com` iframe을 로드하며 목차별 시작 시각과 YouTube 직접 보기 링크를 제공한다. `GuideGallery`는 가로 스크롤과 원본 이미지 새 탭 확대를 제공한다. 페이지에는 metadata·공유용 표지와 확대 허용 viewport(`maximumScale: 5`)를 적용했다.
- 영상과 같은 Remotion 목업을 `public/guide/student/`에 재사용했다. 본문 16장·영상 포스터 1장으로 WebP 총 17개, 459,294bytes다. 원본 제작 폴더의 19장은 보존했다.
- `.codex/GUIDE_PAGES.md`, `.codex/PROJECT_MAP.md`, `demo-video/README.md`, `docs/video/student-guide-storyboard.md`에 실제 페이지 구현 상태를 반영했다. 과거 영상 제작 당시 `/help` 미구현 기록은 당시 이력으로 보존한다.

## 실제 검증

주 작업자와 관련 검토 에이전트가 실행한 결과를 인계받아 기록했다.

- 변경 대상 ESLint, 전체 `npx tsc --noEmit`, `npx vitest run src/lib/__tests__/academic-access.test.ts` 통과(19/19). `git diff --check` 통과.
- Playwright 익명 접근: `/help` 307 → `/help/student`, 안내 본문 200. `/helpful`, `/helper`, `/api/help`, `/student`, `/api/users/me`는 기존처럼 307 → `/`로 보호된다. 가이드 WebP 17개 모두 HTTP 200·`image/webp`다.
- 화면 폭 320·375·640·768·1024·1280px에서 페이지 가로 넘침이 없고 새 주요 버튼의 최소 클릭 영역 44px를 확인했다. 반응형 정적 검토에서 차단할 문제는 발견하지 못했다.
- YouTube 실제 재생 제목 `PosanMeal - 학생 사용안내`, 길이 389.841초를 확인했다. 화면 안의 영상에서 `currentTime` 증가·`paused=false`·`readyState=4`를 확인했고 QR 목차의 `start=224`를 검증했다.
- 로그인 화면 도움말 클릭 시 새 탭으로 열리고 기존 로그인 화면이 유지된다. 목차 앵커 이동, 갤러리 가로 스크롤, 원본 이미지 새 탭 열기를 확인했다. 본문 이미지 16개 경로·실제 크기와 9단계 영상 시각을 검토했다.
- 키보드 첫 Tab으로 `안내 본문으로 건너뛰기`에 포커스하고 Enter로 `#guide-content`의 실제 main에 포커스가 이동하는 것을 확인했다. 앱 콘솔 오류는 없고 기존 폰트 preload 미사용 경고는 남아 있다.
- 스크린샷: `.playwright-mcp/help-375.png`, `help-1280.png`, `help-install-375.png`, `help-history-1280.png`. 첫 375px 캡처에는 당시 개발 서버 오류 배지가 포함됐으나 아래 임시 환경 설정 후 새 브라우저에서는 오류가 없었다.
- 로컬 개발 서버의 `MissingSecret`은 해당 프로세스에만 임의의 임시 `AUTH_SECRET`과 `AUTH_TRUST_HOST`를 설정해 해소했다. `.env` 파일이나 운영 설정은 변경하지 않았다. 검증 서버 주소는 `http://127.0.0.1:3100/help/student`이며 후속 세션에서는 실행 여부를 확인한다.

## 미실시·다음 단계

- 실제 학생 로그인 상태에서 헤더 버튼을 누르는 브라우저 검증은 하지 않았다. 같은 공용 버튼을 로그인 화면에서 검증했고 학생 헤더는 정적 검토했다.
- 전체 앱 build·전체 테스트, DB 변경, 운영 배포는 하지 않았다. 별도 운영 배포 작업 때 프로젝트 배포 규칙에 따라 build·test 및 배포 후 공개 페이지·학생 도움말 진입을 확인한다.
- 이번 기록은 브라우저 재생 동작을 검증한 것이며 영상 전체 직접 청취나 실제 Android·iPhone 설치 검증을 완료했다는 뜻이 아니다. 해당 미완료 항목은 영상 v4 기록을 따른다.
- 동시 진행 중인 학년도 명부 변경, 기존 미커밋 작업, legacy 원본과 사용자 전역 메모리는 보존했다.
