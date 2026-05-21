# 관리자 사용자 관리 표 — Inline 셀 편집 설계

> 작성일: 2026-05-21
> 관련 페이지: `/admin` 사용자 관리 탭

## 1. 배경 / 목표

현재 사용자 관리 표는 행마다 ✏️ 편집 버튼을 누르면 별도의 Edit Dialog가 열리는 구조. 학생 backfill(성별), 학년·반·번호 정정, 이메일 오타 수정 등 자주 발생하는 단일 필드 변경에 모달 왕복은 부담이다.

표에서 셀을 클릭하면 바로 입력 필드로 변환되어 수정·저장하는 **inline 편집** 흐름으로 바꾼다. Edit Dialog는 제거하고 Add Dialog만 신규 등록용으로 유지한다.

## 2. 범위

### 포함
- 사용자 관리 표(학생 탭·교사 탭) 모든 데이터 셀의 inline 편집
- 학년-반-번호 결합 셀을 **3개 독립 컬럼**으로 분리
- 교과/담임 결합 셀을 **2개 독립 컬럼**으로 분리
- Edit Dialog와 관련 state·핸들러·import 완전 제거
- 권한 select inline의 `EditableSelectCell` 마이그레이션
- 재사용 `EditableTextCell` / `EditableSelectCell` 컴포넌트 도입
- 셀 단위 클라이언트 검증 + 서버 에러 토스트 + Escape/blur 동작
- responsive-ui 규칙 준수

### 범위 밖
- 신규 등록 Add Dialog (그대로 유지)
- 사용자 표의 정렬·검색·필터 (현재 없음, 이번 작업과 별개)
- 일괄 편집·undo·변경 히스토리
- 동시 편집 충돌 감지 (last-write-wins 유지)
- Sheet 임포트 모달 (변경 없음)
- 첫 컬럼 sticky (가로 스크롤 UX 개선)
- `/api/admin/users` API 변경 (부분 업데이트는 이미 지원)

## 3. 결정사항 요약

| # | 결정 | 근거 |
|---|---|---|
| 1 | 인터랙션: 셀 클릭 → 입력 활성 | Excel/Notion 표준, 가독성·편집성 균형 우수 |
| 2 | Edit Dialog 완전 제거 | inline이 충분 강력, 코드 단순화 |
| 3 | 학년-반-번호 컬럼 분리, 교과/담임도 분리 | 셀별 단일 input으로 inline 편집 자연스러움 |
| 4 | 저장 트리거: blur · Enter (자동), Escape 취소 | 행정 업무 표준 |
| 5 | 비낙관 업데이트 (API 응답 후 setUsers) | 단순성·일관성, ~100ms 지연 무시 가능 |
| 6 | 재사용 컴포넌트 1개 파일(2 export) | page.tsx 비대화 방지, 분기 흡수 |
| 7 | 학생 탭에서 권한 컬럼 자체 제거 | 학생은 항상 N/A, "—" 컬럼 폭 낭비 |
| 8 | API 변경 없음 | 기존 PUT 부분 업데이트 지원 |

## 4. 표 컬럼 구조

### 4-1. 학생 탭 (7컬럼)

| 헤더 | 폭 | 편집 |
|---|---|---|
| 이름 | 자동 | `EditableTextCell` |
| 학년 | `w-12` | `EditableTextCell inputType="number"` |
| 반 | `w-12` | `EditableTextCell inputType="number"` |
| 번호 | `w-12` | `EditableTextCell inputType="number"` |
| 이메일 | `max-w-[16rem]` viewing, full editing | `EditableTextCell` |
| 성별 | `w-14` | `EditableSelectCell` (남/여, 빈 옵션 없음) |
| 관리 | `w-24` | 🗑️ 삭제만 |

권한 컬럼은 학생 탭에서 **렌더링하지 않음**.

### 4-2. 교사 탭 (8컬럼)

| 헤더 | 편집 |
|---|---|
| 이름 | text |
| 교과명 | text |
| 담임 | text (빈 값 허용, placeholder "비담임") |
| 이메일 | text |
| 직책 | text |
| 성별 | select (남/여/—) |
| 권한 | select (일반/서브관리자/관리자) |
| 관리 | 🗑️ |

