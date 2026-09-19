# 학년도 명부 구현·검증 보고서

작성일: 2026-09-20. 브랜치: `feat/academic-year-roster`.

## 구현과 현재 상태

Task 14a·14b·14c 구현, 독립 코드/UI 검토와 격리 브라우저 검증을 완료했다. Task 15의 전체 경로 감사, 회귀 수정, 합성 검증과 운영 실행안 작성을 완료했다. Release A/B 확정 커밋의 격리 production build도 통과했다. 실제 운영 백업·복원·Release A/B 적용은 별도 실행 승인이 필요한 미실행 항목이다.

| 파트 | 커밋 | 내용 |
| --- | --- | --- |
| 14a 검토 수정 | `d63c999` | 명부·Excel·계정 다이얼로그, 재시도/409 처리, 권한, 이메일 변경 경합 |
| 14b | `672adfd` | 준비 학년도·전환·지난 명부 삭제·과거 정정·월별 확인 필요 |
| 14c | `432055e` | 체크인 검토, 공고 학년도·잠금, 통계/월별 현재 학급, 학생 과거 프로필 |
| 15 서버 snapshot | `25db256` | upload 원자성·동시 download 근거 일치 |
| 15 신청·보고서 | `0e33194` | 접수기간/복원 경합, 담임 조회 범위, 과거 식사 표시, 구 Excel 매칭 |
| 15 최종 회귀 | `7cf4859` | 검증 증거·멱등·명부 경계·로그인·로컬 기록 보존 |
| Release A 보완 | `c39aa23` | A 전용 검증/증거/receipt와 이메일 로그인 수정. B 기능 제외 |

Task 13은 기존 `7a3f021..f606ac0` 작업을 보존했다. 기존 Claude 보고의 테스트 수를 이번 세션의 재실행 결과로 합산하지 않는다.

## 파트별 실제 검증

| 검증 | 14a | 14b | 14c |
| --- | --- | --- | --- |
| 단위 테스트 | 504 / 50파일 | 522 / 53파일 | 534 / 54파일 |
| 실제 PostgreSQL 통합 | 339 / 19파일 | 344 / 19파일 | 353 / 20파일 |
| 타입·변경 파일 lint·diff | 통과 | 통과 | 통과 |
| 독립 Chromium 시나리오 묶음 | 14 | 36 | 40 |
| 추가 DB 보존 확인 | 해당 회귀 테스트 포함 | 10 | 4 |
| 실제 XLSX 다운로드 파싱 | Excel 흐름 조작 | 학생 51명·교사 3명 | 2개 파일 |
| 격리 production build | 통과 | 최종 전체 검증에서 갱신 | 최종 전체 검증에서 갱신 |

브라우저 숫자는 테스트 함수 수나 실기기 수가 아닌 시나리오 묶음 수다. 화면은 360/768/1280px와 짧은 360×568px를 사용했다. 14c 짧은 화면의 최초 애니메이션 중 측정 실패를 보존하고, 안정화 후 재검증 통과를 구분했다. 실제 저장 후 응답 차단·같은 requestId 재전송, 409 최신 조회, 지연 저장 중 조회 옵션 변경도 조작했다.

브라우저는 `.env` 없는 ignored scratch 앱 사본, 고정 전용 DB `127.0.0.1:55439`, 독립 Chromium에서 실행했다. Google OAuth·운영 서비스·학생 원본·실기기 카메라는 사용하지 않았다. 각 파트 뒤 생성한 서버·브라우저를 종료했다. 조작 절차는 [브라우저 점검 문서](../testing/academic-year-browser-checks.md)에 있다.

## Task 15 회귀 수정

지적별로 실패를 재현하고 수정했다. 아래 개별 회귀 수는 최종 전체 테스트에 포함되므로 더해서 전체 수로 계산하지 않는다.

