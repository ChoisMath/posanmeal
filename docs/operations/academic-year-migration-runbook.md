# 학년도 명부 운영 반영 실행안

작성일: 2026-09-20. 기준 브랜치: `feat/academic-year-roster`.

이 문서는 구현·합성 데이터 검증과 실제 운영 적용을 구분한다. 작성 뒤 사용자가 push/deploy를 승인했고 백업·분리 복원 준비를 시작했다. 최신 실행 결과와 중단 조건은 [2026-09-20 운영 기록](academic-year-deployment-2026-09-20.md)이 우선한다. 아래 최초 조사·후보·명령 예시는 실제 완료 기록으로 해석하지 않는다. 운영 적용은 [승인된 계획 Task 15](../superpowers/plans/2026-09-19-academic-year-roster.md)의 Step 3~7 순서를 따른다.

## 1. 완료 판단과 실행 책임

실제 코드 검증은 [검증 보고서](academic-year-validation-report.md), UI 조작은 [브라우저 점검](../testing/academic-year-browser-checks.md)에 기록한다. 단위·통합 테스트 통과를 실제 학생 자료의 복원 성공으로 표현하지 않는다.

운영 승인자는 서비스·DB·Volume·Release별 SHA와 유지보수 시간을 승인한다. 실행 담당자는 접근 제한된 백업·manifest·복원 보고서와 명령 종료 코드를 보관한다. 학교 현장 담당자는 모든 키오스크의 미전송 0건, 일시 중지, 재동기화와 재개를 확인한다. 담당자 이름과 예정 시각은 실행 승인 기록에 기입한다.

## 2. 읽기 전용 확인 결과

2026-09-19 23:29 KST에 Railway 배포 담당 역할이 CLI·읽기 전용 GraphQL 메타데이터로 확인했다. 실행 직전에 다시 대조해야 한다.

| 대상 | 확인값 |
| --- | --- |
| 프로젝트 | `posanmeal` / `23329c90-d129-4229-9a53-e3c655509f5e` |
| 환경 | `production` / `1b0fd7e1-d90d-4584-a918-589c948f7e26` |
| 앱 | `dinner` / `23d99cf0-b36a-427c-a318-d07755d69582` |
| 도메인 | `meal.posan.kr` |
| 활성 앱 배포 | `520b1cc1-f673-416f-8046-9ff8cc983b34`, SUCCESS |
| 배포 SHA | `68e81d0cc74be47a70e2b4e33fe224444f46f993` / `main` |
| 자동 배포 | `main` 감시 활성화. merge/push가 자동 migration을 시작할 수 있음 |
| 조회된 DB 서비스 | `Postgres` / `adee044e-a286-4854-8f28-bff79ac0843c` |
| 앱 Volume | `posanmeal-volumn` / `16b3bc86-f3f3-4d58-ad42-c151526ea393`, `/app/uploads` |
| DB Volume | `postgres-volume` / `00bb3e9a-29ed-47b5-8b5d-05c4e6ef0973`, `/var/lib/postgresql/data` |
| 실제 배포 build | `npx prisma generate && npm run build` |
| 실제 배포 start | `npx prisma migrate deploy && exec node_modules/.bin/next start` |

현재 조회한 프로젝트에는 `dinner`, `Postgres` 두 서비스가 있다. 과거 기록의 `dinner-facecheck`가 다른 프로젝트에도 없다는 뜻은 아니다. 서비스 설정의 `migrate deploy && npm start`와 실제 배포에 해석된 위 명령은 구분했다.

환경변수·`.env`·학생 원본을 열지 않았으므로 다음은 **미확인**이다.

- 앱의 실제 DB host/database/user와 위 Postgres 연결 관계, 운영 marker.
- 운영 `UPLOAD_DIR`와 `/app/uploads` 일치, 사진 파일 존재·해시·복원 가능성.
- 운영 `_prisma_migrations` 적용 목록·checksum, 실제 스키마 drift.
- 실제 복원 대상·백업/사진 사본·OAuth 시험 설정·복원 보고서.

## 3. 제안하는 분리 복원 대상

우선 별도 Railway 서비스 비용을 만들지 않는 **로컬 복원 리허설**을 제안한다. 아래 대상은 미생성 후보이며 사용 승인·기존 점유 확인 전에는 생성하지 않는다.

