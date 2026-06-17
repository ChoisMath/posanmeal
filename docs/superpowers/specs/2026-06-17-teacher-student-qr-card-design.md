# 담임용 학생 QR 일괄 출력 — 설계

> 작성일 2026-06-17 · 브랜치 `feat/posanmeal-mvp`
> 관련: `src/components/StudentTable.tsx`, `src/app/api/teacher/students/route.ts`, `src/app/check/page.tsx`

## 1. 목적

담임교사가 `/teacher` "학생관리" 탭에서 학생을 다중 선택하여, 학생별 QR 카드를
A4 한 장에 칸 구분으로 일괄 인쇄해 학생에게 배부할 수 있게 한다. 출력된 카드는
식당 입구 태블릿(`/check`)에서 스캔해 석식/조식/중식 체크인에 사용한다.

## 2. 비목표 (Non-goals)

- 단일 학생 전용 모달/단건 인쇄 흐름 — 1명만 체크하면 동일하게 처리되므로 별도 경로를 두지 않는다.
- 온라인 모드 전용 태블릿(미동기) 지원 — 운영은 로컬 모드 위주이므로 범위 외.
- 학생 본인 앱(`/student`)의 화면 QR 변경 — 기존 3분 만료 흐름 유지.
- 새 DB 컬럼·마이그레이션 — 기존 `qrGeneration`(SystemSetting)만 재사용한다.

## 3. QR 문자열 설계 (영구 식별)

카드에 인쇄되는 QR 페이로드는 **고정 로컬 QR 문자열**이다:

```
posanmeal:{studentId}:{qrGeneration}:STUDENT
```

- 4-part 형식(`mealKind` 생략). `/check`의 `parseLocalQR`이 4-part를 허용하며,
  `mealKind`가 없으면 스캔 시각으로 `resolveMealKindLocal`이 조/중/석을 자동 판정한다.
  → **한 장의 카드가 모든 식사에 사용 가능**.
- `qrGeneration`은 `getCachedSettings().qrGeneration`(SystemSetting). 관리자가
  "QR 강제 갱신"으로 회전시키기 전까지 **고정**이다.
- 만료(JWT exp) 없음. `/check`의 `handleLocalScan`이 `generation` 불일치 시
  "QR코드가 만료되었습니다"로 거부 → **관리자 강제 갱신이 전체 출력 카드의 일괄 무효화 수단**.

`/api/qr/token`의 로컬 모드 응답(`posanmeal:{id}:{gen}:{type}:{mealKind}`, 5-part)과
달리 카드는 `mealKind`를 의도적으로 뺀다. 그 외 형식·routing(`handleScan`이
`posanmeal:` 접두 QR을 항상 `handleLocalScan`으로 보냄)은 기존 그대로 동작한다.

## 4. 서버 변경 — `/api/teacher/students`

응답의 각 student 객체에 `qrString` 필드를 추가한다.

- `getCachedSettings()`로 `qrGeneration`을 1회 읽어, 학생별로
  `posanmeal:${s.id}:${qrGeneration}:STUDENT`를 합성.
- 담임 권한 검증(요청 교사의 `homeroom` → `grade`/`classNum` 매칭)은 **기존 로직 그대로**.
  학생 목록 자체가 담임 학급으로 제한되므로 추가 권한 코드 불필요.
- `useTeacherStudents`의 `Student` 인터페이스에 `qrString: string` 추가.

별도 라우트(`/api/teacher/students/[id]/qr-card`)는 만들지 않는다(표가 이미 보유한
데이터로 충분, 모달 즉시 오픈).

## 5. 선택 UI — `StudentTable`

### 5.1 체크박스 열
- 기존 sticky-left 첫 셀(`번호 이름`) 안에 체크박스를 추가: `[☐] {번호} {이름}`.
- 셀 전체가 클릭/탭 시 해당 학생 선택을 토글(라벨 영역 확대로 터치 타깃 확보).
- 헤더의 sticky-left 셀에 **전체선택 체크박스**(현재 표시된 학생 전체 토글,
  indeterminate 상태 지원).
- 선택 상태는 `Set<number>`(studentId)로 `StudentTable` 로컬 state.
  월 변경으로 학생 목록이 바뀌어도 선택은 id 기준으로 유지(존재하지 않는 id는 무시).

### 5.2 툴바
표 위에 한 줄 툴바:
- 좌측: "N명 선택" 텍스트.
- 우측: **"QR출력" 버튼**(Printer 아이콘). 선택 0명이면 `disabled`.

기존 월 이동 헤더(prev/타이틀/next)는 유지하고, 그 아래(또는 같은 줄 우측)에 툴바를 배치한다.

## 6. 단일 카드 컴포넌트 — `StudentQRCard`

프레젠테이션 컴포넌트. props: `{ grade, classNum, number, name, qrDataUrl }`.

레이아웃(세로, ≈47×47mm 정사각, 컷 가이드 보더):
1. 상단: `/meal.png` 로고 + "PosanMeal" 워드마크(한 줄).
2. 중단: `{grade}학년 {classNum}반 {number}번 {name}` — **한 행**, `whitespace-nowrap`,
   폭에 맞춰 폰트 스케일(긴 이름 대비). 학교명 없음.
