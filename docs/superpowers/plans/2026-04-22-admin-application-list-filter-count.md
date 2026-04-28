# 신청 명단 모달 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` 신청관리 탭의 신청 명단 모달에서 (1) 학년 필터에 반응하는 제목 인원수, (2) 승인 행 전용 연번 열, (3) 취소자 보기 토글을 도입한다.

**Architecture:** `src/app/admin/page.tsx` 내부의 신청 명단 모달 블록만 수정한다. DB/API/서버 변경 없음. 파생 상태(`useMemo`)로 필터 + 정렬 + 취소 숨김을 한 곳에 모으고, 테이블 렌더링과 제목 카운트가 같은 소스를 사용하도록 만든다.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui (Dialog, Button).

**관련 스펙:** [docs/superpowers/specs/2026-04-22-admin-application-list-filter-count-design.md](../specs/2026-04-22-admin-application-list-filter-count-design.md)

**테스트 전략:** 프로젝트에 유닛 테스트 프레임워크가 없다. 검증은 (a) `npm run lint`, (b) `npm run build` 성공, (c) `npm run dev`로 띄운 뒤 관리자로 로그인 → 신청관리 탭 → 명단 모달 수동 확인. 각 단계 수용 기준은 스펙 §6 참조.

---

## File Structure

**수정 파일** (1개, 신규 없음):
- `src/app/admin/page.tsx`
  - 상단 상태 훅 구역(약 70~110 라인)에 `showCancelled` 상태 추가
  - 파생 값 구역(`useMemo` 사용부, 486~512 라인 근처)에 `visibleRegs`, `approvedCount` 추가
  - 모달 JSX(`regDialogOpen` 해당 Dialog, 약 1000~1068 라인)의 제목·필터행·테이블·onOpenChange 수정

---

## Task 1: 파생 상태 도입 + 테이블 소스 교체

**Files:**
- Modify: `src/app/admin/page.tsx`

이 태스크는 "행동 변화 없이" 테이블이 사용하는 데이터 흐름을 `visibleRegs` 하나로 통일한다. 이후 태스크는 여기서 파생된다.

- [ ] **Step 1: `showCancelled` 상태 추가**

`registrations` 상태 선언 바로 아래(약 97번 라인 부근)에 다음을 추가:

```tsx
const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);
const [showCancelled, setShowCancelled] = useState(false);   // 추가
```

- [ ] **Step 2: `visibleRegs`, `approvedCount` useMemo 추가**

기존 `filteredStudentsForAdd` useMemo 바로 위(약 485번 라인 부근)에 삽입:

```tsx
const visibleRegs = useMemo(() => {
  return registrations
    .filter((r) => showCancelled || r.status !== "CANCELLED")
    .filter((r) => regGradeFilter === null || r.user.grade === regGradeFilter)
    .sort((a, b) => {
      if (a.user.grade !== b.user.grade) return a.user.grade - b.user.grade;
      if (a.user.classNum !== b.user.classNum) return a.user.classNum - b.user.classNum;
      return a.user.number - b.user.number;
    });
}, [registrations, showCancelled, regGradeFilter]);

const approvedCount = useMemo(
  () => visibleRegs.filter((r) => r.status !== "CANCELLED").length,
  [visibleRegs],
);
```

- [ ] **Step 3: 테이블 tbody가 `visibleRegs`를 사용하도록 교체**

기존(약 1036~1063 라인) 인라인 `.filter(...).sort(...).map(...)` 체인을 `visibleRegs.map(...)`로 교체. 행 내용과 키는 동일하게 유지, 인덱스 사용은 다음 태스크에서:

```tsx
<tbody>
  {visibleRegs.map((r) => (
    <tr key={r.id} className="border-t">
      <td className="p-2 whitespace-nowrap">{r.user.grade}</td>
      <td className="p-2 whitespace-nowrap">{r.user.classNum}</td>
      <td className="p-2 whitespace-nowrap">{r.user.number}</td>
      <td className="p-2 whitespace-nowrap">{r.user.name}</td>
      <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
      <td className="p-2 text-center whitespace-nowrap">
        <Badge variant={r.status === "CANCELLED" ? "secondary" : "default"} className="text-xs">
          {r.status === "CANCELLED" ? "취소" : r.addedBy === "ADMIN" ? "관리자추가" : "승인"}
        </Badge>
      </td>
      <td className="p-2 text-center whitespace-nowrap">
        {r.status === "CANCELLED" ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRestoreReg(r.id)}>복원</Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleCancelReg(r.id)}>취소</Button>
        )}
      </td>
    </tr>
  ))}
</tbody>
```

