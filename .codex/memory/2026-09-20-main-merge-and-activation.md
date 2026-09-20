# main 통합·운영 DB 이전 인계 — 2026-09-20

## 승인과 현재 상태

사용자가 모든 브랜치의 main 병합·푸시를 요청했고, 학생 안내 페이지·영상 등 미커밋 작업도 검토 후 포함하도록 확정했다. 이어 운영 DB 데이터 이전까지 승인했다. 새 Railway 서비스는 사용자가 없앨 예정이며 이번 작업에서 에이전트가 삭제하지 않는다.

사용자가 `기말고사 중식희망신청(연장)`의 신청 120건은 **날짜 없는 희망조사 기록**이라고 확인했다. 승인 신청 120건을 포함한 전체 125건과 급식일 0건을 보존하고, 해당 공고의 신규 학년도 귀속만 2026으로 채우는 처리를 구현·검증했다. 키오스크는 미전송 0건·스캔 중지를 이번 작업에서 다시 확인받았다.

**진행 중 기록이다.** 로컬 main 통합과 검증은 진행됐으나 아래 기록 시점에 main 푸시·운영 DB 쓰기·Edge Rule 적용·READY 전환은 아직 실행하지 않았다. 이전 [배포 준비 인계](2026-09-20-academic-deploy-preflight.md)의 사용자 확인 대기와 당시 인프라 상태는 이 기록의 재확인 결과로 대체한다. 최종 결과는 후속 실행 증거로 갱신한다.

## Git과 보존 범위

- 작업 루트 `feat/academic-year-roster`는 `93c6d7b`. 학생 안내·영상 제작 도구 등 검토한 기존 미커밋 277개 파일을 커밋했다.
- 통합 전용 checkout은 `/Volumes/Chois_SD2/dev/PosanMeal-main-integration-20260920`, 로컬 `main`은 `586c314`다.
- 원래 로컬·원격 브랜치 tip 전체가 통합 main의 ancestor임을 root가 확인했다. 남은 두 tip `03a151b`·`70cc2a8`을 통합했으며 이 확인을 원격 main 푸시 완료로 해석하지 않는다.
- `.claude/.project-map-pending.log`의 기존 미커밋 원본은 해시로 보존한다. 생성 산출물 `out/`, 음성, 환경변수, 캐시는 Git 제외를 유지한다.
- 날짜 없는 희망조사 보완은 `07a3449`, 통합 main은 `bcdd163`이다. 특정 공고의 승인 원본 해시·건수·전체 신청 ID/상태를 `sourceManifest.dateLessSurveyResolutions`에 보존한다. 최초 backfill apply에만 승인 JSON을 받고 재실행·verify·READY는 저장된 증거를 재검사한다.

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

희망조사 보완을 포함한 통합 main `bcdd163`에서 최종 재검증했다: 단위 584개, 실제 PostgreSQL 443개(25파일·38.81초), guide 4개, production build·타입·정적 41개 모두 통과. 변경 파일 ESLint와 독립 SQL/코드 검토도 통과했고 Critical/Important 잔여 지적은 0이다. 원본 변경·무승인·변조 증거·다른 공고·동시 자식 식사 설정 쓰기 2건의 회귀를 포함한다. 브라우저·운영 배포 결과는 별도다. 빌드된 도움말 HTML의 9개 단계와 로컬 WebP 17개 연결도 확인했다.

## 운영 재확인과 백업 준비

