# 학년도 명부 운영 반영 실행 기록 — 2026-09-20

상태: **준비 브랜치 푸시·운영 백업·실제 DB 복원 보존 비교·사진 8개 복원·복원본 A migration 검증 완료. 기존 사진 결측 6건과 공고 귀속 예외는 남아 있으며 전체 A/B 리허설과 공개 준비는 미완료. 사용자 공고 기준 확인 전까지 배포 보류, 운영 앱은 기존 버전 유지.**

이 문서는 당일 실제 실행 기록이다. 절차는 [운영 반영 실행안](academic-year-migration-runbook.md), 코드 검증은 [구현·검증 보고서](academic-year-validation-report.md)를 따른다. 아래 “완료”는 명시한 범위만 뜻하며 백업 목록 확인을 복원 성공이나 운영 배포 성공으로 표현하지 않는다. 상세 원본·접속 비밀·학생별 자료는 git 밖 보호 저장소에만 보관한다.

## 1. 사용자 승인과 현장 확인

- 사용자가 푸시·배포를 요청하고 배포 전 필요한 백업 자료를 물었다. 이에 따라 운영 백업과 복원 준비를 진행했다.
- 모든 키오스크의 미전송 0건과 스캔 중지를 사용자에게 확인받았다.
- 사전 점검에서 확인된 자료의 의미에 관한 질문 2건은 답변 대기 중이다. 아직 답하지 않은 내용을 승인하거나 자료 정정에 동의한 것으로 취급하지 않는다.
- 공고 기준 확인 전 배포를 보류하고, 현재 서비스는 그대로이므로 키오스크를 재개해도 된다고 안내했다. 실제 현장 재개 여부는 미확인이다. 다음 배포에서는 최신 동기화·미전송 0건·스캔 중지를 새로 확인한다.

## 2. 원격 브랜치와 운영 앱

| 대상 | 확정 SHA | 실행 상태 |
| --- | --- | --- |
| `feat/academic-year-roster` 최초 푸시 기준 | `9e704a2e6b6defaa217ae398f2386f88ed3d501d` | 최초 코드·문서 기준 원격 푸시 완료 |
| `release-a/academic-year-roster-hardened` | `c39aa232560b3541aa70e66cc1f9818af318a115` | 원격 푸시 완료 |
| `release-b/academic-year-roster-merged` | `70cc2a8f9baf4b09e8c8566d0e0873978679c82d` | 원격 푸시 완료; 기존 B와 tree 동일 확인 |
| `origin/main` | `68e81d0cc74be47a70e2b4e33fe224444f46f993` | 유지; main push 미실행 |

feature SHA는 최초 푸시의 코드·문서 기준이며, 이 실행 기록을 포함한 후속 문서 커밋·푸시의 최신 SHA는 git log와 원격 ref에서 확인한다. A/B 후보 SHA는 위 값을 유지한다.

원격 준비 브랜치 푸시는 운영 배포와 별개다. dinner의 main 감시 trigger는 남아 있고 실제 resolved start는 `npx prisma migrate deploy && exec node_modules/.bin/next start`다. 따라서 main 변경은 자동 migration을 시작할 수 있다. 학년도 B 전체를 A 단계 대신 바로 배포하지 않는다.

현재 활성 dinner 배포는 `520b1cc1-f673-416f-8046-9ff8cc983b34`, SUCCESS, 위 main SHA이며 생성 시각은 2026-09-19 09:48:59 KST다. 로컬 main 포인터와 운영/원격 main을 혼동하지 않는다.

복원 검증·로컬 서버 정리 뒤 root가 live Railway 활성 배포를 다시 조회해 같은 deployment/SUCCESS/main SHA가 유지됨을 확인했다. meal.posan.kr의 GET도 HTTP 200이었다.

## 3. 현재 운영 대상 확인

