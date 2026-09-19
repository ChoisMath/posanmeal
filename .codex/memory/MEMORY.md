# PosanMeal 인계 색인

2026-09-18 Claude → Codex 이관. 상세 현재 상태는 [현재 인계](current-state.md), 작업 명령은 [시작 안내](../README.md), 구조는 [프로젝트 맵](../PROJECT_MAP.md).

## 활성 작업 기록

- [2026-09-20 학년도 명부 구현 재개 완료](2026-09-20-academic-year-roster-handoff.md): Task14a/b/c와 Task15 코드·문서·독립 검토 완료. B 코드7cf4859(unit584/PG420/guide4/격리build), A c39aa23(unit347/격리build, foundation PG110). 실제 복원·운영 반영은 계획의 별도 승인 대상으로 미실행. 기존 guide/video 변경 보존.
- [2026-09-19 학년도별 학생·교사 명부 요구사항](2026-09-19-academic-year-roster-requirements.md): User.id·최종 학급 보존·명부 삭제·계정 중단·Excel·명시 전환에 대한 승인 설계와 계획의 당시 기록. 이후 구현 재개 승인을 받아 완료했으며 최신 검증·다음 단계는 위 2026-09-20 인계를 따른다.
- [2026-09-19 키오스크 가시 높이·하단 여백 개선](2026-09-19-kiosk-viewport.md): 공용 KioskViewport·가시 높이 재측정, 안내/버튼 축소, 문구 nowrap·동기화 상세 별도 행. 테스트 284개·브라우저 79개(viewport/QR 결과 52개·확인 흐름/다이얼로그 27개)·build 통과. 당시 TS1501은 테스트 정규식 호환 수정으로 해결했고 타입·테스트·변경 파일 lint·Prisma generate·build 재검증 통과. 사용자 기준은 Chrome이고 실태블릿 Chrome 검증은 미실행. origin/main 푸시는 승인됐으며 실행 결과는 후속 확인.
- [2026-09-19 얼굴 확인 후 저장·모드 복귀 수정](2026-09-19-facecheck-confirmation.md): 학생/교사 명시적 확인·10초 자동 취소, geometry/연속 3회 매칭, 온라인·로컬 저장 가드, 이전 요청 정리·Human 직렬화 완료. 테스트 284개·브라우저 19개·build 통과; 당시 전체 lint/type의 기존 오류를 기록했고 후속 타입 오류 해결은 위 뷰포트 인계 참조. 실기기 검증은 미실행. 로컬 커밋 `e64fc6d` 완료. 당시에는 미푸시였으며 최신 푸시 승인·진행 상태는 위 뷰포트 인계 참조.
- [2026-09-19 얼굴 → QR → 얼굴 복귀 점검](2026-09-19-facecheck-reentry-review.md): 수정 전 busy 잔존·Human 추론 중첩 진단과 재현 근거. 후속 수정은 위 완료 기록 참조.

## 관련 작업 때만 읽을 과거 자료

- [얼굴 모델 선택·사용자 결정](legacy/mac/facecheck-embedding-model-decision.md): FaceRes 폐기 근거, 2D 웹캠/threshold 0.55 운영 결정. 실제 설정은 코드 및 DB 설정과 구분한다.
- [Prisma unique DDL 함정](legacy/windows/feedback_prisma_unique_ddl.md): INDEX와 CONSTRAINT 구분. 실제 기존 마이그레이션을 확인한다.
- [누적 기능 구현 이력](legacy/windows/posanmeal_project_state.md), [조식 분리 이력](legacy/windows/project_breakfast_split_2026_05_02.md).
- [9월 테스트 서비스 기록](legacy/mac/railway-facecheck-test-service.md), [6월 브랜치 정책](legacy/windows/feedback_branch_workflow.md): 서로 시점이 다르므로 현재 인프라로 단정하지 않는다.
- [이전 Drive 환경 문제](legacy/mac/posanmeal-local-env-quirks.md), [당시 Railway CLI 문제](legacy/mac/railway-cli-quirks.md): 현재 외장 볼륨 경로/CLI에서는 재현 여부부터 확인. 옛 권한 우회 옵션을 복사 실행하지 않는다.

legacy는 역사적 사본으로 유지한다. 새 결정·검증은 current-state 또는 별도 주제 파일에 기록하고 이 색인에 연결한다. 비밀값과 학생 개인정보를 기록하지 않는다.
