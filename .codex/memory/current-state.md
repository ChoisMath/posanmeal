# 현재 인계 — 2026-09-18

- 현재 작업 경로는 `/Volumes/Chois_SD2/dev/PosanMeal`. 과거 Windows/Google Drive 경로는 활성 경로가 아니다.
- 이관 직전 미커밋 변경: `.claude/PROJECT_MAP.md`, `src/app/check/page.tsx`, `src/app/facecheck/page.tsx`, `src/components/FaceEnroll.tsx`, `src/components/QRScanner.tsx`, `src/lib/checkin-result-style.ts`, `src/lib/human-client.ts`. 새 파일: `src/lib/face-quality.ts`, `src/lib/__tests__/face-quality.test.ts`.
- 최신 Claude 맵은 키오스크 100dvh 화면·4색 결과·QR StrictMode 카메라 경합 처리·얼굴 등록 품질검사를 설명한다. 이관 세션은 이 소스를 수정하거나 동작 검증하지 않았다. 후속 작업에서 diff와 관련 테스트를 확인한다.
- 실제 package.json과 Prisma 스키마를 확인: Next 16.2.1, Prisma 7, 조/중/석식, MealRegistrationMealDate, CheckIn(userId,date,mealKind). next-themes 의존성 없음. CLAUDE.md의 MealPeriod/옛 탭 수/다크모드 설명은 오래됐다.
- 배포 정책 충돌: 6월 문서는 단일 dinner 서비스, 9월 메모리는 dinner-facecheck 추가를 기록. 이번에는 Railway에 접속하지 않았으며 현재 서비스 존재/연결은 미검증이다.
- 모델 ID `gpt-6-astra`는 설치된 Codex 모델 캐시에서 확인. 프로젝트 기본값으로 설정한다. 기존 대화의 모델 전환이나 실제 새 모델 호출 검증과는 별개다.
- 전역 Codex 설정과 Claude 원본/훅/메모리는 변경하지 않았다. Claude 대화 JSONL은 가져오지 않았으며, 프로젝트 지침·주제 메모리·설계 문서로 맥락을 연결한다.