| 항목 | 확인값 |
| --- | --- |
| Railway 프로젝트 | posanmeal `23329c90-d129-4229-9a53-e3c655509f5e` |
| 환경 | production `1b0fd7e1-d90d-4584-a918-589c948f7e26` |
| 앱 서비스 | dinner `23d99cf0-b36a-427c-a318-d07755d69582` |
| DB 서비스 | Postgres `adee044e-a286-4854-8f28-bff79ac0843c` |
| PostgreSQL | 18.6 |
| 앱 DB 대상 | `postgres.railway.internal:5432/railway` |
| 사진 저장 | UPLOAD_DIR `/app/uploads`, 앱 Volume mount와 일치 |
| 앱 Volume | posanmeal-volumn `16b3bc86-f3f3-4d58-ad42-c151526ea393` |
| DB Volume | postgres-volume `00bb3e9a-29ed-47b5-8b5d-05c4e6ef0973` |

현재 조회한 프로젝트에는 dinner와 Postgres만 있다. 과거 dinner-facecheck가 다른 프로젝트에도 없다는 뜻은 아니다. DB 연결·UPLOAD_DIR·PostgreSQL 버전은 실행 담당 root가 확인했고, 문서 담당은 비밀값·원본을 열지 않았다.

운영에 적용된 migration들의 checksum은 저장소와 일치한다. `20260919000001_add_academic_year_roster` 1건만 pending이다. 확인만 했으며 운영 스키마에 적용하지 않았다.

## 4. 확보한 백업과 보호 자료

| 자료 | 식별자 또는 크기 | 확인 상태 |
| --- | --- | --- |
| Railway DB Volume 백업 | `3676aa47-7fcb-47ce-ab40-f50a9273c005` | 생성 후 backupList 확인; 2026-09-20 09:19:02 KST |
| Railway 사진 Volume 백업 | `745582be-3e89-4f2d-8516-867dece5fdd5` | 생성 후 backupList 확인; 2026-09-20 09:19:11 KST |
| PostgreSQL custom dump | 10,626,678 bytes | git 밖 보호 경로 확보 |
| 사진 tar | 94,239 bytes, 8개 파일 | git 밖 보호 경로 확보 |

보호 경로는 `/Volumes/Chois_SD2/posanmeal-rehearsal/2026-09-academic`이며 디렉터리 0700·백업 및 증거 파일 0600으로 관리한다. 실행 권한이 필요한 네이티브 도구의 권한과 구분한다. 개별 학생 식별값·사진명·파일 내용·DB URL의 비밀번호·토큰은 이 문서에 기록하지 않는다. 파일별 실제 해시·명령 종료 코드·복원 상세는 보호된 실행 증거에서 관리한다.

사진 tar는 보호 경로의 `uploads-restored/`에 실제 복원했다. 원격 SHA-256 manifest와 로컬 상대 경로·크기·해시를 대조해 8개 모두 일치했고 이미지 decode도 통과했다. 기존 DB 11개 legacy table의 v2 source fingerprint를 원문 값 출력 없이 확보하고 실제 복원본과 비교해 기존 모든 필드·ID의 차이 0을 확인했다.

Railway workflowStatus 조회는 NotAuthorized였다. 따라서 workflow Complete 응답을 확인했다는 표현은 쓰지 않으며, 현재 확보한 플랫폼 증거는 생성 후 백업 목록의 새 ID·시각이다. 백업 목록 확인과 실제 로컬 복원 검증은 별개다.

백업 생성 전에는 DB Volume에 2026-08-30 백업 1건만 있었고 사진 Volume에는 백업이 없었다. 두 Volume 모두 자동 백업 스케줄은 0개였다. 이번 수동 생성으로 자동 일정을 설정한 것은 아니다. 외부 별도 백업과 PITR/WAL 연속 보관 유무는 이 조사로 확정하지 않는다.

## 5. 읽기 전용 데이터 사전 점검

| 점검 | 결과 |
| --- | --- |
| 정규화 이메일 충돌 | 0 |
| 학번/좌석 충돌 | 0 |
| 학번 결측 | 0 |
| 성별 결측 | 1 |
| APPROVED 신청 중 식사일 0건 | 120건, 모두 같은 공고 |
| 학년도 귀속 불명 | YEAR_UNKNOWN 1건 |