- [ ] **Step 4: lint로 타입/구문 검증**

Run: `npm run lint`
Expected: 해당 파일에서 신규 경고·에러 없음. 기존 경고는 유지될 수 있음.

---

## Task 2: 제목 인원수를 `approvedCount`로 교체

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: DialogTitle의 카운트 식을 교체**

약 1004번 라인의 다음 줄:
```tsx
<span>{selectedAppForReg?.title} — 명단 ({registrations.filter((r) => r.status !== "CANCELLED").length}명)</span>
```
을 다음으로 교체:
```tsx
<span>{selectedAppForReg?.title} — 명단 ({approvedCount}명)</span>
```

- [ ] **Step 2: lint 재검증**

Run: `npm run lint`
Expected: 에러 없음.

---

## Task 3: "취소자 보기" 토글 버튼 추가

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 필터 행에 토글 버튼 추가**

약 1017~1021 라인의 필터 행을 다음으로 교체:

```tsx
<div className="flex gap-2 mb-3 items-center flex-wrap">
  {[{ value: null, label: "전체" }, { value: 1, label: "1학년" }, { value: 2, label: "2학년" }, { value: 3, label: "3학년" }].map(({ value, label }) => (
    <Button
      key={label}
      variant={regGradeFilter === value ? "default" : "outline"}
      size="sm"
      onClick={() => setRegGradeFilter(value)}
      className="whitespace-nowrap"
    >
      {label}
    </Button>
  ))}
  <Button
    variant={showCancelled ? "default" : "outline"}
    size="sm"
    onClick={() => setShowCancelled((v) => !v)}
    className="ml-auto whitespace-nowrap"
  >
    취소자 보기
  </Button>
</div>
```

변경 요점: 래퍼에 `items-center flex-wrap` 추가, 각 학년 버튼에 `whitespace-nowrap` 추가(라벨 줄바꿈 방지 규칙), 토글 버튼을 `ml-auto`로 우측 배치.

---

## Task 4: 연번 열 추가 (승인 행 전용)

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: thead에 `연번` 추가**

약 1024~1033 라인의 `<thead>` 안 `<tr>`에 맨 앞 셀로 다음을 삽입:

```tsx
<th className="p-2 text-left bg-muted whitespace-nowrap">연번</th>
```

결과 예시:
```tsx
<thead className="sticky top-0 z-20">
  <tr>
    <th className="p-2 text-left bg-muted whitespace-nowrap">연번</th>
    <th className="p-2 text-left bg-muted whitespace-nowrap">학년</th>
    {/* ... 나머지 동일 */}
  </tr>
</thead>
```

- [ ] **Step 2: tbody를 승인 행에만 연번을 매기는 형태로 교체**

Task 1에서 도입한 `tbody`를 다음으로 교체(IIFE로 seq 카운터 유지):

```tsx
<tbody>
  {(() => {
    let seq = 0;
    return visibleRegs.map((r) => {
      const n = r.status !== "CANCELLED" ? ++seq : null;
      return (
        <tr key={r.id} className="border-t">
          <td className="p-2 whitespace-nowrap">{n ?? "—"}</td>
          <td className="p-2 whitespace-nowrap">{r.user.grade}</td>
          <td className="p-2 whitespace-nowrap">{r.user.classNum}</td>
          <td className="p-2 whitespace-nowrap">{r.user.number}</td>
          <td className="p-2 whitespace-nowrap">{r.user.name}</td>
          <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
          <td className="p-2 text-center whitespace-nowrap">
            <Badge variant={r.status === "CANCELLED" ? "secondary" : "default"} className="text-xs">
              {r.status === "CANCELLED" ? "취소" : r.addedBy === "ADMIN" ? "관리자추가" : "승인"}
            </Badge>
          </td>
          <td className="p-2 text-center whitespace-nowrap">
            {r.status === "CANCELLED" ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRestoreReg(r.id)}>복원</Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => handleCancelReg(r.id)}>취소</Button>
            )}
          </td>
        </tr>
      );
    });
  })()}
</tbody>
```

- [ ] **Step 3: lint 재검증**

Run: `npm run lint`
Expected: 에러 없음.

---

## Task 5: 다이얼로그 닫힐 때 상태 리셋

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: onOpenChange 콜백 확장**