3. 하단: QR 이미지(가능한 크게, 카드 폭의 대부분 차지).

치수는 mm 단위로 고정해 인쇄 물리 크기를 보장한다. 화면 미리보기에서도 동일 컴포넌트 재사용.

## 7. 일괄 인쇄 — `StudentQRPrintDialog`

"QR출력" 클릭 시 동작:

1. 선택된 학생들(id·grade·classNum·number·name·qrString)을 모달에 전달.
2. 모달에서 학생별 QR 이미지를 `qrcode` 라이브러리로 생성
   (`QRCode.toDataURL(qrString, ...)`, `QRGenerator`와 동일 방식). 비동기 생성 완료 후 렌더.
3. **미리보기**: A4 비율 시트를 화면에 표시(인쇄 전 명단 확인). 모달 우측 상단에 "인쇄" 버튼.
4. 레이아웃: **4열 그리드**, 페이지당 **4행 = 16개**. 선택 인원을 16개 단위로 청크 →
   각 청크를 `.qr-page` 컨테이너로 렌더, 페이지 경계는 `break-after: page`.
   각 카드는 `break-inside: avoid` + 컷 보더.
5. "인쇄" → `window.print()`. 인쇄 CSS:
   - `@media print { body * { visibility: hidden } #qr-print-sheet, #qr-print-sheet * { visibility: visible } #qr-print-sheet { position: absolute; left: 0; top: 0 } }`
   - `@page { size: A4; margin: 8mm }`
   - 카드 ≈47mm × 4열 = 188mm ≤ A4 인쇄 가능 폭(≈194mm).

카드 외 화면 요소(모달 backdrop, 헤더 등)는 `visibility: hidden`으로 인쇄 제외.
인쇄 CSS는 모달이 열려 있는 동안에만 의미가 있으므로 모달 컴포넌트 스코프에 둔다.

## 8. 데이터 흐름

```
/api/teacher/students  ──(qrString 포함)──▶  useTeacherStudents
        │                                          │
        ▼                                          ▼
   getCachedSettings().qrGeneration          StudentTable
   posanmeal:{id}:{gen}:STUDENT          (체크박스 선택 Set<number>)
                                                   │ QR출력 클릭
                                                   ▼
                                       StudentQRPrintDialog
                                   (qrcode→dataURL, A4 4×4 그리드)
                                                   │ 인쇄
                                                   ▼
                                       window.print()  →  A4 출력
                                                   │ 학생 배부
                                                   ▼
                            /check 태블릿(로컬 모드) handleLocalScan
                         generation 일치 + 자격 + 미중복 → 체크인
```

## 9. 엣지 케이스 / 제약

- **태블릿 동기화 전제**: 로컬 모드 태블릿의 IndexedDB에 학생·자격 데이터가 동기화돼
  있어야 스캔 동작. 미동기 시 "미등록 사용자". (로컬 모드 위주 운영이므로 수용)
- **강제 갱신 무효화**: 관리자 `qrGeneration` 회전 시 기 발급 카드 전부 무효 → 재출력 필요(합의됨).
- **미신청 학생**: 카드 출력은 가능. 스캔 시 자격 없으면 "오늘 OO 신청 내역이 없습니다"(정상).
- **긴 이름**: 식별 행은 `whitespace-nowrap` + 폰트 스케일로 한 줄 유지(줄바꿈 금지 규칙 준수).
- **선택 유지**: 월 이동 시에도 선택 Set 유지. 0명이면 QR출력 비활성.
- **다수 인원**: 16명 초과 시 자동 페이지 분할(예: 40명 → 3페이지).

## 10. 테스트

- `qr-token`/문자열 합성: `posanmeal:{id}:{gen}:STUDENT` 형식이 `parseLocalQR`(4-part,
  mealKind undefined)와 호환됨을 단위 테스트로 확인(파서는 check 페이지 내부 함수이므로,
  형식 계약을 검증하는 테스트를 추가하거나 파서를 lib로 추출 검토).
- `/api/teacher/students` 응답에 `qrString`이 올바른 generation으로 포함되는지(가능 범위에서).
- 16개 청크/페이지 분할 로직 단위 테스트.
- 수동: 실제 A4 인쇄 → 카드 물리 크기·QR 스캔 동작(로컬 모드 태블릿) 확인.

## 11. 생성/수정 파일

**수정**
- `src/app/api/teacher/students/route.ts` — 응답에 `qrString` 추가.
- `src/hooks/useTeacherStudents.ts` — `Student.qrString` 타입 추가.
- `src/components/StudentTable.tsx` — 체크박스 열·전체선택·툴바·QR출력 버튼·선택 state.

**생성**
- `src/components/StudentQRCard.tsx` — 단일 카드 프레젠테이션.
- `src/components/StudentQRPrintDialog.tsx` — 미리보기 모달 + A4 그리드 + 인쇄.
- (선택) `src/lib/qr-card.ts` — `buildCardQrString(id, generation)` 등 문자열 합성/청크 유틸(테스트 대상).

**비변경(중요)**
- `/api/checkin`, `/check`의 `handleLocalScan`/`parseLocalQR` — 기존 4-part 처리로 그대로 동작.