- 신청은 공고 잠금 뒤 접수 상태/기간과 최신 신청 상태를 확인한다. 잘못된 공고/신청 경로 조합을 거절하고 과거·이용 중단 신청이 경합 중 복원되지 않게 했다. 실제 PG 경합 8건.
- 담임은 운영 학년도 3월~다음 해 2월만 조회한다. KST 기본월, 조기 전환, 오류 복구를 포함했다. 신청을 취소한 뒤에도 남아 있는 실제 조식·중식 체크인을 표와 Excel에 표시한다. 보고서 PG 31건.
- Excel은 빈 행 뒤 데이터/오류/메타도 읽는다. 이메일 없는 구 신청 양식에서 전출자와 재학생이 학번을 공유하면 거절한다. 기존 계정을 다른 역할 시트로 옮겨도 학생/교사 종류가 바뀌지 않는다.
- 명부 행의 entry/year/user 연결을 잠금 안에서 검사한다. 직접 records API도 역할 변경을 차단한다. 미리보기는 한 RepeatableRead로 읽어 전환 전 초안 행과 전환 후 버전을 섞지 않는다. 새 실제 PG 경계 5건, 순수 Excel 역할 10건.
- 같은 대상/requestId 재송신은 잠금 뒤 저장된 receipt를 다시 확인한다. User→Record 잠금 순서로 이용 중단/이메일/명부 변경 교착을 해결했다.
- fingerprint v2는 NULL·제어문자·열/행 경계를 구분한다. 기본 inspect는 쓰지 않고, 명시 검증 실패는 오래된 VERIFIED를 취소한다. READY는 지원 증거 형식과 최신 명부/공고를 검사한다. apply는 DB 변경 전에 보호된 before를 영속 저장한다. foundation PG 139건, fingerprint PG 9건, 파일 보호 3건.
- Google 로그인은 원문 이메일을 보존하면서 동일 정규화 규칙으로 계정을 찾고 모호한 중복·중단 계정은 거절한다. 실제 callback을 mock DB로 검증한 16건이며 외부 OAuth 성공 주장과 구분한다.
- upload는 clientKey 선점·원본·CheckIn·검토 종결을 한 transaction으로 처리한다. download는 실제 응답과 저장 snapshot 근거를 같은 시점에서 만든다. 신규 PG 경합 10건.
- 강제 초기화는 내보낸 뒤 추가/변경된 원본과 종결 거절까지 같은 IDB transaction에서 확인한다. 로그아웃/일반 초기화 중 새 기록도 보존한다. 식사 발생 학년도 표시를 사본으로 남기며 결측을 현재 학급으로 대체하지 않는다. 명시 LUNCH QR을 석식으로 바꾸지 않는다.

## 최종 전체 검증

2026-09-20, B 코드 커밋 `7cf4859` 기준이다. 작업 트리의 별도 guide 변경은 보존하고 학년도 커밋에는 포함하지 않았다. 확정 커밋 아카이브 결과는 별도 행으로 구분한다.

| 검증 | 실제 결과 |
| --- | --- |
| Prisma generate | 명시 `tests/integration/prisma.config.ts`, exit 0. migrate/seed 없음 |
| 전체 타입 | `npx tsc --noEmit`, exit 0 |
| 변경 코드 lint | 오류 0·경고 4, exit 0 |
| 전체 제품 소스 lint | 오류 5·경고 6, exit 1. 아래 기존 오류와 구분 |
| 단위 | 59파일 584/584, exit 0 |
| 실제 PG 통합 | 25파일 420/420, exit 0, 33.63초. 고정 합성 DB만 사용 |
| 별도 Sheet 안내 문서 | `npm run test:guide`, 1파일 4/4, exit 0 |
| B 확정 커밋 아카이브 | `7cf4859`: generate·단위 584·guide 4·production build/타입·정적 39/39 통과. 489개 blob 대조 |
| A 분리 검증 | `c39aa23`: 단위 42파일 347/347, 타입·변경 lint 통과. foundation PG 7파일 110/110은 동일 foundation의 부모 `be664c4`에서 실행 |
| A 확정 커밋 아카이브 | `c39aa23`: generate·누적 변경 15파일 lint·production build/타입·정적 37/37 통과. 390개 blob 대조 |
| 공백 검사 | `git diff --check` 통과 |

아카이브는 해당 SHA의 추적 파일만 추출하고 `.env*`를 이름 기준으로 제외했다. 빈 scratch HOME·허용한 환경값·합성 DB URL·임의 AUTH_SECRET을 사용했다. Prisma migrate/seed는 실행하지 않았다. ignored 경로의 Tailwind 탐색을 위해 검증 사본의 PostCSS base와 CSS `@source`만 조정했으며, 이 두 파일 외 blob 차이 0을 확인했다. 실제 제품 설정에는 반영하지 않았다. 생성 CSS의 flex/min-h-11/preflight도 확인했다. 부모 workspace root 추론과 기존 uploads NFT 경고는 남았으나 빌드는 exit 0이다.

Task 15 추가 브라우저 검증은 서로 다른 범위다.