약 1000번 라인의 Registration List Dialog `onOpenChange`를 다음으로 교체:

```tsx
<Dialog
  open={regDialogOpen}
  onOpenChange={(open) => {
    setRegDialogOpen(open);
    if (!open) {
      setSelectedAppForReg(null);
      setRegistrations([]);
      setRegGradeFilter(null);
      setShowCancelled(false);
    }
  }}
>
```

기존에는 `setSelectedAppForReg(null); setRegistrations([]);`만 호출했다. 학년 필터·취소자 토글도 함께 초기화한다.

---

## Task 6: 최종 검증 + 커밋

**Files:** 없음 (검증 단계)

- [ ] **Step 1: 전체 lint**

Run: `npm run lint`
Expected: 새 경고/에러 없음. `src/app/admin/page.tsx`에 변경된 내용만 반영.

- [ ] **Step 2: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공(0 errors). 기존 `(pageExtensions/standalone 등)` 설정 이상 징후 없음.

- [ ] **Step 3: 개발 서버로 수동 검증**

Run: `npm run dev`
Expected URL: `http://localhost:3000`

다음 체크리스트를 수행하여 스펙 §6의 수용 기준을 확인:

1. 관리자 계정으로 로그인 → `/admin` → `신청관리` 탭으로 이동.
2. 임의의 공고에서 `명단`(Users 아이콘) 클릭 → 모달 오픈.
3. 모달 제목 `{제목} — 명단 (N명)`의 N이 현재 승인자 총원과 일치.
4. `1학년` 탭 클릭 → 제목의 N이 1학년 승인자 수로 변함. 테이블에 1학년 승인 행만 표시.
5. 첫 열 `연번`이 1, 2, 3 … 순서로 표시되고 마지막 연번 = 제목 N과 일치.
6. `전체` 탭 복귀 → N·연번이 전체 기준으로 돌아옴.
7. 승인 행 "취소" 버튼 클릭 → 행이 즉시 사라지고(기본 OFF) N 감소.
8. `취소자 보기` 토글 ON → 취소 행이 섞여 나타남. 취소 행의 연번 셀은 `—`. 각 취소 행에 `복원` 버튼 노출.
9. 취소 행 `복원` → 행이 승인으로 바뀌고 N·연번 즉시 반영.
10. 모달 닫기 후 재오픈 → 필터 `전체`, 토글 OFF로 초기화.
11. 모바일 뷰포트(Chrome DevTools 375px)에서 모달 열기 → 필터 버튼과 토글이 `flex-wrap`으로 자연스럽게 두 줄, 버튼 라벨에 줄바꿈 없음, 테이블은 가로 스크롤.

실패 항목이 있으면 해당 Task로 돌아가 수정.

- [ ] **Step 4: 커밋**

변경 파일은 `src/app/admin/page.tsx` 하나.

```bash
git add src/app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): 신청 명단 모달에 학년별 카운트/연번/취소자 토글

- 제목 인원수를 현재 학년 필터 기준 승인자 수로 반응
- 승인 행에만 매기는 연번 열 추가(마지막 연번 = 제목 인원수)
- 취소자 보기 토글 — 기본 OFF, ON 시 취소/복원 동선 노출
- 모달 닫힐 때 학년 필터·토글 초기화

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: PROJECT_MAP 갱신 권고**

세션 종료 전 `project-map-keeper` 에이전트 호출(규칙에 따름). 이 변경은 API/모델 변경이 없으므로 맵의 구조적 섹션에 영향은 작지만, 이전 pending 로그가 남아있으므로 한 번 정리해둔다.

---

## Self-Review Notes

- **스펙 coverage:**
  - §3.1 제목 카운트 필터 반응 → Task 1, 2
  - §3.2 연번 열(승인 행 전용, 취소는 `—`) → Task 4
  - §3.3 취소자 보기 토글 → Task 3
  - §4.6 모달 리셋 → Task 5
  - §6 수용 기준 전체 → Task 6 수동 검증 체크리스트 1~11
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 블록이 완성된 상태.
- **Type consistency:** `RegistrationItem`, `regGradeFilter`, `setShowCancelled`, `visibleRegs`, `approvedCount` 모든 태스크에서 동일 식별자로 사용.
- **유닛 테스트 부재 보완:** 프로젝트에 테스트 프레임워크가 없으므로 Task 6의 수동 검증 체크리스트가 수용 기준의 실질적 검증 수단이다.
