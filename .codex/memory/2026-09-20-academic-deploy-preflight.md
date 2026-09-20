# 학년도 명부 배포 준비 인계 — 2026-09-20

## 승인과 현재 상태

사용자가 “푸쉬하고, 배포해 주세요. 푸쉬와 배포 전에 제가 백업해야 할 자료가 있나요?”라고 요청했다. 이전 구현 인계의 푸시·배포 승인 대기는 이 요청으로 대체됐다. 모든 키오스크의 미전송 0건과 스캔 중지도 사용자에게 확인받았다.

3개 준비 브랜치를 원격에 푸시했고 DB·사진 백업을 확보했다. 실제 로컬 DB 복원과 원본 11개 테이블 보존 비교, 사진 8개 복원·해시 비교, 복원본 A 추가 migration을 통과했다. 다만 사진 참조 6건은 운영 원본에도 파일이 없어 별도 후속 항목으로 남겼다. **전체 공개 준비와 A/B 이전 리허설은 미완료**이며 공고 기준에 대한 사용자 확인 전까지 배포를 보류한다. 실제 A CLI inspect로 귀속 예외를 재현했으며 backfill·검증 stamp·READY·운영 Release A/B 배포는 실행하지 않았다.

현재 운영 서비스가 그대로임을 알리고 키오스크를 재개해도 된다고 사용자에게 안내했다. 실제 현장 재개 여부는 확인하지 않았으며, 다음 배포 시 모든 키오스크의 최신 동기화·미전송 0건·스캔 중지를 다시 확인해야 한다.

## Git과 운영 배포

| 원격 브랜치 | SHA |
| --- | --- |
| `feat/academic-year-roster` 최초 푸시 기준 | `9e704a2e6b6defaa217ae398f2386f88ed3d501d` |
| `release-a/academic-year-roster-hardened` | `c39aa232560b3541aa70e66cc1f9818af318a115` |
| `release-b/academic-year-roster-merged` | `70cc2a8f9baf4b09e8c8566d0e0873978679c82d` |

feature SHA는 최초 푸시의 코드·문서 기준이다. 이 실행 기록을 포함한 후속 문서 커밋·푸시의 최신 SHA는 git log와 원격 ref에서 확인한다. B 병합 후보의 tree는 기존 B와 동일하다고 root가 확인했다. 운영 감시 대상인 `origin/main`은 `68e81d0cc74be47a70e2b4e33fe224444f46f993`를 유지하며 main push는 하지 않았다. 로컬 main 포인터는 별도이므로 운영 배포 SHA로 사용하지 않는다.

Railway posanmeal/production에는 dinner와 Postgres 두 서비스가 있고, dinner는 main을 감시한다. 현재 앱 활성 배포는 `520b1cc1-f673-416f-8046-9ff8cc983b34`, SHA `68e81d0...`다. 시작 명령에 `prisma migrate deploy`가 있으므로 main 변경 전 pending migration 검토와 A/B 순서를 지킨다. 현재 프로젝트에 feature 서비스는 없지만 다른 프로젝트 전체를 조사한 것은 아니다.

정리 후 root가 live Railway를 다시 조회해 같은 deployment/SUCCESS/main SHA가 유지됨을 확인했고 meal.posan.kr의 GET HTTP 200을 확인했다.

## 실제 확보한 백업과 점검

- Railway DB Volume 백업: `3676aa47-7fcb-47ce-ab40-f50a9273c005`, 2026-09-20 09:19:02 KST.
- Railway 사진 Volume 백업: `745582be-3e89-4f2d-8516-867dece5fdd5`, 2026-09-20 09:19:11 KST.
- root가 생성 후 backupList에서 두 새 항목을 확인했다. workflowStatus는 NotAuthorized였으므로 workflow Complete 응답을 확인했다고 쓰지 않는다.
- git 밖 보호 경로: `/Volumes/Chois_SD2/posanmeal-rehearsal/2026-09-academic`, 디렉터리 0700·백업 및 증거 파일 0600. 실행 권한이 필요한 네이티브 도구와 구분한다. custom DB dump 10,626,678 bytes, 사진 tar 94,239 bytes·8개 파일. 비밀값·학생 원본·개별 사진명은 문서에 기록하지 않는다.
- 사진 tar를 보호 경로의 `uploads-restored/`에 복원했고 원격 SHA-256 manifest와 상대 경로·크기·해시 8개 모두 일치했다. 8개 이미지의 decode도 통과했다.
- PostgreSQL 18.6의 별도 로컬 DB `127.0.0.1:55440`에 실제 복원했다. pg_restore exit 0, 1.523초. 원본 11개 legacy table의 v2 fingerprint를 복원본과 대조해 기존 모든 필드·ID 차이 0, public FK 8개 모두 validated를 확인했다.
- DB 사진 참조 14건 중 6건은 파일이 없었다. root가 운영 UPLOAD_DIR와 public/uploads를 읽기 전용으로 재확인해 원본에도 없음을 확인했다. 복원 손실 0·원본 결측 6으로 분리했으며, 초기 사진 결측을 포함한 overall pass=false 보고서는 보존하고 추가 assessment를 남겼다.
- 운영 PostgreSQL 18.6. 앱 DB 대상 `postgres.railway.internal:5432/railway`, UPLOAD_DIR `/app/uploads`와 사진 Volume mount 일치를 root가 확인했다. 접속 사용자·비밀번호·토큰은 기록하지 않는다.
- 운영에 적용된 migration checksum은 저장소와 일치하며 학년도 추가 migration 1건만 pending이다. 운영 migration 실행은 하지 않았다.
- 복원본에서는 검수한 A migration 1건을 prisma migrate deploy로 적용했다(exit 0, 2.829초). 적용 뒤에도 원본 11개 테이블의 기존 모든 필드 v2 hash 차이 0, migration checksum `f9f84e4328cb8e39ab1ec1899ead0834abc6df2886103a71e15a702d59123da6` 일치와 completed를 확인했다.
- 복원본에만 academic_meta marker를 만들고 restoreReportId:null인 inspect 전용 target으로 실제 A CLI inspect를 실행했다(exit 0). APPLICATION_YEAR_UNKNOWN:1, REGISTRATION_WITHOUT_DATES:120, notes MISSING_GENDER:1을 재현했다. 명령 성공은 예외 해결·검증 확정 성공을 뜻하지 않는다.