120건은 2026년 5월 OPEN 공고 `기말고사 중식희망신청(연장)`에 속한다. 공고 날짜가 0건이어서 날짜 기반 학년도 추론이 불가능하다. 과거 OTHER 신청 흐름에서 정상적으로 만들어진 자료일 가능성을 조사하고 있다. 이 결과만으로 데이터 손상이라고 단정하거나 임의 식사일·학년도·성별을 채우지 않았다.

현재 사용자 확인 질문 2건의 답변을 기다리고 있다. 확인 결과·처리 근거·허용되는 실제 정정 범위가 확정되기 전 예외를 삭제하거나 검증을 우회하지 않는다.

DB의 사진 참조 14건 중 6건은 복원 폴더에 없었다. root가 운영 서버의 UPLOAD_DIR와 public/uploads를 읽기 전용으로 재확인한 결과 원본에도 해당 6개가 없었다. 복원으로 사라진 파일이 아니라 기존 원본 결측이며, 개별 학생이나 경로를 공개하지 않고 보호된 후속 기록으로 보존한다.

## 6. 실제 복원과 이전 리허설

**실제 DB 복원과 원본 보존 비교, 백업에 있던 사진 8개 복원을 통과했다. 기존 원본 결측과 귀속 예외가 남아 전체 Release 공개 준비는 통과하지 않았다.**

별도 로컬 PostgreSQL 18.6 `127.0.0.1:55440`에서 pg_restore가 exit 0, 1.523초로 완료됐다. 원본 11개 테이블의 모든 기존 필드·ID를 v2 fingerprint로 비교하고 FK 검증 상태를 확인했다. 단순 dump 크기나 명령 성공만으로 판단하지 않았다.

| 항목 | 현재 기록 |
| --- | --- |
| 빈 별도 DB로 실제 복원 | PostgreSQL 18.6, pg_restore exit 0, 1.523초 |
| 원본 컬럼·ID·행 보존 비교 | legacy 11개 table의 v2 fingerprint 차이 0 |
| FK 정합성 | public FK 8개 모두 validated |
| 사진 tar 실제 복원·파일 비교 | 상대 경로·크기·SHA-256 8/8 일치, 8개 decode 성공 |
| DB 사진 참조 대조 | 14건 중 8개 복원; 나머지 6개는 운영 원본에도 없음을 재확인 |
| 시험 앱의 사진 표시 | 미실행 |
| 복원본 A 추가 migration | 1건 적용, prisma migrate deploy exit 0, 2.829초 |
| migration 뒤 기존 자료 보존 | 원본 11개 table의 기존 모든 필드 v2 hash 차이 0 |
| 실제 A CLI inspect | exit 0; 귀속/식사일 예외 재현, 검증 확정 아님 |
| 복원본 A backfill·copy/verify | 예외 해결 전 미실행 |
| 예외 처리 후 v2 VERIFIED | 미완료 |
| 복원본 B READY 및 주요 흐름 리허설 | 미완료 |
| 운영 적용용 restoreReportId | 미확정 |

복원은 git 밖 제한된 별도 환경에서 진행하고 합성 회귀 DB `127.0.0.1:55439`에 운영 원본을 섞지 않는다. 실제 태블릿/OAuth 등 미실행 항목은 별도로 표시한다.

복원본에 적용한 migration은 `20260919000001_add_academic_year_roster` 1건이다. checksum `f9f84e4328cb8e39ab1ec1899ead0834abc6df2886103a71e15a702d59123da6` 일치와 completed 상태를 확인했다. 적용 후 기존 11개 테이블의 원본 모든 필드·ID도 보존됐다. 이는 로컬 복원본의 실행 결과이며 운영 스키마는 변경하지 않았다.

로컬 복원본에 academic_meta marker를 생성하고, restoreReportId:null인 inspect 전용 target으로 실제 Release A CLI inspect를 실행했다. 종료코드는 0이지만 결과에 `APPLICATION_YEAR_UNKNOWN:1`, `REGISTRATION_WITHOUT_DATES:120`, notes `MISSING_GENDER:1`이 남았다. 이 명령은 상태 확인만 했으며 backfill apply·verify stamp·READY는 실행하지 않았다. 예외 처리와 A copy/verify, B READY 및 주요 흐름까지 완료해야 전체 리허설을 통과한 것으로 판단한다.

