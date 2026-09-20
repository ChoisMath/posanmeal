# 학년도 명부 구현 재개 인계 — 2026-09-20

후속 push/deploy 승인과 실제 백업·원본 조사 결과는 [배포 준비 인계](2026-09-20-academic-deploy-preflight.md)가 우선한다. 아래 내용은 구현 완료 시점의 기록이며 당시의 미승인·미푸시·원본 미접근 상태를 현재 상태로 적용하지 않는다.

## 현재 상태와 승인 범위

사용자가 중단된 Claude 구현을 이어가도록 요청하고 14a 검토 → 14b 검토 → 14c 검토 → Task15 → 전체 브랜치 검토 순서를 확인했다. 구현 전 인계의 “계획/실행 승인 대기”는 이 요청으로 대체됐다. Task14와 Task15의 코드·합성 회귀·문서·독립 검토는 완료했다. 실제 운영 백업/사진 복사·복원 리허설·배포는 계획 Task15 Step3~7의 별도 실행 승인 대상으로 남았다.

- B 브랜치 `feat/academic-year-roster`, 최종 코드 `7cf4859`. 이후 문서 커밋은 git log에서 확인한다.
- 14a `d63c999`, 14b `672adfd`, 14c `432055e`. 이전 Task13 `7a3f021..f606ac0` 보존.
- Task15 서버 snapshot `25db256`, 신청/보고서 `0e33194`, 최종 동시성·증거·로컬 보존 `7cf4859`.
- A 별도 브랜치 `release-a/academic-year-roster-hardened`, 최종 `c39aa232560b3541aa70e66cc1f9818af318a115`. 기존 A 포인터 `81a4a81`은 보존했다. A 작업 트리는 `.superpowers/release-a-hardened`이며 clean 상태였다.
- push/merge/deploy 없음. main 자동 배포는 활성화되어 있으므로 로컬 검증과 구분한다.

## 구현과 보존 계약

- 학년도별 표·이메일/이용중단/권한·Excel 미리보기/확정·전환 마법사·지난 명부 삭제/기록 정정·월별 확인 필요·체크인 검토·공고 학년도·현재 학급 병기를 구현했다.
- User.id·식사/체크인 원본 보존. 과거 표시는 해당 학년도의 최종 프로필, 현재 학급은 별도 옵션이다. entryless 정정은 삭제된 명부를 재생성하지 않는다.
- 요청 유실은 같은 requestId/body, 409는 재조회. 같은 대상의 동시 재전송도 행 잠금 뒤 receipt를 다시 읽는다. User→Record 잠금 순서 유지.
- entry/year/user 연결과 기존 학생/교사 종류 불변을 저장 전에 검사한다. Excel 미리보기는 RepeatableRead로 읽어 전환 전 초안과 새 control 버전을 섞지 않는다.
- 신청은 공고 잠금 뒤 기간·현재 상태 재검사. 구 신청 Excel의 중복 학번은 추측 매칭하지 않는다. 담임 조회는 운영 학년도 안으로 제한하고 실제 조식/중식 기록은 취소 뒤에도 표시한다.
- fingerprint v2는 NULL/구분자/행 경계를 보존한다. inspect는 읽기 전용, 명시 verify 실패는 VERIFIED 취소, READY는 현재 예외/미러/공고·지원 증거를 재검사한다. 보호 report before를 DB 변경 전에 저장한다.
- Google 로그인은 emailKey/null 키 후보를 같은 정규화 규칙으로 대조한다. 원문 이메일은 유지하고 중복·중단·키 불일치 계정은 거절한다.
- upload 원본/검토/CheckIn 원자성, download 응답과 snapshot 근거의 일관성을 보장한다. 로컬 displayProfile은 발생 연도 사본을 보존한다. 결측은 현재 학급으로 대체하거나 새로운 체크인 차단 조건으로 만들지 않는다.
- 강제 초기화는 내보낸 뒤 추가/변경된 기록·종결 거절을 원자 검사한다. 로그아웃 중 새 기록도 DB 전체를 보존한다. 명시 LUNCH QR 종류를 유지한다.

## 실제 검증