백업 전 조회에서는 DB에 8월 30일 백업 1건만 있었고 사진 백업은 없었다. 두 Volume의 자동 스케줄은 모두 0개였다. 이번 수동 백업 생성은 자동 백업 일정을 설정한 것이 아니다. 로컬 복원 결과는 위의 실제 실행 증거로 따로 확인했다.

로컬 복원은 공식 서명을 확인한 Postgres.app 사전 빌드 PostgreSQL 18 도구를 사용했다. 실행 도구는 내부 디스크 캐시에 두고 실제 복원 DB는 SD 보호 경로에 분리했다. Homebrew 경로에서 요구한 Xcode 라이선스에 대신 동의하지 않았다. 검증 뒤 로컬 PostgreSQL을 SIGTERM으로 정상 종료했다(session exit 0). 55440 포트 닫힘·ready 파일 제거·data/PG_VERSION 보존을 확인했다.

## 읽기 전용 사전 점검과 미확정 자료

- EMAIL 충돌 0, SEAT 충돌 0, 학번 결측 0, 성별 결측 1.
- APPROVED인데 식사일이 0인 신청 120건이 한 공고에 속한다. 2026년 5월 OPEN 공고 `기말고사 중식희망신청(연장)`이며 공고 날짜도 0이어서 YEAR_UNKNOWN 1건으로 나타났다.
- 과거 OTHER 공고의 정상 흐름인지 조사 중이다. 원본 손상으로 단정하거나 임의로 날짜·학년도·성별을 채우지 않았다. 사용자 확인 질문 2건의 답변이 대기 중이다.
- 기존 사진 결측 6건은 원본 baseline 예외다. 복원 보존 실패가 아니며 후속 처리·인수 방침을 기록할 운영 자료로 남긴다. 공고 귀속 미확정 등으로 전체 공개 준비는 아직 충족하지 않았다.

## 외부 차단 검토와 다음 단계

현재 두 공개 도메인 meal.posan.kr와 dinner-posan.up.railway.app는 targetPort 8080이다. dinner TCP proxy는 0개, 기존 edgeRules는 null이다. 전체 공개 요청을 403으로 막는 임시 Edge Rule의 무쓰기 서버 validation은 통과했다. 아직 적용하지 않았다.

1. 사용자 확인 결과와 과거 OTHER 흐름 조사를 반영해 모호한 자료 처리안을 확정한다.
2. 예외 처리안을 반영한 A copy/verify와 B READY·주요 흐름 리허설을 완료해 보호된 보고서 식별자를 기록한다. 복원본 migration/inspect 성공을 전체 리허설로 대체하지 않으며 예외 해결 전 backfill·READY는 실행하지 않는다.
3. Release A를 먼저 적용해 PREPARING 및 유효 v2 VERIFIED를 확인한다.
4. B 전환은 Edge Rule 적용·두 도메인 차단 확인·구 앱 종료 후 진행한다. 최신 백업과 B 구간 원본 증거를 확보한다.
5. B 최신 준비 검사·READY·모든 앱 캐시 갱신·내부 점검 후 규칙을 원래 null로 복원하고 키오스크를 재동기화·재개한다.

현재 운영 DB 행/스키마, 앱 배포, Edge Rule은 변경하지 않았다. 원본 사진 존재 재확인에 임시 SSH 키를 한 번 추가 사용했으며 총 2개 모두 서버 등록 해제(API true)와 작업 전용 로컬 private/public 키 삭제를 완료했다. 최초 연결 때 OS SSH known-host 항목 1건이 등록됐다. 백업·복원 자료는 위 보호 경로에 유지한다.

## 관련 문서와 작성 범위

- [당일 운영 실행 기록](../../docs/operations/academic-year-deployment-2026-09-20.md)
- [운영 실행안](../../docs/operations/academic-year-migration-runbook.md)
- [구현 검증 보고서](../../docs/operations/academic-year-validation-report.md)
- [이전 구현 인계](2026-09-20-academic-year-roster-handoff.md)

project-memory-keeper 역할 파일의 체크리스트를 직접 적용했다. 이 기록은 root의 실행 보고와 본 담당의 메타데이터 조회를 구분해 작성했다. 문서 담당은 원본 개인정보·`.env`·보호 백업 내용을 열지 않았다. 기존 사용자 변경·legacy·전역 메모리는 보존했고, 색인·runbook·맵 갱신은 root가 맡는다.
