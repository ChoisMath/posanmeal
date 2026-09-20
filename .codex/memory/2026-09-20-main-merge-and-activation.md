# main 통합·운영 DB 이전 인계 — 2026-09-20

## 승인과 현재 상태

사용자가 모든 브랜치의 main 병합·푸시를 요청했고, 학생 안내 페이지·영상 등 미커밋 작업도 검토 후 포함하도록 확정했다. 이어 운영 DB 데이터 이전까지 승인했다. 새 Railway 서비스는 사용자가 없앨 예정이며 이번 작업에서 에이전트가 삭제하지 않는다.

사용자가 `기말고사 중식희망신청(연장)`의 신청 120건은 **날짜 없는 희망조사 기록**이라고 확인했다. 승인 신청 120건을 포함한 전체 125건과 급식일 0건을 보존하고, 해당 공고의 신규 학년도 귀속만 2026으로 채우는 처리를 구현·검증했다. 키오스크는 미전송 0건·스캔 중지를 이번 작업에서 다시 확인받았다.

**main 푸시·앱 배포·운영 DB READY 전환과 공개 서비스 복구를 완료했다.** main `67848d0600d1428b87b2fecf38c4418966e322e4`의 Railway `dinner` 배포가 SUCCESS이며 이전 배포는 REMOVED다. 2026-09-20 10:39:13 KST(01:39:13Z) 운영 결과에서 승인된 백필 622건 VERIFIED와 `RosterControl` READY/version 1을 확인했다. 운영 HTTP 19개 검사와 원본 보존 검증 후 임시 차단을 해제했고, 10:42:29 KST에는 3개 공개 도메인의 정상 복구를 확인했다. 이전 [배포 준비 인계](2026-09-20-academic-deploy-preflight.md)의 사용자 확인 대기와 당시 인프라 상태는 이 기록의 후속 실행 결과로 대체한다.

## Git과 보존 범위

- 학생 안내·영상 제작 도구 등 검토한 기존 미커밋 277개 파일을 작업 루트 `feat/academic-year-roster`의 `93c6d7b`에 커밋했다.
- 통합 전용 checkout은 `/Volumes/Chois_SD2/dev/PosanMeal-main-integration-20260920`이다. 최초 통합 `586c314`, 희망조사 보완 통합 `bcdd163`을 거쳐 main `67848d0600d1428b87b2fecf38c4418966e322e4`를 원격에 푸시했다.
- 이 기록의 기능 배포 기준은 `67848d0`이다. 본 기록을 포함한 후속 문서 커밋 SHA는 현재 Git refs에서 확인한다.
- 원래 로컬 6개·원격 8개 브랜치 tip 전체가 통합 main의 ancestor임을 root가 확인했다. 남은 두 tip `03a151b`·`70cc2a8`을 통합했다. 브랜치를 삭제하거나 강제 푸시하지 않았다.
- `.claude/.project-map-pending.log`의 기존 미커밋 원본은 해시로 보존한다. 생성 산출물 `out/`, 음성, 환경변수, 캐시는 Git 제외를 유지한다.
- 날짜 없는 희망조사 보완은 `07a3449`이며 `bcdd163`에 통합했다. 특정 공고의 승인 원본 해시·건수·전체 신청 ID/상태를 `sourceManifest.dateLessSurveyResolutions`에 보존한다. 최초 backfill apply에만 승인 JSON을 받고 재실행·verify·READY는 저장된 증거를 재검사한다.

## 이번에 실제 실행한 검증

아래 앱·Git·운영 결과는 root와 담당 작업자의 실행 보고를 인계한 것이다. 문서 담당이 동일 명령을 다시 실행한 것은 아니다.

| 범위 | 확인 결과 |
| --- | --- |
| 앱 단위 테스트·가이드 테스트 | 단위 584개, 가이드 4개 통과 |
| 영상 제작 도구 | Node 18개·Python 12개 통과, 자체 lint·type 통과 |
| 스킬 제작 템플릿 | Node 18개·Python 12개 통과 |
| 앱 타입·새 가이드 린트 | 루트 `tsc`와 새 가이드 파일 lint 통과 |
| 격리 main 빌드 | `.env` 없는 통합 checkout에서 Prisma generate·build exit 0, static 41개 |
| 전체 린트 | 기존 3개 파일에서 오류 5개·경고 6개. 해당 3개 파일은 원격 main 대비 변경 없음. 전체 lint 통과로 기록하지 않음 |
| 빌드 경고 | 기존 NFT 경고가 남음 |
| PostgreSQL 통합 테스트 | 최초 418개 통과·2개 timeout. 병렬 `npm ci`와 SD I/O가 겹쳤으며 재실행에서는 전체 420개 통과(33.37초) |