### 4-3. 표 구조 공통

- 표 래퍼: `border rounded-lg overflow-auto max-h-[70vh]` (현행 유지)
- `<table className="w-full text-sm whitespace-nowrap">` (현행 유지)
- `<thead className="sticky top-0 z-20">`, 헤더 셀 `bg-muted` (현행 유지)
- 모든 헤더/셀 `whitespace-nowrap`
- ✏️ Pencil 버튼 및 lucide-react Pencil import 제거 (Edit Dialog 제거에 수반)

## 5. 셀 편집 UX

### 5-1. 상태 머신

```
viewing  ─click/Enter/Space──> editing
editing  ─blur/Enter──> [validate] ─ok──> saving ─PUT 200──> viewing
                              │                    │
                              │                    └─실패──> editing (값 보존, toast)
                              └─실패──> editing (값 보존, toast)
editing  ─Escape──> viewing (draft 폐기)
```

### 5-2. 시각 표현

| 상태 | 시각 |
|---|---|
| viewing | 일반 텍스트. hover `bg-muted/40`, cursor-pointer |
| editing | 셀 안 `<input>` 또는 `<select>` autofocus, `ring-1 ring-primary` |
| saving | 입력 disabled, 우측 작은 spinner (1초 이내 보통 사라짐) |

### 5-3. 키보드

| 키 | viewing | editing |
|---|---|---|
| `Click` / `Enter` / `Space` | enter editing | — |
| `Enter` | enter editing | commit |
| `Escape` | — | cancel (draft 폐기) |
| `Tab` | 다음 viewing 셀로 focus 이동 (`tabIndex={0}` 덕분) | 셀 blur → commit. 포커스가 다음 viewing 셀로 이동, 자동 editing 진입은 안 함 — 사용자가 Enter/Space로 진입 |

### 5-4. 모바일

- 셀 탭 = 클릭과 동일
- editing 진입 시 셀이 가상 키보드에 가려지면 `inputRef.current?.scrollIntoView({ block: "nearest" })`로 자동 스크롤

## 6. 컴포넌트 구조

### 6-1. 파일: `src/components/EditableCell.tsx`

두 named export:

- `EditableTextCell` — text/number 통합 (inputType prop)
- `EditableSelectCell` — native `<select>` 기반

### 6-2. Props

```ts
export type SaveResult = { ok: true } | { ok: false; message: string };

interface CommonProps {
  value: string;
  onSave: (next: string) => Promise<SaveResult>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface EditableTextCellProps extends CommonProps {
  inputType?: "text" | "number";
  placeholder?: string;
  validate?: (next: string) => string | null;  // null=OK, string=에러 메시지
}

interface EditableSelectCellProps extends CommonProps {
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;  // 빈 값 옵션 노출 시 viewing 텍스트, default "—"
                        // 미지정 시 빈 값 옵션 없음 (필수 선택)
}
```

### 6-3. 내부 동작 (text 변형 의사코드)

```ts
const [editing, setEditing] = useState(false);
const [draft, setDraft] = useState(value);
const [saving, setSaving] = useState(false);
const inputRef = useRef<HTMLInputElement | null>(null);

useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
useEffect(() => {
  if (editing && inputRef.current) {
    inputRef.current.focus();
    inputRef.current.select();
    inputRef.current.scrollIntoView({ block: "nearest" });
  }
}, [editing]);

function enter() {
  if (disabled) return;
  setDraft(value); setEditing(true);
}

async function commit() {
  if (draft === value) { setEditing(false); return; }
  const err = validate?.(draft);
  if (err) { toast.error(err); /* editing 유지 */ return; }
  setSaving(true);
  const r = await onSave(draft);
  setSaving(false);
  if (r.ok) setEditing(false);
  else {
    if (r.message) toast.error(r.message);
    /* editing 유지, draft 보존 */
  }
}

function cancel() { setDraft(value); setEditing(false); }
```

### 6-4. Select 변형 차이