| 용도 | 후보와 분리 조건 |
| --- | --- |
| 전용 디렉터리 | `/Volumes/Chois_SD2/posanmeal-rehearsal/2026-09-academic/`, git 밖, 디렉터리 0700·파일 0600 |
| 복원 PostgreSQL | `127.0.0.1:55440`, DB `posanmeal_academic_restore`, 소유 계정 `posanmeal_restore_owner` |
| 식별 marker | `academic_meta.academic_identity`의 `academic-restore-20260920`; 승인 담당자가 빈 대상 확인 뒤 생성 |
| 사진 복사본 | 위 전용 디렉터리의 `uploads/`; 원본 Volume을 직접 mount하지 않음 |
| 시험 앱 | `.env` 없는 별도 checkout, `127.0.0.1:3102`, 복원 DB와 사진 사본만 연결 |
| 시험 인증 | 외부 공개 없이 시험용 계정·별도 세션/키오스크 키. Google 검증 시 별도 시험 OAuth client/callback을 승인 |

합성 테스트 DB `127.0.0.1:55439`에는 실제 원본을 복원하지 않는다. 시험 앱에 운영 쓰기 계정·운영 사진 Volume을 연결하지 않는다. 실제 태블릿 접근이 필요하면 별도 사설 연결 또는 Railway 시험 환경의 접근 통제·비용·보관 기간을 추가 승인한다. 새 Railway 대상 후보는 `academic-roster-rehearsal` 환경, `posanmeal-academic-rehearsal` 앱, `posanmeal-academic-restore` DB, `academic-rehearsal-uploads` Volume이다. 생성·가격 조회·과금은 실행하지 않았다.

## 4. DB·사진 백업과 실제 복원

운영자가 확인한 제한된 libpq service 파일로 접속한다. 비밀번호·URL을 shell 인자·로그·문서·git에 남기지 않는다. 아래는 승인 뒤 실행할 명령 형식이며 이번 작업의 실행 결과가 아니다.

```sh
pg_dump --format=custom --dbname=service=posanmeal-source --file="$ACADEMIC_BACKUP_FILE"
pg_restore --exit-on-error --no-owner --dbname=service=posanmeal-restore "$ACADEMIC_BACKUP_FILE"
```

`posanmeal-source`는 승인된 원본의 읽기 전용 백업 계정, `posanmeal-restore`는 확인한 빈 복원 DB다. 복원 파일 식별자·SHA-256·생성 시각·원본/대상 식별 정보를 제한된 보고서에 기록한다. 사진은 별도 스냅샷/복사본을 만들고 상대 파일명·크기·해시 manifest를 보호된 위치에 저장한다. DB의 photoUrl 참조와 복원 파일을 대조하고 시험 앱에서 실제 표시까지 확인한다.

복원 성공은 `pg_restore` 종료 0만으로 확정하지 않는다. 원본의 모든 기존 컬럼·PK/FK 관계·식사 신청/확정일·체크인·사진·얼굴 등록 자료가 복원됐는지 비교한다. 얼굴 원본 이미지를 새로 수집하지 않는다. 비식별 시험 fixture 결과와 운영 복원본 결과를 분리 보관한다.

### 복원본 이전 리허설 통과 조건

운영 Release A/B에 진입하기 전에 실제 복원본에서 다음을 실행하고 보호된 복원 보고서에 기록한다. 합성 테스트나 복원 파일 적재 성공만으로 이 조건을 충족하지 않는다.

1. 복원본의 원본 manifest·PK/FK·사진 검증을 마치고 검토한 pending migration만 추가 적용한다. 잠금/실행 시간과 오류 종료를 기록한다.
2. A 후보의 inspect → copy/apply → 원본 비교 → 예외 확인·해결 → VERIFIED를 검증한다. 기존 쓰기·호환 미러·재로그인도 확인한다.
3. 같은 copy 재실행·중간 중단 후 재개·실패 stamp 취소·증거 보존을 확인한다. 출처 불명인 귀속이나 비교 실패를 우회하지 않는다.
4. B 후보의 최신 준비 상태 검사 → READY → 학년도 전환·삭제 후 과거 보고서·신청·온라인 QR/얼굴 확인 후 저장·오프라인 체크인과 늦은 업로드를 검증한다. 원본과 각 사건 수가 보존되고 삭제한 명부가 재생성되지 않아야 한다.
5. 시험 앱은 복원 DB·사진 사본에만 연결한다. 실제 태블릿·시험 인증 등 미실행 항목과 현장 확인 책임을 별도 기록한다. 리허설에서 발견한 예외를 해결하고 다시 확인한 보고서 ID를 운영 apply에 사용한다.

## 5. SQL 적용 전 점검

정적 검수 파일: `prisma/migrations/20260919000001_add_academic_year_roster/migration.sql` 257줄. 검수한 SHA-256은 `f9f84e4328cb8e39ab1ec1899ead0834abc6df2886103a71e15a702d59123da6`이다. 실제 파일이 달라지면 재검수한다.