- live Railway 재확인에서 기존 `dinner`는 main `68e81d0`, 새 `posanmeal`은 feature `03a151b`를 실행 중이었다. 두 앱은 같은 DB를 사용한다. 과거 기록의 “feature 서비스 없음”을 현재 상태로 적용하지 않는다.
- 사진 Volume은 `dinner`에만 있다. 새 서비스 삭제는 사용자 예정 작업이며 에이전트 실행 사실이 없다.
- 학년도 schema migration은 운영 DB에 이미 적용돼 있었다. 저장소 checksum `f9f84e4328cb8e39ab1ec1899ead0834abc6df2886103a71e15a702d59123da6`과 일치함을 담당자가 확인했다. 이번 작업이 해당 migration을 실행했다고 기록하지 않는다.
- 현재 운영 DB는 `RosterControl`의 PREPARING/version 0, `AcademicBackfill` 0건이며 operations marker는 없다. 데이터 백필·검증 확정·READY는 아직 실행하지 않았다.
- 최신 보호 백업·복원은 `/Volumes/Chois_SD2/posanmeal-rehearsal/2026-09-academic/activation-20260920T010519Z`에 있다. 동일 exported snapshot의 custom dump 10,657,185 bytes와 legacy v2 11개 테이블 원본을 확보했다. 새 PG18 `127.0.0.1:55441` 복원 exit 0(1.79초), 11개 hash 일치·FK 19개 validated·migration checksum 일치. 기존 55440 복원본과 합성 55439 DB는 분리했다.
- 이전 백업의 원본 사진 결측 6건은 [배포 준비 인계](2026-09-20-academic-deploy-preflight.md)에 남아 있다. 이번 재확인 결과와 혼동하거나 해결 완료로 표시하지 않는다.

## 후속 복원 리허설

- Railway 새 DB snapshot `c1177f95-5c29-4acd-b640-7da1c70ab9b4`, 사진 snapshot `d8fa2326-1b39-45dd-a4a4-e4b515c8e7de`를 목록에서 확인했다. workflow 완료 응답과는 구분한다.
- dinner 사진 8개는 tar 실제 추출·해시·decode 일치. 새 서비스에는 실제 사진이 없고 public의 빈 파일 1개만 있었다. 임시 SSH 키는 서버 해제 true·로컬 삭제를 확인했다. 원본 사진 참조 14개 중 기존 결측 6개를 그대로 기록했다.
- 실제 복원 보존 보고서: `academic-activation-source-restore-20260920T010519Z`. 이 완료 증거를 복원 target에 사용했다.
- DB 리허설 보고서: `academic-activation-database-rehearsal-20260920T010519Z`. guarded copy 622건→verify inspect/apply→승인 JSON 없는 재실행 inserted 0/증거 동일→READY/VERIFIED 통과(4.6초).
- 모든 apply bundle의 before/after가 원본 v2 11개 테이블과 동일했다. 희망조사 승인 120·전체 125·날짜 0·source hash 보존. User/Record/RosterEntry는 각각 622건.
- 이 구간은 **별도 로컬 복원본** 실행이다. 운영 DB는 여전히 미변경이며 실제 앱 HTTP smoke·운영 전환은 다음 단계다.

## 남은 단계

1. 완료한 코드·원본 보존·DB 리허설을 바탕으로 별도 복원 앱의 HTTP 동작을 확인한다.
2. 최신 운영 상태와 양 앱의 접근 차단·이전 요청 종료를 확인한다.
3. 승인된 범위에서 운영 접근 차단·데이터 이전·READY·앱 배포를 실행하고, 원본 보존과 공개 서비스 복구를 확인한다. 실행 순서와 상세 증거는 운영 실행안 및 담당자의 최신 보고를 따른다.
4. 모든 브랜치 반영을 최종 확인하고 main을 푸시해 원격 SHA와 local HEAD를 대조한다. 배포·DB 전환·키오스크 재동기화/재개 가능 여부까지 실제 확인한 범위만 기록한다.

## 작성 범위

프로젝트 `AGENTS.md`·`.codex/PROJECT_MAP.md`·메모리 색인·탐색 규칙과 기존 배포 준비 인계를 읽었다. 문서 담당은 루트 브랜치 `feat/academic-year-roster`, HEAD `93c6d7b` 및 기존 변경 상태를 직접 확인했다. 수정 범위는 이 새 기록과 `MEMORY.md` 색인뿐이다. 변경 대상 `git diff --check`는 오류가 없었고 문서 상대 링크는 색인 21개·새 기록 2개 모두 존재했다. 원본 개인정보·비밀값·보호 백업 내용은 열거나 기록하지 않았고 legacy·전역 메모리·다른 작업자의 변경은 보존했다.

추가 맵 갱신 시 역할 재호출이 런타임 thread limit으로 거절되어 root가 역할 체크리스트를 직접 수행했다. 최초 맵/UI/DB/메모리 역할 검토는 실제 에이전트를 사용했다.