- `onChange`에서 즉시 commit (사용자가 다른 옵션 선택 = 명시적 변경)
- Escape는 cancel
- blur는 commit
- `emptyLabel`이 지정된 경우 `<option value="">{emptyLabel}</option>` 첫 자리에 노출

## 7. 서버 통신

### 7-1. PUT 부분 업데이트

기존 `/api/admin/users` PUT은 받은 키만 업데이트(Prisma가 undefined 무시). 한 셀씩 PUT:

```http
PUT /api/admin/users
Content-Type: application/json
{ "id": 42, "name": "김학생" }
```

서버는 검증(Task 3) 그대로 적용:
- gender 형식 검증
- 학생 gender null 거부
- adminLevel 형식 + 자가 강등 차단

### 7-2. `saveUserField` 헬퍼 (`admin/page.tsx`)

```ts
type EditableField =
  | "name" | "email"
  | "grade" | "classNum" | "number"
  | "subject" | "homeroom" | "position"
  | "gender";

async function saveUserField(id: number, field: EditableField, next: string): Promise<SaveResult> {
  const body: Record<string, unknown> = { id };
  let normalizedNext: unknown = next;

  if (field === "grade" || field === "classNum" || field === "number") {
    const n = parseInt(next);
    if (isNaN(n)) {
      const label = field === "grade" ? "학년" : field === "classNum" ? "반" : "번호";
      return { ok: false, message: `${label}은(는) 숫자여야 합니다.` };
    }
    body[field] = n;
    normalizedNext = n;
  } else if (field === "gender") {
    const g = next === "" ? null : next;
    body.gender = g;
    normalizedNext = g;
  } else {
    body[field] = next;
  }

  let res: Response;
  try {
    res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "네트워크 오류입니다." };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data?.reason ?? "수정에 실패했습니다." };
  }
  setUsers((prev) => prev.map((u) => u.id === id ? { ...u, [field]: normalizedNext } as User : u));
  return { ok: true };
}
```

### 7-3. `saveAdminLevel` 헬퍼 (권한 전용)

`handleAdminLevelChange`를 다음으로 일반화:

```ts
async function saveAdminLevel(id: number, next: "NONE" | "SUBADMIN" | "ADMIN"): Promise<SaveResult> {
  const target = users.find((u) => u.id === id);
  if (!target) return { ok: false, message: "사용자를 찾을 수 없습니다." };
  if (target.adminLevel === next) return { ok: true };

  const labelMap = { NONE: "일반", SUBADMIN: "서브관리자", ADMIN: "관리자" } as const;
  if (!confirm(`${target.name} 의 권한을 ${labelMap[next]}(으)로 변경할까요?`)) {
    return { ok: false, message: "" };  // 메시지 빈 값 = 토스트 표시 안 함
  }

  const body = { id, adminLevel: next };
  let res: Response;
  try {
    res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "네트워크 오류입니다." };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data?.reason ?? "권한 변경에 실패했습니다." };
  }
  setUsers((prev) => prev.map((u) => u.id === id ? { ...u, adminLevel: next } : u));
  return { ok: true };
}
```

### 7-4. 응답 매핑

| 응답 | toast | 셀 상태 |
|---|---|---|
| 200 | (없음) | viewing (값 갱신) |
| 400 + `{reason}` | reason | editing 유지, draft 보존 |
| 403 | "권한이 부족합니다." | editing 유지 |
| 5xx / JSON 실패 | "수정에 실패했습니다." | editing 유지 |
| fetch reject | "네트워크 오류입니다." | editing 유지 |
| confirm 거부 (권한만) | (없음, 메시지 빈 값) | viewing (원래 값) |

## 8. 클라이언트 검증

| 필드 | validate |
|---|---|
| `name` | `trim() === ""` → "이름은 비울 수 없습니다." |
| `email` | `trim() === ""` 또는 `!includes("@")` → "이메일 형식이 올바르지 않습니다." |
| `grade` / `classNum` / `number` | `isNaN(parseInt) || parseInt < 1` → "{학년/반/번호}은(는) 1 이상 정수여야 합니다." |
| `subject` (교사) | `trim() === ""` → "교과명은 비울 수 없습니다." |
| `position` (교사) | `trim() === ""` → "직책은 비울 수 없습니다." |
| `homeroom` (교사) | 검증 없음 (비담임은 빈 값 허용) |
| `gender` (학생) | select에 빈 옵션 없음 → 사용자가 빈 값 만들 수 없음 |
| `gender` (교사) | 빈 옵션 허용, 추가 검증 없음 |