- 학년도 SQL은 추가형이다. 기존 User.id·식사 행·체크인 행을 삭제하거나 기존 컬럼을 덮어쓰지 않는다. 신규 emailKey는 nullable이며 초기 귀속 예외를 자동 병합하지 않는다.
- `lock_timeout=5s`는 잠금 획득 대기 제한이다. 전체 실행 시간·CHECK/FK 검증·일반 unique index 생성의 쓰기 잠금 시간은 실제 복원본에서 측정한다.
- 같은 migration 파일이 `d4e954b` 이후 `e0718fd`에서 교정됐다. 대상의 적용 checksum과 실제 제약을 반드시 확인한다. 파일 교정만으로 이미 적용된 DB가 바뀌지는 않는다.
- 시작 명령은 **모든 pending migration**을 적용한다. 과거 DROP migration 등이 예상 밖으로 남아 있으면 중단한다. 이번 추가형 SQL 검수가 그 변경까지 승인하지 않는다.
- 백필 CLI의 대상 guard는 자동 `migrate deploy`의 DATABASE_URL을 보호하지 않는다. 배포 앱과 DB 연결을 따로 확인한다.
- 실패 시 migration 기록과 실제 객체를 보존·조사한다. 자동 `reset`, `db push`, migration 이력 삭제, 기존 자료 삭제로 복구하지 않는다.

## 6. 원본 비교와 CLI 대상 계약

`scripts/academic-year/db-target.ts`는 `ACADEMIC_MIGRATION_DATABASE_URL`만 사용한다. `.env`나 일반 DATABASE_URL로 대체하지 않는다. 보호된 JSON에는 environment, host, port, database, username, markerScope, marker, restoreReportId를 기록하고 접속 전·후 모두 대조한다. JSON에 비밀번호를 넣지 않는다. restoreReportId는 실제 완료한 복원 보고서 식별자여야 하며 임의의 문자열로 절차를 통과시키지 않는다.

검증 대상은 최초 복사 구간의 before/after manifest와 현재 명부의 일치 여부다. Release A 이후 정상 신청·체크인 변경이 일어났다는 이유만으로 최초 manifest에 영구 고정하지 않는다. 현재 예외·미귀속 공고·명부 불일치는 공개 직전에 다시 검사한다.

증거 포맷은 `posanmeal-legacy-fingerprint` version 2다. SQL JSON 배열과 행 경계 인코딩으로 NULL·제어문자·개행 충돌을 막고 UTC 마이크로초와 jsonb 저장값을 보존한다. 무버전/다른 버전 before는 비교 실패로 처리한다. 옛 hash를 v2로 변환할 수 없으므로 이전 전 원본 또는 검증된 복원 원본에서 v2 기준 증거를 확보한다. 이미 바뀐 DB를 새 before로 삼아 과거 변경을 정상으로 승인하지 않는다.

다음은 승인 뒤 사용할 CLI 형식이다. 접속 비밀값은 보호된 실행 환경에서 `ACADEMIC_MIGRATION_DATABASE_URL`로 전달하며 명령·로그에 출력하지 않는다. `ACADEMIC_TARGET_CONFIG`, `ACADEMIC_REPORT_DIR`, `ACADEMIC_BEFORE_FILE`은 검토한 보호 파일 경로다.

```sh
node --import tsx scripts/academic-year/backfill.ts --mode inspect --target-config "$ACADEMIC_TARGET_CONFIG"
node --import tsx scripts/academic-year/backfill.ts --mode apply --target-config "$ACADEMIC_TARGET_CONFIG" --report-dir "$ACADEMIC_REPORT_DIR"
node --import tsx scripts/academic-year/verify.ts --mode inspect --target-config "$ACADEMIC_TARGET_CONFIG" --before "$ACADEMIC_BEFORE_FILE"
node --import tsx scripts/academic-year/verify.ts --mode apply --target-config "$ACADEMIC_TARGET_CONFIG" --before "$ACADEMIC_BEFORE_FILE" --report-dir "$ACADEMIC_REPORT_DIR"
node --import tsx scripts/academic-year/enable.ts --mode inspect --target-config "$ACADEMIC_TARGET_CONFIG"
```