- 담임 실제 StudentTable/useTeacherStudents + 합성 HTTP 응답: 9개 묶음. 360×568/768×1024/1280×900, 50자 이름, sticky/내부 스크롤, 44px, 3월/다음 해 2월 경계, 보이지 않는 선택 인쇄 제외, 조식/중식/KST 표시, 403 후 복구. API 자체의 실제 PG 검증과 구분한다.
- 실제 IndexedDB 원본 보존 14개 + 실제 ForceResetDialog 6개 + pageerror 0 확인 1개 = 21개. 다른 탭의 QR 저장 후 초기화 차단, 재다운로드 XLSX 원본 확인, 재내보내기 뒤 초기화 포함.
- 기존 제품 upgrade handler v4/v5→v6를 독립 Chromium origin에서 다시 실행해 18/18 통과. 미전송/전송 3건 원본과 실패 주입 후 명부·기록 보존을 확인했다. v1~v3 실브라우저 실행은 아니다.

담임 harness 최초 실패는 한국어 시간의 오전/오후 표시와 SWR 중복 요청 제한에 대한 테스트 기대/대기 문제였다. harness만 고쳐 통과했고 제품 실패로 분류하지 않았다. 이 중간 로그 및 UI 애니메이션 측정 실패를 보존했다.

## 독립 검토와 인계

14a·14b·14c마다 코드/UI 검토 후 다음 파트로 진행했다. 최종 전체 브랜치는 foundation/A, 명부·Excel·전환·삭제(Tasks 5~9), 신청·과거 보고서(10~11), 서버/로컬 키오스크(12~13), 관리자 UI(14)로 나누어 검토하고 새 지적을 회귀로 해결했다. root가 구현자의 수정 diff와 실제 테스트 경계를 교차 확인했다. 검토 범위의 Critical/Important 잔여 지적은 0이다.

역할 런타임 thread limit으로 일부 전용 `responsive-ui-reviewer`, `project-map-updater`, `project-memory-keeper`, SQL guardian을 새로 실행하지 못했다. UI는 독립 작업자가 해당 역할 TOML·반응형 규칙을 적용했고, 맵·인계·SQL은 root가 역할 체크리스트를 직접 수행했다. 전용 에이전트를 실행한 것처럼 기록하지 않는다. Railway 메타데이터 검토는 기존 배포 담당 역할이 수행했다. 최신 AGENTS의 Claude 원본 보존 규칙을 따라 `.codex/`만 갱신했다.

## 기존 오류와 검증 한계

최종 전체 소스 lint는 변경하지 않은 3개 파일에서 오류 5개·경고 6개로 실패했다. `admin/login/page.tsx`의 내부 `<a>`, `QRGenerator.tsx`의 effect 내부 setState 2개·any 1개, `SignaturePad.tsx`의 렌더 중 ref 읽기가 오류다. 기준 `68e81d0` 대비 해당 파일 diff가 없음을 확인했다. 변경 파일 lint는 통과했다. scratch `.next` 번들을 포함한 기본 ESLint 실행은 중단하고 제품 소스 대상 결과를 따로 기록했다.

원본 CSS의 폰트 변수 자기 참조가 관찰됐으나 이번 학년도 변경에 포함하지 않았다. 실제 태블릿, 카메라/얼굴 모델 정확도, 외부 OAuth, 운영 네트워크 장애 및 실제 운영 백업 복원은 합성 브라우저 검증으로 대체되지 않는다.

## 운영 검토

Railway 담당 역할이 서비스/배포/Volume/시작 명령 메타데이터를 읽기 전용 확인했다. DB 접속 관계·환경변수·사진 파일·migration 이력은 확인하지 않았다. SQL은 실제 257줄을 검토했다. 전용 guardian 역할 실행은 thread limit으로 불가능하여 역할 파일 체크리스트를 수동 수행했으며, 운영 적용 승인으로 기록하지 않는다.

실행 대상·Release A/B 분리·중단/복구 기준은 [운영 반영 실행안](academic-year-migration-runbook.md)에 있다. `main` 자동 배포가 활성화되어 있어 로컬 커밋을 운영 반영으로 연결하지 않았다. push·merge·deploy는 실행하지 않았다.

## 검증 자료 위치

개인정보 없는 상세 로그·실행 코드·스크린샷은 로컬 ignored `.superpowers/sdd/2026-09-19-academic-year-roster/`의 `browser-14a-*`, `browser-14b-*`, `browser-14c-*`, `15-*.log`에 있다. 이 경로는 git 산출물이 아니므로 영속 결론과 미실행 범위는 이 보고서와 점검 문서에 기록한다. 실제 복원 원본·자격증명은 저장하지 않았다.