- B 전체 unit 584/59파일, 전용 실제 PG 420/25파일, 별도 guide 4/1파일 통과. 전체 타입·변경 코드 lint(오류 0/경고 4)·diff 통과.
- B `7cf4859` exact archive: generate, unit584, guide4, production build/타입·정적39/39 통과. source blob 489개 대조, 검증 사본의 Tailwind 설정 2곳 외 차이 0.
- A `c39aa23`: unit347/42, 타입·누적 변경15파일 lint, exact archive generate/build·정적37/37 통과. foundation 실제 PG110/7은 부모 `be664c4`에서 통과했고 이후 auth만 변경했다.
- 전체 소스 lint는 기존 3파일 오류5/경고6으로 실패: admin/login의 내부 a, QRGenerator의 effect setState 2·any 1, SignaturePad render ref. 기준68e81d0 대비 세 파일 diff가 없음을 확인했다. 변경 lint 통과와 구분한다.
- 실제 Chromium 14a 14묶음, 14b 36묶음(+DB10/XLSX 학생51·교사3), 14c 40묶음(+DB4/XLSX2). Task15 담임9묶음, 로컬IDB/초기화21개, v4/v5→v6 업그레이드18개 통과. 브라우저·검증 HTTP 서버 종료.
- 외부 OAuth, 실기기 카메라/얼굴 정확도, 운영 네트워크 장애, 실제 운영 자료 복원은 미실행. 합성 테스트 수와 합산하지 않는다.
- 최종 독립 검토: foundation/A, Tasks5~9, 10~11, 12~13, 14로 나누어 수정 후 교차 확인. 검토 범위 Critical/Important 잔여0. 새 역할 실행은 thread limit이어서 일부 map/UI/memory/SQL 역할은 TOML 체크리스트를 직접 적용했다.

## 다음 실행 전에 읽을 문서

- [검증 보고서](../../docs/operations/academic-year-validation-report.md)
- [운영 실행안](../../docs/operations/academic-year-migration-runbook.md)
- [브라우저 점검](../../docs/testing/academic-year-browser-checks.md)
- [승인 계획](../../docs/superpowers/plans/2026-09-19-academic-year-roster.md)

Railway 읽기 전용 확인 당시 dinner/main 배포68e81d0, Postgres와 앱/DB Volume이 있었다. 실제 DB 연결·UPLOAD_DIR·적용 migration checksum은 환경값/원본을 읽지 않아 미확인이다. 실행 직전 다시 확인해야 한다. 복원 후보는 git 밖 로컬55440/앱3102이며 미생성이다. 실제 복원본에서 migration→copy/verify→READY·신청/과거 보고서/온라인·오프라인 리허설까지 통과한 뒤 A/B 운영 진입을 승인받는다.

A의 초기 원본 증거를 B 이후 정상 쓰기에 영구 고정하지 않는다. 정상 B 공개는 A의 유효 v2 VERIFIED를 유지한 최신 enable inspect→apply다. 최초 before를 바꾸거나 B에서 임의 recopy해 A 보존 증명을 대체하지 않는다. enable CLI는 웹 앱 캐시를 직접 지우지 않으므로 외부 차단 중 전체 재시작 또는30초 TTL과 인스턴스별 READY를 확인한다.

## 작업 트리와 검증 자료

별도 guide/video·AGENTS·eslint/tsconfig·공개 도움말·학생/홈/CSS 변경은 기존 미커밋 상태로 보존하고 학년도 커밋에서 제외했다. 맵·메모리의 guide 부분도 보존했다. Claude 원본·pending 로그·전역 사용자 메모리는 변경하지 않았다. 다음 작업에서 `git add -A`로 혼합하지 않는다.

합성 DB는 고정127.0.0.1:55439, 기존 marker guard wrapper만 사용했다. `.env*`·학생 원본·운영 환경변수는 열지 않았다. ignored `.superpowers/sdd/2026-09-19-academic-year-roster/`에 단계별 로그·하니스·스크린샷·XLSX, `.superpowers/task15-*.md`에 상세 교차검토가 있다. 영속 결론은 위 tracked 보고서에 남겼다. 중간 실패 로그를 삭제하거나 실제 미실행을 통과로 기록하지 않는다.