희망조사 보완을 포함한 통합 main `bcdd163`에서 최종 재검증했다: 단위 584개, 실제 PostgreSQL 443개(25파일·38.81초), guide 4개, production build·타입·정적 41개 모두 통과. 후속 `67848d0`은 문서 변경만 추가했다. 변경 파일 ESLint와 독립 SQL/코드 검토도 통과했고 Critical/Important 잔여 지적은 0이다. 원본 변경·무승인·변조 증거·다른 공고·동시 자식 식사 설정 쓰기 2건의 회귀를 포함한다. 브라우저·운영 배포 결과는 별도다. 빌드된 도움말 HTML의 9개 단계와 로컬 WebP 17개 연결도 확인했다.

## 운영 사전 재확인과 백업

- 사전 live Railway 재확인에서 기존 `dinner`는 main `68e81d0`, 새 `posanmeal`은 feature `03a151b`를 실행 중이었다. 두 앱은 같은 DB를 사용한다. 과거 기록의 “feature 서비스 없음”을 현재 상태로 적용하지 않는다. 이후 `dinner` main 배포 결과는 아래 운영 실행 항목을 따른다.
- 사진 Volume은 `dinner`에만 있다. 새 서비스 삭제는 사용자 예정 작업이며 에이전트 실행 사실이 없다.
- 학년도 schema migration은 운영 DB에 이미 적용돼 있었다. 저장소 checksum `f9f84e4328cb8e39ab1ec1899ead0834abc6df2886103a71e15a702d59123da6` 및 활성 migration 17개 checksum 일치를 확인했다. 기존 rolled-back migration 이력 1행도 원본대로 보존했다. 이번 작업이 학년도 schema migration을 신규 실행했다고 기록하지 않는다.
- 사전 운영 DB는 `RosterControl` PREPARING/version 0, `AcademicBackfill` 0건이었고 operations marker가 없었다. 초기 preflight가 기존 rolled-back 이력을 활성 migration으로 세어 중단됐으나 쓰기는 발생하지 않았다. 역사 이력 1행을 원본과 별도 대조하도록 보완한 뒤 활성 17개 checksum 검증을 통과했다.
- 최신 보호 백업·복원은 `/Volumes/Chois_SD2/posanmeal-rehearsal/2026-09-academic/activation-20260920T010519Z`에 있다. 동일 exported snapshot의 custom dump 10,657,185 bytes와 legacy v2 11개 테이블 원본을 확보했다. 새 PG18 `127.0.0.1:55441` 복원 exit 0(1.79초), 11개 hash 일치·FK 19개 validated·migration checksum 일치. 기존 55440 복원본과 합성 55439 DB는 분리했다.
- 이전 백업의 원본 사진 결측 6건은 [배포 준비 인계](2026-09-20-academic-deploy-preflight.md)에 남아 있다. 이번 재확인 결과와 혼동하거나 해결 완료로 표시하지 않는다.

## 후속 복원 리허설

- Railway 새 DB snapshot `c1177f95-5c29-4acd-b640-7da1c70ab9b4`, 사진 snapshot `d8fa2326-1b39-45dd-a4a4-e4b515c8e7de`를 목록에서 확인했다. workflow 완료 응답과는 구분한다.
- dinner 사진 8개는 tar 실제 추출·해시·decode 일치. 새 서비스에는 실제 사진이 없고 public의 빈 파일 1개만 있었다. 임시 SSH 키는 서버 해제 true·로컬 삭제를 확인했다. 원본 사진 참조 14개 중 기존 결측 6개를 그대로 기록했다.
- 실제 복원 보존 보고서: `academic-activation-source-restore-20260920T010519Z`. 이 완료 증거를 복원 target에 사용했다.
- DB 리허설 보고서: `academic-activation-database-rehearsal-20260920T010519Z`. guarded copy 622건→verify inspect/apply→승인 JSON 없는 재실행 inserted 0/증거 동일→READY/VERIFIED 통과(4.6초).
- 모든 apply bundle의 before/after가 원본 v2 11개 테이블과 동일했다. 희망조사 승인 120·전체 125·날짜 0·source hash 보존. User/Record/RosterEntry는 각각 622건.
- 실제 복원 앱 HTTP 점검 보고서: `academic-activation-http-rehearsal-20260920T010519Z`. 관리자 로그인·학생/교사 조회·622명 명부·희망조사 125건·과거 기록·사진 8개를 포함한 23개 검사를 통과했다. 이 점검 전후 원본 11개 테이블 hash도 동일했다. 로컬 학생/교사 세션을 사용했으며 실제 Google OAuth나 물리 키오스크를 검사한 것은 아니다.
- 이 구간은 **별도 로컬 복원본** 실행이다. 운영 결과는 아래 항목과 구분한다.

## main 배포와 운영 DB 전환