`backfill apply`는 변경 전에 before를 저장하고 복사 뒤 비교·검증 확정까지 수행한다. `ACADEMIC_BEFORE_FILE`은 검증하려는 해당 copy 구간이 출력한 bundle의 원래 before다. 별도 `verify apply`는 그 구간의 예외 정리 후 명시적으로 재확정할 때 사용하며 새 기준을 임의로 만들지 않는다. A 공개 뒤 정상 쓰기가 진행된 B 단계에는 A의 최초 before를 무조건 재비교하지 않는다. A에서 승인한 원본 보존 증거와 B의 새로운 배포 구간 증거를 분리한다. 실패한 재검증은 기존 VERIFIED를 COPIED로 낮추고 verifiedAt을 지운다. `verify inspect`는 `canEnable=true`여도 stamp를 쓰지 않는다.

Release B 공개 승인 단계에서만 다음을 실행한다. Release A에는 이 CLI가 포함돼도 READY를 열지 않는다.

```sh
node --import tsx scripts/academic-year/enable.ts --mode apply --target-config "$ACADEMIC_TARGET_CONFIG" --report-dir "$ACADEMIC_REPORT_DIR"
```

apply는 모든 경우 restoreReportId·대상 guard·보호 보고 경로를 요구한다. bundle은 0700, before/after/result는 0600이며 기존 파일 덮어쓰기를 거절한다. `report=<bundle>`는 before 영속 저장 뒤 출력한다. 후반 보고 저장이 실패하면 종료코드가 비0이어도 DB는 이미 VERIFIED 또는 READY일 수 있다. 자동 재실행 전에 남은 before와 읽기 전용 상태를 확인한다. READY 뒤 enable inspect의 `rosterMode=READY canEnable=false issues=none`은 이미 공개된 정상 상태다.

최종 verify/READY는 최신 명부·충돌·미귀속 공고와 v2 검증 자격을 확인하고, 진행 중인 공고/신청 쓰기는 SHARE 테이블 잠금으로 기다린다. 이 잠금은 Release B 전체 쓰기 차단 절차를 대신하지 않는다.

## 7. Release A — 호환 단계

Release A는 Task 1~4A에 해당한다. 보완 후보는 별도 브랜치 `release-a/academic-year-roster-hardened`의 `c39aa23`다. 검증/증거 수정 `be664c4` 위에 A에도 필요한 이메일 로그인 수정만 추가했다. 기존 포인터 `release-a/academic-year-roster`의 `81a4a81`은 보존했다. 후보에는 검증/CLI/fingerprint/동일 요청 receipt/이메일 로그인 수정만 역적용하고 B의 명부 UI·전환·캐시·행 wrapper는 넣지 않았다. 독립 코드 검토, A 전용 단위 347개·타입·변경 lint·확정 커밋 production build를 통과했다. 실제 PG 110개는 동일 foundation의 부모 be664c4에서 통과했으며 마지막 로그인 수정은 mock callback으로 검증했다. 전체 Release B HEAD를 A라고 배포하지 않는다.

1. 승인된 A SHA, 대상 DB·Volume, 위 복원본 이전 리허설까지 통과한 실제 복원 보고서, pending migration 목록을 고정한다.
2. 새 DB·사진 백업과 원본 manifest를 만든다. 한 차례 재로그인이 필요함을 공지한다.
3. 추가형 migration과 호환 앱을 배포한다. 롤링 교체가 끝나 구 컨테이너가 없음을 확인한다.
4. 지정 담당자가 실제 DB 식별을 재확인하고 운영 marker를 만든다. 생성 계정·시각을 기록한다.
5. inspect → 명부 copy/apply → 원본 비교 → 예외 해결 → 명시적 검증 확정으로 VERIFIED를 만든다.
6. PREPARING 상태를 유지하고 기존 신청·체크인·호환 사용자 쓰기가 계속되는지 확인한다. 새 명부 관리 기능은 공개하지 않는다.

A의 기존 쓰기를 장기간 중단하지 않는다. 복사 구간에 실제 쓰기가 겹쳐 before/after가 달라지면 차이를 조사하고 승인된 동일 기준 시점으로 재검증한다. 이를 무조건 원본 훼손이나 무조건 허용 변경으로 판단하지 않는다.

## 8. Release B — 새 기능 공개

Release B 코드 후보는 `7cf4859`다. 이후 문서 전용 커밋은 코드 후보를 바꾸지 않으며 실제 승인 시 배포할 전체 SHA를 고정한다.