## 9. 표 마크업 예시 (학생 행)

```tsx
{users.map((u) => (
  <tr key={u.id} className="border-t">
    <td className="p-0">
      <EditableTextCell
        value={u.name}
        ariaLabel={`${u.name} 이름`}
        validate={(v) => v.trim() === "" ? "이름은 비울 수 없습니다." : null}
        onSave={(next) => saveUserField(u.id, "name", next)}
      />
    </td>
    <td className="p-0 w-12">
      <EditableTextCell
        value={u.grade?.toString() ?? ""}
        inputType="number"
        ariaLabel={`${u.name} 학년`}
        validate={(v) => {
          const n = parseInt(v);
          return isNaN(n) || n < 1 ? "학년은 1 이상 정수여야 합니다." : null;
        }}
        onSave={(next) => saveUserField(u.id, "grade", next)}
      />
    </td>
    {/* 반·번호: 학년과 동일 — validate는 각각 "반은 …", "번호는 …" 메시지로 분기 */}
    {/* 이메일: validate는 `trim()===""` 또는 `!includes("@")` 체크. width 클래스 차이만, 나머지는 학년 패턴과 동일 */}
    <td className="p-0 w-14">
      <EditableSelectCell
        value={u.gender ?? ""}
        options={[
          { value: "MALE", label: "남" },
          { value: "FEMALE", label: "여" },
        ]}
        ariaLabel={`${u.name} 성별`}
        onSave={(next) => saveUserField(u.id, "gender", next)}
      />
    </td>
    <td className="p-2 text-center w-24">
      {adminPerm.canWrite && (
        <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(u.id)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </td>
  </tr>
))}
```

> `<td className="p-0">`로 셀 내부를 컴포넌트가 채우게 두고 패딩은 컴포넌트의 viewing/editing 마크업이 직접 처리한다.

## 10. 반응형 UI 점검

| 규칙 | 적용 |
|---|---|
| §1 화면 활용 | 표 래퍼 `overflow-auto` 유지 |
| §2 줄바꿈 금지 | 모든 셀·input·option `whitespace-nowrap` |
| §3 표 sticky | thead `sticky top-0 z-20`, `bg-muted` |
| §4 viewport | 모달 제거로 영향 없음 |
| §5 컬럼 폭 | 학년/반/번호 `w-12`, 성별 `w-14`, 관리 `w-24` |
| §6 터치 타겟 | 행 자체 높이 ≥36px + 셀 패딩 + 행 클릭 영역으로 44px 확보. 학년/반/번호처럼 좁은 셀은 `tabIndex={0}` + role="button" + min-h-9 |
| §7 hover-only 금지 | 모든 동작이 클릭/탭 기반 |

구현 완료 시점에 `responsive-ui-reviewer` 에이전트 호출.

## 11. 변경 파일 목록 (요약)

| 카테고리 | 파일 | 변경 |
|---|---|---|
| 컴포넌트 | `src/components/EditableCell.tsx` | 신규 (2 named export) |
| 페이지 | `src/app/admin/page.tsx` | 표 컬럼 분리, inline 마이그레이션, Edit Dialog 제거, `saveUserField`/`saveAdminLevel` 추가, Pencil import 제거 |
| 맵 | `.claude/PROJECT_MAP.md` | EditableCell, 표 변경 반영 (`project-map-updater`로 갱신) |

## 12. 후속 에이전트 호출

| 시점 | 에이전트 |
|---|---|
| UI 변경 작성 직후 | `responsive-ui-reviewer` |
| 모든 변경 완료 후 | `project-map-updater` |

## 13. 롤백

코드 revert만으로 충분. DB 스키마·마이그레이션 변경 없음.
