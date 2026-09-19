# 현재 인계 — 2026-09-19

- 현재 작업 경로는 `/Volumes/Chois_SD2/dev/PosanMeal`. 과거 Windows/Google Drive 경로는 활성 경로가 아니다.
- 9월 18일 이관 당시 미커밋이던 키오스크 중앙 화면·4색 결과·QR StrictMode 카메라 처리·얼굴 등록 품질검사와 Codex 지침은 현재 `main`의 `e037f8f`에 반영됐다. 9월 19일 점검 시작 시 작업 트리는 깨끗했다. 현재 구조 기준은 `.codex/PROJECT_MAP.md`다.
- 9월 19일 승인된 `/facecheck` 확인 후 저장 설계와 얼굴↔QR 복귀 수정을 완료했다. 학생 확인/취소·교사 근무/개인/취소·10초 자동 취소, geometry/연속 3회 매칭, 온라인·로컬 확인 검증, 이전 요청 정리·Human 직렬화를 적용했다. 테스트 284개·브라우저 19개·build 통과; 전체 lint/type 기존 오류와 실기기 정확도 검증은 남아 있다. 미배포. 후속 사용자 요청 범위는 로컬 커밋까지이며 원격 푸시는 제외한다. [완료·검증·다음 단계](2026-09-19-facecheck-confirmation.md)를 먼저 읽으며 [이전 진단](2026-09-19-facecheck-reentry-review.md)은 수정 전 근거다.
- 실제 package.json과 Prisma 스키마를 확인: Next 16.2.1, Prisma 7, 조/중/석식, MealRegistrationMealDate, CheckIn(userId,date,mealKind). next-themes 의존성 없음. CLAUDE.md의 MealPeriod/옛 탭 수/다크모드 설명은 오래됐다.
- 배포 정책 충돌: 6월 문서는 단일 dinner 서비스, 9월 메모리는 dinner-facecheck 추가를 기록. 이번에는 Railway에 접속하지 않았으며 현재 서비스 존재/연결은 미검증이다.
- 모델 ID `gpt-6-astra`는 설치된 Codex 모델 캐시에서 확인. 프로젝트 기본값으로 설정한다. 기존 대화의 모델 전환이나 실제 새 모델 호출 검증과는 별개다.
- 전역 Codex 설정과 Claude 원본/훅/메모리는 변경하지 않았다. Claude 대화 JSONL은 가져오지 않았으며, 프로젝트 지침·주제 메모리·설계 문서로 맥락을 연결한다.
