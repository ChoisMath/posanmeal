# 현재 인계 — 2026-09-19

> 2026-09-20 학년도 명부 최신 상태는 [재개 완료 인계](2026-09-20-academic-year-roster-handoff.md)와 운영 검증 보고서를 먼저 읽는다. 아래 9월 19일 시작·배포 준비 상태는 당시 이력이다.

- 현재 작업 경로는 `/Volumes/Chois_SD2/dev/PosanMeal`. 과거 Windows/Google Drive 경로는 활성 경로가 아니다.
- 9월 18일 이관 당시 미커밋이던 키오스크 중앙 화면·4색 결과·QR StrictMode 카메라 처리·얼굴 등록 품질검사와 Codex 지침은 현재 `main`의 `e037f8f`에 반영됐다. 9월 19일 점검 시작 시 작업 트리는 깨끗했다. 현재 구조 기준은 `.codex/PROJECT_MAP.md`다.
- 9월 19일 승인된 `/facecheck` 확인 후 저장 설계와 얼굴↔QR 복귀 수정을 완료하고 `e64fc6d`에 로컬 커밋했다. 학생 확인/취소·교사 근무/개인/취소·10초 자동 취소, geometry/연속 3회 매칭, 온라인·로컬 확인 검증, 이전 요청 정리·Human 직렬화를 적용했다. 테스트 284개·브라우저 19개·build 통과; 당시 전체 lint/type의 기존 오류를 기록했으며 후속 타입 오류 해결은 아래 뷰포트 인계에 반영했다. 실기기 정확도 검증은 미실행이다. 이 작업 완료 당시에는 로컬 커밋만 요청받아 푸시·배포하지 않았다. 이후 사용자가 origin/main 푸시를 승인했으며 실행 결과는 뷰포트 인계에서 후속 확인한다. [완료·검증·다음 단계](2026-09-19-facecheck-confirmation.md), [이전 진단](2026-09-19-facecheck-reentry-review.md)은 각각 당시 작업·수정 전 근거다.
- 후속 `/check`·`/facecheck` 태블릿 하단 잘림·여백 개선을 완료했고 커밋·푸시 준비 중이다. KioskViewport가 가시 높이를 재측정하고 안내줄·버튼을 축소하며 문구 nowrap·동기화 상세 별도 행을 적용했다. 테스트 284개·브라우저 79개(viewport/QR 결과 52개·확인 흐름/다이얼로그 27개)·build 통과. 변경 TSX lint 오류 0개(기존 img 경고 3개), 당시 타입 검사에서 발생한 TS1501 2개는 테스트 정규식 호환 수정 후 해결했다. 후속 타입·284개 테스트·변경 파일 lint 재검증을 통과했고 Prisma generate·production build 재실행도 통과했다. 사용자 동작 기준은 Chrome이며 실태블릿 Chrome 검증은 미실행이다. 최신 [뷰포트 인계](2026-09-19-kiosk-viewport.md)를 먼저 읽는다.
- 실제 package.json과 Prisma 스키마를 확인: Next 16.2.1, Prisma 7, 조/중/석식, MealRegistrationMealDate, CheckIn(userId,date,mealKind). next-themes 의존성 없음. CLAUDE.md의 MealPeriod/옛 탭 수/다크모드 설명은 오래됐다.
- 배포 정책 충돌: 6월 문서는 단일 dinner 서비스, 9월 메모리는 dinner-facecheck 추가를 기록. 이번에는 Railway에 접속하지 않았으며 현재 서비스 존재/연결은 미검증이다.
- 모델 ID `gpt-6-astra`는 설치된 Codex 모델 캐시에서 확인. 프로젝트 기본값으로 설정한다. 기존 대화의 모델 전환이나 실제 새 모델 호출 검증과는 별개다.
- 전역 Codex 설정과 Claude 원본/훅/메모리는 변경하지 않았다. Claude 대화 JSONL은 가져오지 않았으며, 프로젝트 지침·주제 메모리·설계 문서로 맥락을 연결한다.