- 원격 main `67848d0600d1428b87b2fecf38c4418966e322e4`의 `dinner` 배포 `340a89a6-7794-427c-97e4-aa7f42ad26b1` SUCCESS를 확인했다. 이전 `520b1cc1-f673-416f-8046-9ff8cc983b34` 배포는 REMOVED다.
- 두 서비스의 공개 도메인 3개에 임시 Edge Rule을 적용해 GET·POST가 모두 차단되는지 확인한 뒤 운영 백필을 실행했다. 보호된 점검 요청만 허용했으며 실제 운영 원본·백업·승인 증거를 재대조했다.
- 운영 실행 helper 독립 검토 지적 3개를 보완했다: 모든 3개 도메인의 GET·POST 차단 검증, READY 후 30초 캐시 만료 이후 검증, 승인 JSON이 정확히 1개이며 해당 공고와 일치하는지 확인.
- 2026-09-20 10:39:13 KST의 운영 결과에서 copy 622건→VERIFIED→READY/version 1 완료를 확인했다. User·UserAcademicRecord·RosterEntry가 각각 622건이다.
- 운영 이전 전후 원본 legacy 11개 테이블 hash가 모두 동일하다. 확인한 희망조사 승인 120건·전체 125건·급식일 0건·원본 source hash를 보존하고 신규 `academicYear`만 2026으로 귀속했다. 기존 성별 결측 1건은 null/needsReview로 보존했다.
- 보호 증거는 위 백업 경로의 `production-activation-result.json`, `production-reports/academic-iT4unm`(copy·verify), `production-reports/academic-Ip88NX`(enable)에 있다. 비밀값·원본 개인정보는 Git에 기록하지 않는다.
- 초기 유지보수 검증의 SSL·HTML 응답 판정 실패 때는 Edge Rule을 자동 복원했고 운영 DB 쓰기는 없었다. 이후 실제 차단 성공을 확인한 뒤에만 DB 전환을 실행했다.
- READY enable 이후 50초를 기다리고 운영 관리자 인증 HTTP 점검을 실행했다. 10:39:51 KST 결과의 19개 검사가 모두 통과했다(로그인 302, 조회 200). 622명 명부·희망조사 125건·사진 8개 hash를 확인했으며 보고서는 보호 경로의 `production-http-<epoch>-result.json`이다.
- 10:40:36 KST의 후속 읽기 전용 audit에서도 READY/version 1과 원본 legacy 11개 테이블 hash 동일을 확인했다.
- 두 서비스의 Edge Rule을 원래 `null`로 복구한 API 응답과 live 설정을 확인했다. `public-recovery-result.json`(10:42:29 KST)에서 dinner의 두 도메인 `/help/student`가 모두 HTTP 200과 도움말 내용 일치, 추가 서비스 `/`가 HTTP 200인 상태를 3회 연속 확인했다.
- 최초 공개 점검은 추가 서비스의 HTTP 200 응답에 없는 도움말 문구까지 요구해 실패했다. 추가 서비스 `/`와 새 main 기능을 제공하는 dinner `/help/student`로 점검 대상을 구분한 후 위 검사를 통과했다.
- 작업용 로컬 복원 PostgreSQL의 daemon·postgres PID에 실행 프로세스가 없고 `127.0.0.1:55441`이 닫혀 있음을 확인했다. 정상 종료 신호를 성공적으로 보냈다는 뜻은 아니다. 복원 데이터와 기존 pid/guard 파일은 그대로 보존했으며 증거는 `local-cleanup-verification.json`이다.

## 남은 검증과 사용자 후속 작업

- 물리 키오스크의 재로그인·새로고침·전체 동기화·실제 스캔 재개와 Google OAuth 실사용은 미검증이다. 사용자에게 확인된 서버 전환 범위와 현장 재개 절차를 안내한다.
- 추가 `posanmeal` 서비스 삭제는 사용자가 예정한 별도 작업이다.

## 작성 범위

프로젝트 `AGENTS.md`·`.codex/PROJECT_MAP.md`·메모리 색인·탐색 규칙과 기존 배포 준비 인계를 읽었다. 최초 문서 담당은 당시 루트 브랜치 `feat/academic-year-roster`, HEAD `93c6d7b` 및 기존 변경 상태를 직접 확인했다. 후속 문서 담당은 통합 checkout에서 기록 두 파일만 수정했고, 운영·앱 검증 결과는 root와 담당 작업자의 실행 보고를 인계했다. 변경 대상 `git diff --check`는 오류가 없었고 문서 상대 링크는 색인 21개·본 기록 2개 모두 존재했다. 원본 개인정보·비밀값·보호 백업 내용은 열거나 기록하지 않았고 legacy·전역 메모리·다른 작업자의 변경은 보존했다.

추가 맵 갱신 시 역할 재호출이 런타임 thread limit으로 거절되어 root가 역할 체크리스트를 직접 수행했다. 최초 맵/UI/DB/메모리 역할 검토는 실제 에이전트를 사용했다.
