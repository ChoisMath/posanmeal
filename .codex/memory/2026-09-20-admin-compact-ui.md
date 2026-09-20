# 2026-09-20 관리자 화면 공간·도구 배치 개선

## 승인·완료 범위

- 사용자 승인 설계에 따라 탭을 본문에 연결하는 책갈피 형태로 바꾸고 전체 폭을 활용했다. school_cowork의 designer/DESIGN_GUIDE에서 색상을 제외한 밀도·배치 원칙을 참고했다.
- 사용자 관리: 교사·1/2/3학년 필터, 짧은 버튼·드롭다운·셀. 운영 학년도는 후속 요청대로 설명 문구 없이 `2026`처럼 숫자만 표시한다.
- 학년도 선택·다음 학년도 준비·전환·지난 명부를 설정의 관리 모달로 이동했다. 준비 명부 편집 동선과 읽기 전용 지난 명부를 유지했다.
- `Excel` 버튼의 모달에 양식 내려받기·기존 데이터 포함 옵션을 모았다. 지난 명부는 내려받기만 제공한다.
- 신청관리: 버튼 높이 28px, 운영 학년도·신청기간 한 행, 기간 `mm-dd hh:mm` 표기.
- 급식확인: 월별기록/체크인검토 하위 탭을 없애고 교사·1/2/3학년 드롭다운, 월 이동, Excel, `현재학급` 체크박스를 한 행으로 배치했다. 표 행은 32px. 좁은 화면은 도구 행 내부 가로 스크롤, 표 sticky 유지.
- 체크인 검토와 확인필요 기록을 설정으로 이동했다. 확인필요 표는 읽기 전용이며 기존 오프라인 검토와 구분한다. 서브관리자도 설정에서 학년도·검토 조회가 가능하나 시스템 설정은 숨긴다.
- 글꼴 코드 변경 없음: 사용자의 실제 Chrome 운영 화면과 대조한 결과 기존 글꼴은 `Apple SD Gothic Neo`였다. 초기 Headless 브라우저의 기본 Times 글꼴이 미리보기 차이의 원인이었으므로 임시 Geist 관련 변경 3개를 모두 원복했다. `globals.css`는 HEAD 대비 diff 0이며 운영과 동일한 글꼴을 유지한다.

## 변경 위치

- `src/app/admin/page.tsx`, `src/components/AdminMealTable.tsx`. `src/app/globals.css`는 임시 변경을 원복하여 최종 변경 없음.
- `src/components/admin-roster/`: RosterToolbar, RosterManager, RosterTable, RosterImportDialog 수정 및 AdminSettingsPanels 추가.
- `src/lib/admin-roster/labels.ts`: 학년 필터 유틸과 `src/lib/__tests__/admin-roster-grade-filter.test.ts` 추가.
- 프로젝트 맵 갱신 완료. 기존 `.claude/.project-map-pending.log` 변경은 보존했다.

## 실제 검증

구현 담당의 실행 결과를 전달받아 기록했다. 이 인계 작업에서 앱 검증을 중복 실행하지 않았다.

- `npm test`: 60파일·586개 통과. 새 학년 필터 테스트는 RED 2개 확인 후 GREEN 2개 통과.
- `npx tsc --noEmit`, 변경 TypeScript 파일 ESLint, `git diff --check` 통과.
- Headless Chrome 예시 API 기반 격리 서버 `localhost:3107`: 320/375/768/1024/1440px에서 문서 가로 넘침 없음, 도구 한 행, 사용자 행 33px·급식 행 32px 확인.
- 학년 필터, Excel 모달, 지난 명부 다운로드 전용, 신청기간 형식, 설정 이동, sticky 셀, 서브관리자 읽기 전용 시나리오 통과. 페이지 오류 0개.
- 학년도 숫자·1차 글꼴 수정 후 같은 브라우저 시나리오 재통과. 최종 글꼴 검증은 CUA로 사용자의 Chrome 운영 `https://meal.posan.kr/admin`의 html/body/header/tab/td와 같은 Chrome의 `localhost:3107/admin/login` html/body/button computed font가 모두 `Apple SD Gothic Neo`임을 확인했다. 이 결과에 따라 임시 CSS 변경은 원복했고 검증 탭은 닫았다.
- responsive-ui-reviewer 정적 검토 2회 및 보완 완료. project-map-updater 완료.
- main 반영·푸시 승인 후 `npm test` 60파일·586개, `npx tsc --noEmit`, 변경 TS ESLint, `npx prisma generate` 재검증 통과.
- 수정된 src와 동일함을 확인한 격리 복사본에서 `npm run build -- --webpack` 성공(정적 페이지 41/41). 첫 시도는 복사본에 `scripts/academic-year/fingerprint`가 빠져 실패했고 누락 파일 보완 후 성공했다. 앱 코드 문제는 아니었으며 운영 환경 파일 없이 dummy DB URL을 사용했다.
- Railway advisor 사전 확인: 기존 dinner 배포 main `0ffec4b` SUCCESS, 이번 schema/migration/config 변경 없음, 배포 차단 사항 없음. 이는 새 UI 배포 성공 확인과 구분한다.

## 미실행·다음 단계

- 전체 lint, 실제 데이터 수정, 실제 Excel 가져오기 및 다운로드 내용 검사는 미실행.
- 사용자가 main 반영·푸시를 승인했다. fetch 후 main HEAD와 origin/main이 `0ffec4b`로 같음을 확인했으며 사전 검증 완료. 이 기록 시점에는 새 UI 커밋·푸시 실행 전이며 실제 푸시 SHA와 배포 결과는 별도로 확인해야 한다. 기존 `.claude/.project-map-pending.log`는 커밋 대상에서 제외한다. DB 변경은 수행하지 않았다.
- 브라우저 검증은 예시 API를 사용했으므로 운영 데이터·실기기 검증과 구분한다.
- 임시 검증 스크립트·이미지는 `/tmp/posanmeal-admin-ui`, 최종 사용자 관리 화면은 `users-1440.png`. 격리 복사본은 `/Volumes/Chois_SD2/dev/.posanmeal-admin-ui-preview`. 운영 환경 파일은 복사하지 않았고 DB URL은 dummy였다. `localhost:3107` 검증 서버는 정상 종료했으며 기존 `localhost:3100` 서버는 변경하지 않았다.