1. A의 실제 운영 v2 VERIFIED와 원본 보존 증거, 최신 예외 해결 결과, 실제 복원본 B 리허설 보고서, 승인된 B SHA와 유지보수 창을 확인한다.
2. **모든** 키오스크의 미전송을 업로드하고 검토 필요 건을 처리한다. 현장 담당자가 미전송 0건·스캔 중지를 확인한다. 내보내기 파일 생성만으로 업로드 완료라고 판단하지 않는다.
3. 운영 HTTP 쓰기를 막고 기존 앱 인스턴스를 모두 종료한다. 현재 앱에는 일반 유지보수 쓰기 차단 스위치가 없으므로, 실행안에서는 기존 앱 중지 및 신규 앱의 외부 요청 유입 차단을 인프라 단계로 확정해야 한다. 실제 차단이 확인되기 전 다음 단계로 가지 않는다.
4. 새 백업·원본 manifest를 만든다. 승인된 B를 외부 요청이 차단된 상태에서 시작하고 migration 목록·종료 코드를 확인한다.
5. A의 유효한 v2 VERIFIED를 유지하는 정상 경로에서는 `enable --mode inspect`의 최신 명부·미귀속·충돌 검사를 통과시킨다. A 최초 before에 정상 운영 변경을 다시 비교하거나 B의 새 before로 A 보존 증명을 대체하지 않는다. B 배포 직전/직후의 원본 비교는 B 구간 증거로 따로 보관한다. A가 미완료/구형 증거/비교 실패 상태면 멈추고 원래 copy 구간 증거 또는 검증된 복원 원본으로 재검증 절차를 정한다. B에서 `backfill apply`를 임의 재실행해 기준을 새로 만들지 않는다.
6. 위 `enable --mode apply`로 READY를 공개한다. 별도 CLI는 웹 앱의 메모리 캐시를 직접 지우지 못한다. 외부 차단을 유지한 채 모든 앱 인스턴스를 재시작하거나 최대 30초 TTL이 지난 뒤 인스턴스별 READY 응답을 확인한다.
7. 먼저 시험 계정으로 신청·관리자 과거 조회·QR·얼굴 확인 후 저장을 점검한다. 키오스크를 재동기화하고 운영 학년도·14일 자격 범위·미전송 상태를 확인한다.
8. 외부 접근과 현장 스캔을 재개한다. 결과·배포 SHA·시각·담당자·오류 관찰을 기록한다.

실제 차단 방법과 새 앱의 비공개 시작 방법은 Railway 운영자가 확정해야 한다. 확인 없이 서비스에 없는 유지보수 기능이나 순서를 있다고 간주하지 않는다.

## 9. 중단·복구 기준

- 승인 대상/marker/DB 연결/사진 Volume 불일치, 예상 밖 pending migration·checksum·drift.
- 백업만 있고 실제 복원이 검증되지 않았거나, 원본 비교·PK/FK·사진 검증 실패.
- 이메일/학번/학년도 귀속의 모호함, 최신 명부 불일치, VERIFIED 미충족.
- 구 앱 쓰기 지속, B 쓰기 차단 미확인, 키오스크 미전송·중지 확인 누락.
- migration 오류, 잠금/실행 시간이 승인 한도 초과, 실패 후 실제 DB 상태 불명.

READY 전 실패하면 새 기능을 비공개로 유지하고 추가 스키마를 이해하는 호환 앱으로 복구 가능성을 검토한다. READY 후에는 새로 쌓인 신청·체크인·명부 변경을 보존하는 수정 배포를 우선 검토한다. 옛 백업 자동 복원이나 구 앱 무조건 복귀로 새 데이터를 덮어쓰지 않는다.

## 10. 실행 전 승인 기록

사용자가 2026-09-20에 push/deploy를 명시적으로 승인했고 모든 키오스크 미전송 0건과 스캔 중지도 확인했다. 실제 원본 조사에서 날짜 없는 과거 공고의 예외가 발견되어 운영 main 갱신·migration·VERIFIED/READY는 보류했다. 키오스크는 기존 서비스에서 재개할 수 있다고 안내했으므로 다음 전환 직전에 동기화와 중지를 다시 확인한다. 운영 기록에는 다음을 구체적으로 남긴다.

- 원본 DB·사진 읽기 전용 백업/복사와 별도 복원 대상·보관 기간·삭제 책임.
- 복원 환경의 실제 DB·앱·사진 경로·접근 통제·시험 인증. Railway 추가 시 리소스와 비용 한도.
- 검증된 Release A SHA 및 A 적용 시각, 실제 복원 보고서.
- 검증된 Release B SHA·유지보수 시각·요청 차단 방법·현장 키오스크 담당자.

사용자의 배포 승인 자체를 다시 요구하지 않는다. 원본 보존 검증과 실제로 발견한 예외의 처리 기준을 확보한 뒤 승인된 범위에서 계속 진행한다. 백업 생성·분리 복원·코드 브랜치 push와 운영 main 배포·DB 전환의 완료 여부는 각각 기록한다.
