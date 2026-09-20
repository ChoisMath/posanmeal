# PosanMeal 인계 색인

2026-09-18 Claude → Codex 이관. 상세 현재 상태는 [현재 인계](current-state.md), 작업 명령은 [시작 안내](../README.md), 구조는 [프로젝트 맵](../PROJECT_MAP.md).

## 활성 작업 기록

- [2026-09-20 관리자 화면 공간·도구 배치 개선](2026-09-20-admin-compact-ui.md): 책갈피 탭·짧은 도구/셀·교사/학년 필터·Excel 모달, 학년도/체크인 검토를 설정으로 이동. 운영 학년도는 숫자만. unit 586·type·변경 TS lint·Prisma generate·격리 production build 41/41·5개 화면 폭 예시 API 브라우저 검증 통과. 실제 Chrome 운영/로컬 Apple SD Gothic Neo 일치, 글꼴 코드 변경 없음. main 반영/푸시 승인 및 사전 검증 완료, 기록 시점 커밋/푸시 전·배포 결과 별도 확인. 전체 lint·실데이터/실제 Excel·DB 변경 미실행.
- [2026-09-20 main 통합·운영 DB 전환 완료](2026-09-20-main-merge-and-activation.md): 로컬 6개·원격 8개 브랜치와 검토한 미커밋 안내/영상을 main `67848d0`에 통합·푸시, Railway dinner 배포 SUCCESS. 운영 백필 622건 VERIFIED·READY/version 1 완료, 기존 11개 테이블 hash 및 날짜 없는 희망조사 승인 120/전체 125건 보존·2026 귀속. unit 584/PG 443/guide 4·type·build 41개, 실제 복원 앱 HTTP 23개·운영 HTTP 19개 검사 통과. 임시 Edge Rule 원복·3개 도메인 공개 복구 확인. 전체 lint 기존 오류 5개·경고 6개, 원본 사진 6개·성별 1건 결측은 보존. 추가 서비스 삭제·물리 키오스크 재개·실제 OAuth는 미실행.
- [2026-09-20 학년도 명부 배포 준비](2026-09-20-academic-deploy-preflight.md): push/deploy 승인, 준비 브랜치 3개 푸시. DB·사진 백업 및 분리 복원, 11개 테이블 원본 비교·사진 8개 해시 일치, 복원본 추가 migration 검증. 당시 날짜 없는 공고·신청 120건 확인 대기와 원본 사진 결측 6건을 기록했다. 이후 사용자 답변·main 통합·운영 재확인은 위 최신 진행 인계를 따른다.
- [2026-09-20 학년도 명부 구현 재개 완료](2026-09-20-academic-year-roster-handoff.md): Task14a/b/c와 Task15 코드·문서·독립 검토 완료. B 코드7cf4859(unit584/PG420/guide4/격리build), A c39aa23(unit347/격리build, foundation PG110). 이후 푸시·배포를 승인받아 준비를 진행했으며 최신 상태는 위 배포 준비 인계를 따른다. 기존 guide/video 변경 보존.
- [2026-09-19 학생 안내 페이지](2026-09-19-student-help-page.md): YouTube `rOww_TPHGR0`을 공개 `/help/student`에 연결하고 로그인·학생 헤더에 새 탭 도움말을 추가했다. 4개 목차·9단계·목업/포스터 WebP 17개(459,294bytes), 영상 구간 재생·이미지 확대 제공. 관련 lint·전체 type·19개 테스트·6개 화면 폭·실제 YouTube 재생·공개 경로 경계 검증 통과. 학생 로그인 상태 실검증·전체 build/test·DB 변경·운영 배포는 미실시. 영상·음성 v4는 변경하지 않았다.
- [2026-09-19 학생 안내 영상 제작](2026-09-19-student-guide-video.md): Qwen3 원음 절단 보정·종결 표현 조정 후 v4 완료(18장면·59문장·11,694프레임·389.824초·35,586,560bytes). 원음 종료와 최종 MP4 파형 59/59, 전체 디코딩·시각 검토·30개 테스트·두 스킬 검증·영상 lint/type 통과. 18챕터·59자막·WebP 19장·faststart 완료, v3는 `out/archive/v3/` 보존. 직접 청취·실기기 설치는 미실시이며 전사 표기 차이 2건은 상세 기록 참조. 앱·DB·배포는 변경하지 않았다.
- [2026-09-19 안내 영상·가이드 페이지 스킬 이관](2026-09-19-guide-page-skills.md): 스킬 15개·미설치 템플릿 이관 및 말끝 후처리 개선 완료. mlx-audio 0.5.3 Qwen3 길이 보정·생성기 해시 캐시·EOF 종료 검사/재시도를 템플릿과 두 스킬에 동기화했다. 제작본/템플릿 테스트 30개·스킬 검증 2개·영상 lint/type 및 v4 최종 파형 59/59 통과. 초기 27개 테스트와 최초 이관 이력은 보존했으며 실제 v4 산출물·남은 청취 검증은 위 기록 참조.
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
