# Changelog

## 2026-03-29

### 신규 기능

- **Apps Script 템플릿 생성기** (`code.gs`)
  - Google Spreadsheet에서 `포산밀 > 템플릿 생성` 메뉴로 학생/교사 시트 자동 생성
  - 학생 시트: `email, grade, classNum, number, name, startDate, endDate` (7열)
  - 교사 시트: `email, subject, homeroom, position, name` (5열)
  - 데이터 유효성 검사 (학년 1~3, 반 1~20, 번호 1~50, 담임 드롭다운)
  - 앰버 톤 헤더, 예시 데이터, 헤더 노트 포함

### 개선

- **Spreadsheet import 에러 핸들링 전면 개선** (`src/app/api/admin/import/route.ts`)
  - RFC 4180 준수 CSV 파서로 교체 (따옴표 내 쉼표 처리)
  - 네트워크 오류, 빈 시트, 잘못된 URL, 숫자/날짜 유효성 사전 검증
  - 부분 성공 시 `warnings` 필드로 성공/경고 동시 전달
  - 모든 예외를 한글 에러 메시지로 반환 (500 빈 응답 방지)

- **관리자 import UI 에러 표시 개선** (`src/app/admin/page.tsx`)
  - 성공 메시지(초록)와 에러 메시지(빨강) 분리 표시
  - `res.json()` 파싱 실패, 네트워크 오류 처리
  - URL 미입력 시 클라이언트 사전 체크

### 버그 수정

- **Spreadsheet import 트랜잭션 타임아웃 해결**
  - 원인: `prisma.$transaction([...N개 upsert])`가 순차 실행되어 원격 DB 왕복 지연 누적 (5초 초과)
  - 해결: `$transaction` → `Promise.all` 병렬 upsert로 변경
  - upsert는 email unique 제약으로 개별 실행해도 데이터 정합성 보장

## 2026-03-28

### 신규 기능

- **월별 4시트 Excel 다운로드** — 교사/1~3학년 시트별 석식 현황 엑셀 내보내기
- **교사 체크인 인라인 수정** — 관리자가 교사 체크인 타입(근무/개인) 직접 변경 가능
- **성능 최적화** — DB 인덱스 5개, pg.Pool 커넥션 풀, 배치 트랜잭션, Promise.all 병렬 쿼리
- **Warm Modern 디자인 개편** — 앰버/골드 테마, 글래스모피즘, OKLCH 색상
- **QR 체크인 사운드 피드백** — 승인(딩동), 중복(긴 삐), 오류(삐삐)
- **테이블 합계행** — 학생/관리자 석식 테이블에 월별 합계 표시
- **카메라 전환** — QR 스캐너 다중 카메라 지원
- **석식 테이블 재설계** — 틀고정, 주말 하이라이트, 반응형 레이아웃
- **관리자 석식 확인** — 교사/1~3학년 탭별 월간 석식 현황
- **교사 확인 탭** — 담임교사의 학급 학생 석식 확인