초기 복원 검증 보고서는 사진 결측을 포함해 overall pass=false로 기록됐으며 그대로 보존했다. 후속 원본 재확인 assessment에서 **복원 중 손실 0, 기존 원본 사진 결측 6**으로 원인을 분리했다. 6건은 원본 baseline 예외이며 복원 보존 실패가 아니다. 이 재분류는 초기 보고서를 덮어쓰거나 전체 공개 준비를 통과시킨 것이 아니다. 120건 신청이 속한 공고의 귀속 확인과 기존 사진 결측의 후속 처리·인수 방침을 남겨야 한다.

PostgreSQL 도구는 공식 서명이 확인된 Postgres.app 사전 빌드를 내부 디스크 캐시에서 실행했다. Homebrew가 요구한 Xcode 라이선스에 대신 동의하지 않았다. 실제 원본 복원 DB와 사진은 SD 보호 폴더에 분리했다. 검증 뒤 로컬 PostgreSQL을 SIGTERM으로 정상 종료하고 session exit 0, 55440 포트 닫힘, ready 파일 제거, data/PG_VERSION 보존을 확인했다. 복원 데이터를 삭제하지 않았다.

## 7. B 외부 요청 차단 준비

현재 meal.posan.kr 및 dinner-posan.up.railway.app는 모두 targetPort 8080이다. dinner TCP proxy는 0개이고 기존 edgeRules는 null이다. Railway 공식 Edge Rules의 전체 요청 block 규칙을 무쓰기 validation query로 검증했으며 진단 결과는 빈 배열이었다. **아직 규칙을 적용하지 않았다.**

이 규칙은 서비스의 모든 공개 도메인에서 앱에 도달하기 전 maintenance 403을 반환한다. 도메인 삭제·DNS 변경·앱 환경변수 변경이 필요 없다. B 전환 때에는 적용 직전 기존 규칙을 재확인하고 두 도메인의 고유 maintenance 응답과 구 A 인스턴스 종료를 확인한다. READY·캐시 갱신·내부 점검 후 원래 null로 복원한다. [Railway Edge Rules 공식 문서](https://docs.railway.com/networking/edge-rules)

규칙 반영이 이미 처리 중인 요청을 즉시 모두 종료한다는 보장은 없으므로 이전 앱 종료 확인을 생략하지 않는다. 현장 키오스크 정지와 운영 HTTP 쓰기 차단도 별개의 조건이다.

## 8. 현재 변경 범위와 다음 단계

실행한 외부 변경은 준비 브랜치 3개 푸시, DB·사진 백업 생성, 백업 및 원본 사진 재확인용 임시 SSH 키 등록·해제다. 총 2개 키 모두 서버 등록 해제 API true를 확인했고 작업 전용 로컬 private/public 키도 삭제했다. 최초 연결 시 OS SSH known-host 항목 1건이 등록됐다. 운영 DB 행·스키마, 앱 배포, Edge Rule은 아직 변경하지 않았다. 백업·복원 자료는 보호 경로에 보관한다.

다음 순서는 사용자 확인·자료 의미 조사 → 예외 해결 후 A copy/verify 및 B READY·주요 흐름 리허설 → A 운영 PREPARING/VERIFIED → B HTTP 차단·구 앱 종료·최신 백업 → B 배포/READY/캐시 확인 → 차단 해제·키오스크 재동기화/재개다. 예외 해결 전 backfill·READY를 실행하지 않는다. 복원본 migration/inspect 성공이나 합성 테스트로 나머지 실제 리허설을 대신하지 않는다.

문서 작성자는 project-memory-keeper 역할 체크리스트를 직접 적용했다. root의 실행 보고, 본 담당의 메타데이터 조회, 미실행 계획을 구분했다. 기존 runbook·맵·메모리 색인·제품 파일·다른 작업자의 변경은 수정하지 않았다.
