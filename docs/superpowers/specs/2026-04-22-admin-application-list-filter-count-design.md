# 신청 명단 모달 — 학년별 인원 반영 · 연번 열 · 취소자 토글

작성일: 2026-04-22
대상: 관리자 페이지 `/admin` → 신청관리 탭 → 신청 명단 모달

## 1. 배경

신청 명단 모달의 학년 필터(전체/1/2/3학년)는 이미 동작하지만, 다음 두 가지가 충족되지 않는다.

1. 모달 제목의 `— 명단 (N명)`이 항상 전체 승인자 수를 보여줌. 학년 탭을 눌러도 N이 변하지 않는다.
2. 테이블에 연번이 없어 현재 화면의 명단 인원을 시각적으로 추적하기 어렵다.

## 2. 범위

`src/app/admin/page.tsx`의 신청 명단 모달(`regDialogOpen`) 부분만 수정한다. 다음은 건드리지 않는다.

- API(`/api/admin/applications/**`)
- DB 스키마
- 엑셀 임포트/익스포트 로직
- 공고 카드의 요약 표시(`신청 N명 (취소 M명)`)
- 학생/교사/체크인 UI

## 3. 요구사항

### 3.1 제목 카운트의 필터 반응

- 모달 제목 형식: `{공고 제목} — 명단 ({인원수}명)`
- `{인원수}`는 **현재 학년 필터가 적용된 승인(APPROVED) 건수**로 계산한다.
  - 전체 탭: 취소를 제외한 전체 승인자 수
  - 1/2/3학년 탭: 해당 학년의 승인자 수
- 취소(CANCELLED) 상태는 제목 카운트에 포함하지 않는다. 취소자 토글을 켜도 변하지 않는다.

### 3.2 연번 열

- 테이블 첫 열로 `연번` 추가.
- 연번은 **승인(APPROVED) 행에만 부여**한다. 정렬(학년 → 반 → 번호) · 학년 필터가 적용된 결과의 승인 행에 1부터 순서대로.
- 취소 행의 연번 셀은 `—`로 표시한다(연번을 매기지 않음).
- 불변: **마지막 연번 값 = 제목의 `{인원수}`**.

### 3.3 취소자 보기 토글

- 학년 필터 버튼 행 우측에 `취소자 보기` 토글 버튼 배치.
- 기본값: OFF(취소 행 숨김).
- OFF일 때: 승인 행만 테이블에 표시. 복원 버튼은 보이지 않는다.
- ON일 때: 취소 행도 테이블에 표시되며, 각 취소 행에 기존 `복원` 버튼 노출.
- 모달이 닫혔다 다시 열리면 토글은 OFF로 초기화한다.

## 4. 구현 설계

### 4.1 상태

```ts
const [showCancelled, setShowCancelled] = useState(false);
```

### 4.2 파생 데이터 (useMemo)

```ts
const visibleRegs = useMemo(() => {
  return registrations
    .filter(r => showCancelled || r.status !== "CANCELLED")
    .filter(r => regGradeFilter === null || r.user.grade === regGradeFilter)
    .sort((a, b) =>
      a.user.grade - b.user.grade ||
      a.user.classNum - b.user.classNum ||
      a.user.number - b.user.number
    );
}, [registrations, showCancelled, regGradeFilter]);

const approvedCount = useMemo(
  () => visibleRegs.filter(r => r.status !== "CANCELLED").length,
  [visibleRegs]
);
```

### 4.3 제목

```tsx
<span>{selectedAppForReg?.title} — 명단 ({approvedCount}명)</span>
```

### 4.4 필터 행

```tsx
<div className="flex gap-2 mb-3 items-center flex-wrap">
  {[{ value: null, label: "전체" }, ...].map(...)}
  <Button
    variant={showCancelled ? "default" : "outline"}
    size="sm"
    onClick={() => setShowCancelled(v => !v)}
    className="ml-auto whitespace-nowrap"
  >
    취소자 보기
  </Button>
</div>
```

### 4.5 테이블

- `thead`에 `<th>연번</th>`를 맨 앞에 추가. `sticky top-0 z-20` 유지, 배경색 명시.
- 렌더 시 승인 행에만 연번을 매긴다(취소 행은 `—`):
  ```tsx
  {(() => {
    let seq = 0;
    return visibleRegs.map((r) => {
      const n = r.status !== "CANCELLED" ? ++seq : null;
      return (
        <tr key={r.id} className="border-t">
          <td className="p-2 whitespace-nowrap">{n ?? "—"}</td>
          {/* 나머지 셀 유지 */}
        </tr>
      );
    });
  })()}
  ```
- 기존 정렬·필터는 `visibleRegs`가 담당하므로 인라인 `.sort()` 제거.
- 각 셀은 `whitespace-nowrap` 유지.

### 4.6 모달 리셋

기존 `onOpenChange`:
```ts
onOpenChange={(open) => {
  setRegDialogOpen(open);
  if (!open) {
    setSelectedAppForReg(null);
    setRegistrations([]);
    setShowCancelled(false);   // 추가
    setRegGradeFilter(null);   // 필터도 초기화(명시적)
  }
}}
```

## 5. 반응형 체크

- 연번 열 추가로 가로폭 증가 → 기존 모달의 테이블 래퍼 `overflow-auto`에 의해 가로 스크롤 수용.
- 필터 + 토글이 한 행에 못 담기는 경우 `flex-wrap`으로 자연스럽게 줄바꿈. 버튼 라벨은 `whitespace-nowrap`.
- 토글 버튼 최소 크기 44px 높이(shadcn `size="sm"`이 h-9 → 터치 타겟 허용 범위).

## 6. 수용 기준

1. 전체 탭 선택 시 제목은 `{제목} — 명단 ({전체 승인자 수}명)`.
2. 1학년 탭 선택 시 제목은 `{제목} — 명단 ({1학년 승인자 수}명)`, 테이블에는 1학년 승인 행만 표시.
3. 각 승인 행의 맨 앞 셀에 `1, 2, 3, …` 연번이 순서대로 표시되고, 마지막 연번 값은 제목의 `{인원수}`와 일치한다. 취소 행이 섞여 있더라도 취소 행은 `—`로 표시되어 승인자 번호를 흐트러뜨리지 않는다.
4. 취소자 보기 OFF(기본)일 때 취소 행이 보이지 않고 복원 버튼도 보이지 않는다.
5. 취소자 보기 ON일 때 취소 행이 포함되고 각 취소 행에 복원 버튼이 노출된다. 제목 카운트에는 취소 행이 포함되지 않는다.
6. 취소/복원/학생 추가 동작 후에도 목록이 최신 상태로 갱신되고 카운트·연번이 즉시 반영된다.
7. 모달을 닫았다 다시 열면 학년 필터는 "전체", 취소자 보기는 OFF로 초기화된다.

## 7. 영향 분석

| 파일 | 변경 | 비고 |
|------|------|------|
| `src/app/admin/page.tsx` | 수정 | 신청 명단 모달 블록(대략 1000~1070 라인) |

다른 파일 변경 없음. DB/API 변경 없음.

## 8. 비범위

- 엑셀 다운로드의 필터 반영 여부 — 현재 동작 유지(서버가 전체 승인자 내보냄).
- 공고 카드의 요약 수치 변경 없음.
- 학생 추가 다이얼로그의 동작 변경 없음.
