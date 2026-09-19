# 키오스크 가시 높이·하단 여백 개선 — 2026-09-19

## 완료한 변경

- 사용자 동작 기준은 Chrome이다.
- 요청: `/check`·`/facecheck`의 태블릿 새로고침 후 하단 잘림을 줄이고 안내·버튼의 세로 여백을 축소한다. 가로·세로 화면에 카메라와 조작부를 맞추며 문구 줄바꿈을 막는다.
- 공용 `src/components/KioskViewport.tsx`: fixed 루트와 CSS `100dvh` 폴백, `min(innerHeight, visualViewport.height)`로 실제 가시 높이를 반영한다. resize/pageshow/orientationchange/visibilitychange 때 재측정하며 pinch zoom 중에는 재배치하지 않는다.
- `src/app/globals.css`와 두 페이지: safe-area 반영, 안내줄 64~80px → 32~40px, 버튼 배경 32px·터치 영역 44px. 동기화 상세는 별도 한 줄 가로 스크롤, 좁은 화면은 조작 그룹 flex-wrap·라벨 nowrap, 카메라는 flex/min-height:0으로 남는 높이를 사용한다.
- 사운드·얼굴 모델·인식/저장 업무 로직은 유지했다. 프로젝트 맵은 별도 담당자가 갱신했다.

## 실행 검증과 한계

아래 앱 검증은 주 작업자가 실행한 결과를 인계받아 기록했다. 문서 담당자는 현재 git 상태·커밋과 관련 소스·파일 존재를 확인했다.

- `npm test`: 34개 파일·284개 테스트 통과.
- production build 통과. 기존 `next.config.ts` → uploads route의 NFT warning은 남아 있다.
- 변경 TSX 3개 ESLint: 오류 0개, 기존 img 경고 3개. `git diff --check` 통과.
- 이전 `npx tsc --noEmit`: 기존 `tests/admin-sheet-import-guide.test.ts:15,21`의 TS1501 2개로 실패. 이전 실행에서는 전체 타입 검사를 통과하지 못했다. 후속 호환 정규식 수정으로 해결했으며 재검증 결과는 아래와 같다.
- Headless Chrome fixture: 7개 viewport의 최초 진입·새로고침, 가시 높이 변경·복귀·회전·확대·폴백을 포함해 46개 통과. 스크립트 `/tmp/posanmeal-kiosk-responsive.py`는 임시 산출물이다.
- 실제 QRScanner에 synthetic canvas QR을 입력하고 API 응답만 fixture로 처리한 `/check`·`/facecheck` QR 결과 6개(320×568, 568×320, 820×1180 각각) 통과. 긴 가상 이름·사진의 한 줄 표시, 가로 스크롤 접근, 사진 상하 잘림 없음·페이지 overflow 없음을 확인했다. 임시 스크립트 `/tmp/posanmeal-kiosk-result-layout.py`와 결과 JSON을 사용했다.
- 얼굴 확인 흐름 19개와 학생/교사 다이얼로그 4개 viewport × 2종 8개도 통과했다. viewport/QR 결과 52개 + 확인 흐름/다이얼로그 27개 = 총 79개 브라우저 검사. 가상 데이터를 썼으며 실얼굴 인식 정확도 검증은 아니다.
- 통제 재현: layout 높이 1180px·visual viewport 1060px에서 기존 footer 하단 1172px로 잘림, 수정 후 1038px. 실제 태블릿의 원인을 확정한 결과는 아니다.
- 스크린샷 `.playwright-mcp/kiosk-compact-*.png`는 ignored 산출물. 가시 높이 모사의 아래 100px 빈 영역은 fixture 바깥이다. 실제 태블릿 Chrome 검증은 미실행이다.

## 푸시 준비 후속 검증

주 작업자가 실행한 결과를 인계받았다. 기존 `/s` 정규식 두 개를 `[\s\S]*`로 바꿔 TypeScript 대상 버전과 호환되게 했다.

- `npx tsc --noEmit`: exit 0, 이전 TS1501 2개 해결.
- `npm test`: 34개 파일·284개 테스트 통과.
- 변경 파일 4개(TSX/TS) ESLint: 오류 0개, 기존 img 경고 3개. `git diff --check` 통과.
- `npx prisma generate` + `npm run build`: exit 0. 기존 NFT warning 1개는 남아 있다.
- 브라우저 79개 검사는 직전 작업의 결과이며 이번 후속 검증에서 재실행하지 않았다. 후속 소스 변경은 테스트 정규식에 한정됐다.

## 현재 상태·다음 단계

- 직전 얼굴 확인 기능은 `e64fc6d`에 로컬 커밋됐다. 이전에는 커밋만 요청받았고, 최신 요청에서 사용자가 origin/main 푸시를 승인했다. 푸시 승인은 확인됐으며 커밋·푸시 실행 결과와 원격 반영 여부는 후속 실행 및 git 원격 조회로 확인한다.
- 실제 태블릿 Chrome에서 새로고침·주소창 변화·가로/세로 회전 후 하단 조작부와 확인창 접근을 확인한다. 실기기 검증과 Railway 배포 완료 여부는 별도 확인이 필요하다.
