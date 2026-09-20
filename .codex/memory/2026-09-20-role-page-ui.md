# 2026-09-20 교사·학생 페이지 표시 개선

## 승인 및 변경

- 사용자가 관리자 급식확인과 같은 상단부터 시작하는 표, 교사·학생 책갈피 탭, 학년도 안내의 표 하단 이동을 승인했다. school_cowork의 designer.md와 DESIGN_GUIDE.md를 참고하는 범위는 표시 디자인이다.
- 교사·학생 페이지에 책갈피 탭과 내부 스크롤을 적용했다. 교사 학생관리 표는 전체 폭으로 표시하고 상단 도구를 한 줄로 배치하며 학년도 안내를 표 아래로 이동했다.
- 미신청 식사 음영, 식사별 색상, 학생 선택 및 QR 출력 로직은 유지했다.
- 변경 파일: `src/app/teacher/page.tsx`, `src/app/student/page.tsx`, `src/components/StudentTable.tsx`, `src/components/ui/tabs.tsx`.
- 기존 교사 안내 문서 등 다른 미커밋 변경은 보존한다. DB·API 변경은 없다.

## 검증

상위 작업자가 전달한 실행 결과를 기록한다.

- 단위 테스트 586개, TypeScript, 변경 파일 ESLint, diff 검사 통과.
- 격리 preview(3108)의 가상 인증·예시 API로 320·375·768·1024·1440px에서 모든 탭의 넘침과 44px 터치 영역 확인 통과.
- 학생 32명 선택, 월 이동, QR 이미지 및 인쇄 PDF 확인 통과.
- 375×667 화면의 sticky, 비담임 4개 탭, 공고 없는 학생 4개 탭 확인 통과.
- 마지막 배지 `shrink-0`/`basis-auto` 조정 후 최종 TypeScript·변경 4파일 ESLint·diff 검사 exit 0. 브라우저 `check.cjs`도 exit 0, result PASS, errors []로 재검증 완료했다.
- 최종 정적 반응형 검토에서 차단 사항이나 회귀는 발견하지 않았다.
- 커밋·푸시 준비 과정에서 단위 테스트 586개·TypeScript·변경 파일 ESLint·Prisma generate를 재실행해 모두 통과했다.
- 실제 소스 4파일과 `next.config`의 일치를 확인한 격리 환경에서 production webpack build 42/42, exit 0을 확인했다. 운영 환경변수 없이 dummy DB 설정을 사용했다.
- 실제 로그인, 실기기, 물리 인쇄, 전체 lint, deploy는 미실행.

## 다음 단계 및 산출물

- 사용자가 커밋·푸시를 승인했고 준비 검증을 완료했다. 이 기록은 실행 직전이며 커밋·푸시 실행 결과와 원격 SHA는 추후 확인해야 한다. 배포는 미실행이며 실제 계정·실기기·물리 인쇄 검증은 남아 있다.
- 임시 검증 산출물: `/tmp/posanmeal-role-ui`.
- 격리 복사본: `/Volumes/Chois_SD2/dev/.posanmeal-role-ui-preview`.
- 검증 후 preview 서버 종료(exit 0)를 확인했다.
