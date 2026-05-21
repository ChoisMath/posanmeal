# Admin Table Inline Cell-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 사용자 관리 표에서 셀을 클릭하면 바로 입력 필드로 변환되어 수정·저장되도록 한다. Edit Dialog는 제거하고 학년-반-번호·교과/담임 결합 셀을 각각 독립 컬럼으로 분리한다.

**Architecture:** 재사용 `EditableTextCell` / `EditableSelectCell` 컴포넌트가 viewing/editing/saving 상태와 blur/Enter/Escape 키 처리를 캡슐화. `admin/page.tsx`는 `saveUserField` / `saveAdminLevel` 헬퍼를 통해 부분 PUT을 호출하고 비낙관적으로 `setUsers`. API 변경 0건.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, shadcn/ui + base-ui, Tailwind v4, sonner toast. 컴포넌트 단위 테스트는 RTL/jsdom 미설치라 이번 plan에서는 작성하지 않음 — test 도메인 수동 검증으로 대체.

**Spec:** `docs/superpowers/specs/2026-05-21-admin-inline-user-edit-design.md`

---

## File Structure

| 파일 | 책임 | 변경 종류 |
|---|---|---|
| `src/components/EditableCell.tsx` | `EditableTextCell` / `EditableSelectCell` named export | create |
| `src/app/admin/page.tsx` | `saveUserField`/`saveAdminLevel` 헬퍼 추가, 표 컬럼 분리·inline 마이그레이션, Edit Dialog 제거 | modify |
| `.claude/PROJECT_MAP.md` | EditableCell·표 변경 반영 | modify (project-map-updater) |

---

## Task 1: `EditableTextCell` 컴포넌트

**Files:**
- Create: `src/components/EditableCell.tsx` (첫 export — text 변형만)

- [ ] **Step 1: 파일 생성 + EditableTextCell 작성**

`src/components/EditableCell.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
  validate?: (next: string) => string | null;
}

export function EditableTextCell({
  value,
  onSave,
  ariaLabel,
  className,
  disabled,
  inputType = "text",
  placeholder,
  validate,
}: EditableTextCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      inputRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [editing]);

  function enter() {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  }

  async function commit() {
    if (draft === value) {
      setEditing(false);
      return;
    }
    const err = validate?.(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const r = await onSave(draft);
    setSaving(false);
    if (r.ok) {
      setEditing(false);
    } else if (r.message) {
      toast.error(r.message);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className={className}>
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="w-full px-1 py-0.5 rounded ring-1 ring-primary bg-background outline-none whitespace-nowrap text-sm disabled:opacity-60"
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      onClick={enter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enter();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      <span
        className={`block px-1 py-0.5 rounded min-h-7 whitespace-nowrap text-sm ${
          disabled ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/40"
        } ${value === "" && placeholder ? "text-muted-foreground italic" : ""}`}
      >
        {value === "" ? placeholder ?? "—" : value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS (pre-existing `tests/admin-sheet-import-guide.test.ts` regex 에러 2건은 남음).

- [ ] **Step 3: 커밋**

```
git add src/components/EditableCell.tsx
git commit -m "feat(components): add EditableTextCell for inline cell editing"
```

---

## Task 2: `EditableSelectCell` 컴포넌트

**Files:**
- Modify: `src/components/EditableCell.tsx` (두 번째 named export 추가)

- [ ] **Step 1: 같은 파일 끝에 EditableSelectCell 추가**

`src/components/EditableCell.tsx`의 EditableTextCell 다음에 추가:

```tsx
interface EditableSelectCellProps extends CommonProps {
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
}

export function EditableSelectCell({
  value,
  onSave,
  ariaLabel,
  className,
  disabled,
  options,
  emptyLabel,
}: EditableSelectCellProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
      selectRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [editing]);

  function enter() {
    if (disabled) return;
    setEditing(true);
  }

  async function commitWith(next: string) {
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const r = await onSave(next);
    setSaving(false);
    if (r.ok) {
      setEditing(false);
    } else if (r.message) {
      toast.error(r.message);
    }
  }

  function cancel() {
    setEditing(false);
  }

  const displayLabel =
    options.find((o) => o.value === value)?.label ?? (value === "" ? emptyLabel ?? "—" : value);

  if (editing) {
    return (
      <div className={className}>
        <select
          ref={selectRef}
          value={value}
          onChange={(e) => commitWith(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          aria-label={ariaLabel}
          className="w-full px-1 py-0.5 rounded ring-1 ring-primary bg-background outline-none whitespace-nowrap text-sm disabled:opacity-60"
        >
          {emptyLabel != null && <option value="">{emptyLabel}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      className={className}
      onClick={enter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enter();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      <span
        className={`block px-1 py-0.5 rounded min-h-7 whitespace-nowrap text-sm ${
          disabled ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/40"
        } ${value === "" ? "text-muted-foreground" : ""}`}
      >
        {displayLabel}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: 커밋**

```
git add src/components/EditableCell.tsx
git commit -m "feat(components): add EditableSelectCell for inline select editing"
```

---

## Task 3: `saveUserField` + `saveAdminLevel` 헬퍼

**Files:**
- Modify: `src/app/admin/page.tsx` (헬퍼 함수 2개 추가, `handleAdminLevelChange`는 일단 유지 — Task 4에서 호출처가 교체된 뒤 Task 5에서 제거)

- [ ] **Step 1: 임포트 추가 (파일 상단)**

`src/app/admin/page.tsx`의 기존 import 블록에 추가:

```ts
import { EditableTextCell, EditableSelectCell, type SaveResult } from "@/components/EditableCell";
```

- [ ] **Step 2: `saveUserField` 헬퍼 추가**

`handleAddUser`, `handleEditUser` 인근(예: `handleEditUser` 정의 직후)에 새 함수를 추가:

```ts
  type EditableUserField =
    | "name" | "email"
    | "grade" | "classNum" | "number"
    | "subject" | "homeroom" | "position"
    | "gender";

  async function saveUserField(
    id: number,
    field: EditableUserField,
    next: string,
  ): Promise<SaveResult> {
    const body: Record<string, unknown> = { id };
    let normalizedNext: unknown = next;

    if (field === "grade" || field === "classNum" || field === "number") {
      const n = parseInt(next);
      if (isNaN(n) || n < 1) {
        const label = field === "grade" ? "학년" : field === "classNum" ? "반" : "번호";
        return { ok: false, message: `${label}은(는) 1 이상 정수여야 합니다.` };
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
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? ({ ...u, [field]: normalizedNext } as User) : u)),
    );
    return { ok: true };
  }
```

- [ ] **Step 3: `saveAdminLevel` 헬퍼 추가**

같은 위치, `saveUserField` 다음에:

```ts
  async function saveAdminLevel(
    id: number,
    next: "NONE" | "SUBADMIN" | "ADMIN",
  ): Promise<SaveResult> {
    const target = users.find((u) => u.id === id);
    if (!target) return { ok: false, message: "사용자를 찾을 수 없습니다." };
    if (target.adminLevel === next) return { ok: true };

    const labelMap = { NONE: "일반", SUBADMIN: "서브관리자", ADMIN: "관리자" } as const;
    if (!confirm(`${target.name} 의 권한을 ${labelMap[next]}(으)로 변경할까요?`)) {
      return { ok: false, message: "" };
    }

    let res: Response;
    try {
      res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, adminLevel: next }),
      });
    } catch {
      return { ok: false, message: "네트워크 오류입니다." };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data?.reason ?? "권한 변경에 실패했습니다." };
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, adminLevel: next } : u)));
    return { ok: true };
  }
```

- [ ] **Step 4: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS. 새 헬퍼는 아직 호출되지 않지만 정의되어 있어야 Task 4에서 사용 가능.

- [ ] **Step 5: 커밋**

```
git add src/app/admin/page.tsx
git commit -m "feat(admin): add saveUserField and saveAdminLevel helpers for inline edit"
```

---

## Task 4: 학생/교사 표 inline 마이그레이션

**Files:**
- Modify: `src/app/admin/page.tsx` (표 헤더 + 표 본문 row map. ✏️ Pencil 버튼 제거)

이 task는 한 표를 두 가지 컬럼 세트로 재구성하면서 셀별로 `EditableCell`을 호출한다. **변경 분량이 큰 편**이므로 표 마크업 전체를 한 번에 교체한다.

- [ ] **Step 1: thead 교체**

`src/app/admin/page.tsx`에서 다음 thead 블록 (대략 line 900~915 부근):

```tsx
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="p-2 text-left bg-muted">이름</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "학년-반-번호" : "교과/담임"}</th>
                        <th className="p-2 text-left bg-muted">{userFilter === "STUDENT" ? "이메일" : "직책"}</th>
                        {userFilter === "STUDENT" && (
                          <th className="p-2 text-left bg-muted whitespace-nowrap">성별</th>
                        )}
                        <th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>
                        <th className="p-2 text-center w-24 bg-muted">관리</th>
                      </tr>
                    </thead>
```

으로 다음 thead로 교체:

```tsx
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="p-2 text-left bg-muted whitespace-nowrap">이름</th>
                        {userFilter === "STUDENT" ? (
                          <>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">학년</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">반</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-12">번호</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">이메일</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-14">성별</th>
                          </>
                        ) : (
                          <>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">교과명</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">담임</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">이메일</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">직책</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap w-14">성별</th>
                            <th className="p-2 text-left bg-muted whitespace-nowrap">권한</th>
                          </>
                        )}
                        <th className="p-2 text-center w-24 bg-muted whitespace-nowrap">관리</th>
                      </tr>
                    </thead>
```

- [ ] **Step 2: tbody row map 교체**

같은 파일에서 다음 tbody 블록 (대략 line 916~ ):

```tsx
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-2">{u.name}</td>
                          <td className="p-2">{u.role === "STUDENT" ? `${u.grade}-${u.classNum}-${u.number}` : `${u.subject || "-"} / ${u.homeroom || "비담임"}`}</td>
                          <td className="p-2">{u.role === "STUDENT" ? u.email : u.position || "-"}</td>
                          {userFilter === "STUDENT" && (
                            <td className="p-2 whitespace-nowrap">
                              {u.gender ? (
                                <span>{genderLabel(u.gender)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          )}
                          <td className="p-2 whitespace-nowrap">
                            {u.role === "STUDENT" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <select ... onChange={(e) => handleAdminLevelChange(u, e.target.value as "NONE" | "SUBADMIN" | "ADMIN")} ...>
                                ...
                              </select>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {adminPerm.canWrite && (
                              <div className="flex justify-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(u.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
```

으로 다음 tbody로 교체:

```tsx
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-1 align-middle">
                            <EditableTextCell
                              value={u.name}
                              ariaLabel={`${u.name} 이름`}
                              disabled={!adminPerm.canWrite}
                              validate={(v) => (v.trim() === "" ? "이름은 비울 수 없습니다." : null)}
                              onSave={(next) => saveUserField(u.id, "name", next)}
                            />
                          </td>
                          {u.role === "STUDENT" ? (
                            <>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.grade?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 학년`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const n = parseInt(v);
                                    return isNaN(n) || n < 1 ? "학년은 1 이상 정수여야 합니다." : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "grade", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.classNum?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 반`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const n = parseInt(v);
                                    return isNaN(n) || n < 1 ? "반은 1 이상 정수여야 합니다." : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "classNum", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-12">
                                <EditableTextCell
                                  value={u.number?.toString() ?? ""}
                                  inputType="number"
                                  ariaLabel={`${u.name} 번호`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => {
                                    const n = parseInt(v);
                                    return isNaN(n) || n < 1 ? "번호는 1 이상 정수여야 합니다." : null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "number", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.email}
                                  ariaLabel={`${u.name} 이메일`}
                                  disabled={!adminPerm.canWrite}
                                  className="max-w-[16rem] overflow-hidden text-ellipsis"
                                  validate={(v) => {
                                    const t = v.trim();
                                    if (t === "" || !t.includes("@")) return "이메일 형식이 올바르지 않습니다.";
                                    return null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "email", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-14">
                                <EditableSelectCell
                                  value={u.gender ?? ""}
                                  ariaLabel={`${u.name} 성별`}
                                  disabled={!adminPerm.canWrite}
                                  options={[
                                    { value: "MALE", label: "남" },
                                    { value: "FEMALE", label: "여" },
                                  ]}
                                  onSave={(next) => saveUserField(u.id, "gender", next)}
                                />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.subject ?? ""}
                                  ariaLabel={`${u.name} 교과명`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => (v.trim() === "" ? "교과명은 비울 수 없습니다." : null)}
                                  onSave={(next) => saveUserField(u.id, "subject", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.homeroom ?? ""}
                                  ariaLabel={`${u.name} 담임`}
                                  disabled={!adminPerm.canWrite}
                                  placeholder="비담임"
                                  onSave={(next) => saveUserField(u.id, "homeroom", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.email}
                                  ariaLabel={`${u.name} 이메일`}
                                  disabled={!adminPerm.canWrite}
                                  className="max-w-[16rem] overflow-hidden text-ellipsis"
                                  validate={(v) => {
                                    const t = v.trim();
                                    if (t === "" || !t.includes("@")) return "이메일 형식이 올바르지 않습니다.";
                                    return null;
                                  }}
                                  onSave={(next) => saveUserField(u.id, "email", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableTextCell
                                  value={u.position ?? ""}
                                  ariaLabel={`${u.name} 직책`}
                                  disabled={!adminPerm.canWrite}
                                  validate={(v) => (v.trim() === "" ? "직책은 비울 수 없습니다." : null)}
                                  onSave={(next) => saveUserField(u.id, "position", next)}
                                />
                              </td>
                              <td className="p-1 align-middle w-14">
                                <EditableSelectCell
                                  value={u.gender ?? ""}
                                  ariaLabel={`${u.name} 성별`}
                                  disabled={!adminPerm.canWrite}
                                  emptyLabel="—"
                                  options={[
                                    { value: "MALE", label: "남" },
                                    { value: "FEMALE", label: "여" },
                                  ]}
                                  onSave={(next) => saveUserField(u.id, "gender", next)}
                                />
                              </td>
                              <td className="p-1 align-middle">
                                <EditableSelectCell
                                  value={u.adminLevel}
                                  ariaLabel={`${u.name} 권한`}
                                  disabled={
                                    !adminPerm.canWrite ||
                                    (adminPerm.dbUserId === u.id && u.adminLevel === "ADMIN")
                                  }
                                  options={[
                                    { value: "NONE", label: "일반" },
                                    { value: "SUBADMIN", label: "서브관리자" },
                                    { value: "ADMIN", label: "관리자" },
                                  ]}
                                  onSave={(next) =>
                                    saveAdminLevel(u.id, next as "NONE" | "SUBADMIN" | "ADMIN")
                                  }
                                />
                              </td>
                            </>
                          )}
                          <td className="p-2 text-center align-middle">
                            {adminPerm.canWrite && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteUser(u.id)}
                                aria-label={`${u.name} 삭제`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
```

- [ ] **Step 3: lucide-react `Pencil` import 제거**

`src/app/admin/page.tsx` 상단의 `lucide-react` 명세에서 `Pencil` 만 제거. 다른 아이콘은 그대로 유지. 예시 — 만약 현재 import가 다음과 같다면:

```ts
import { Plus, Pencil, Trash2, FileSpreadsheet, ... } from "lucide-react";
```

`Pencil` 만 제거:

```ts
import { Plus, Trash2, FileSpreadsheet, ... } from "lucide-react";
```

`Pencil` 가 페이지 다른 곳에서 쓰이지 않는지 확인:

Run: `grep -n "Pencil" src/app/admin/page.tsx`
Expected: 출력 없음 (이미 모든 Pencil 사용처 제거됨).

- [ ] **Step 4: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS. 이전과 동일한 pre-existing 2건만 남음.

미사용 `handleAdminLevelChange` 함수는 아직 파일에 남아 있을 수 있다 — Task 5에서 함께 정리하므로 이 시점에는 그대로 둔다 (Next/TS strict는 미사용 함수에 대해 에러를 내지 않음).

- [ ] **Step 5: 커밋**

```
git add src/app/admin/page.tsx
git commit -m "feat(admin): split combined cells and migrate user table to inline editing"
```

---

## Task 5: Edit Dialog 및 dead state·핸들러·import 제거

**Files:**
- Modify: `src/app/admin/page.tsx` (불필요해진 코드 정리)

- [ ] **Step 1: state hook 제거**

다음 state 선언을 삭제 (`addDialogOpen`/`addForm`은 유지, `editDialogOpen`/`editUser`/`editForm`만 삭제):

```ts
  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyForm });
```

- [ ] **Step 2: `openEditDialog` 함수 삭제**

다음 함수 전체 삭제:

```ts
  function openEditDialog(user: User) {
    setEditUser(user);
    setEditForm({
      role: user.role as "STUDENT" | "TEACHER",
      email: user.email,
      name: user.name,
      grade: user.grade?.toString() || "",
      classNum: user.classNum?.toString() || "",
      number: user.number?.toString() || "",
      subject: user.subject || "",
      homeroom: user.homeroom || "",
      position: user.position || "",
      gender: user.gender ?? "",
    });
    setEditDialogOpen(true);
  }
```

- [ ] **Step 3: `handleEditUser` 함수 삭제**

다음 함수 전체 삭제 (전체 body 포함):

```ts
  async function handleEditUser() {
    if (!editUser) return;
    if (editUser.role === "STUDENT" && editForm.gender !== "MALE" && editForm.gender !== "FEMALE") {
      toast.error("학생은 성별을 선택해야 합니다.");
      return;
    }
    /* ... 전체 함수 본문 ... */
  }
```

- [ ] **Step 4: `handleAdminLevelChange` 함수 삭제**

Task 4에서 `saveAdminLevel`이 대체했으므로 다음 함수도 삭제:

```ts
  async function handleAdminLevelChange(u: User, next: "NONE" | "SUBADMIN" | "ADMIN") {
    /* ... 함수 본문 전체 ... */
  }
```

> 함수의 정확한 시그니처는 파일 안에서 확인. 본문에 `confirm(...)` + `fetch("/api/admin/users", { method: "PUT", ... })` + `setUsers(...)` 로직이 들어 있음.

- [ ] **Step 5: Edit Dialog JSX 블록 제거**

다음 Dialog 컴포넌트 전체 삭제:

```tsx
      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto">
          <DialogHeader><DialogTitle>사용자 편집</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-3">
              {/* ... 전체 폼 (이메일/이름/학년·반·번호/성별 라디오/교과·담임·직책/저장 버튼) ... */}
            </div>
          )}
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: 미사용 상태 변수 정리 확인**

`grep -n "editDialogOpen\|setEditDialogOpen\|editUser\|setEditUser\|editForm\|setEditForm\|openEditDialog\|handleEditUser\|handleAdminLevelChange" src/app/admin/page.tsx`

Expected: 출력 없음.

- [ ] **Step 7: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS. pre-existing 2건만.

- [ ] **Step 8: 커밋**

```
git add src/app/admin/page.tsx
git commit -m "chore(admin): remove Edit Dialog and dead helpers superseded by inline editing"
```

---

## Task 6: responsive-ui-reviewer 검수 및 후속 fix

**Files:**
- Modify: `src/app/admin/page.tsx` 및/또는 `src/components/EditableCell.tsx` (검수 지적사항에 따라)

- [ ] **Step 1: `responsive-ui-reviewer` 에이전트 호출**

다음 컨텍스트로 호출:

> 작업 내용: `/admin` 사용자 관리 표를 inline 셀 편집으로 마이그레이션. `src/components/EditableCell.tsx` 신규 (text/select 두 컴포넌트), `src/app/admin/page.tsx`에서 학생/교사 표 컬럼 분리 + inline 셀 적용 + Edit Dialog 제거. 학년/반/번호/성별/관리 컬럼 폭은 `w-12`, `w-14`, `w-24`. 셀 클릭 → input/select 활성, blur/Enter 저장, Escape 취소.
>
> 점검 요청: @~/.claude/rules/responsive-ui.md
>   - 표 sticky 헤더·셀 배경
>   - 모든 셀·input·select에 whitespace-nowrap
>   - 모바일 가로 스크롤 후 표 깨짐
>   - 셀 클릭 영역 터치 타겟 (viewing 셀)
>   - editing 상태의 input 폭과 줄바꿈
>
> 커밋 범위: `git diff 6649e23..HEAD` 또는 최근 5커밋 (`Task 1~5`).
> 작업 디렉터리: `E:\Projects\posanmeal`

위반 사항이 있으면 보고 받기.

- [ ] **Step 2: 지적사항 fix (있는 경우)**

reviewer가 보고한 위반을 인라인 수정. 일반적으로 한 PR에서 가벼운 한두 가지(예: `whitespace-nowrap` 누락, 터치 타겟 부족 등). 각 fix는 별도 커밋:

```
git add <touched-files>
git commit -m "fix(admin): <responsive-ui issue resolved>"
```

위반이 없으면 이 step은 skip.

- [ ] **Step 3: 타입 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## Task 7: PROJECT_MAP 동기화

**Files:**
- Modify: `.claude/PROJECT_MAP.md`

- [ ] **Step 1: `project-map-updater` 에이전트 호출**

다음 컨텍스트로 호출:

> 작업 내용:
> - `src/components/EditableCell.tsx` 신규 — `EditableTextCell`, `EditableSelectCell` 두 named export. 관리자 표 셀 클릭 → input/select 변환, blur/Enter 저장, Escape 취소. `SaveResult` 타입 export.
> - `src/app/admin/page.tsx`:
>   - 학생 탭 표 컬럼: 이름/학년/반/번호/이메일/성별/관리 (권한 컬럼 제거)
>   - 교사 탭 표 컬럼: 이름/교과명/담임/이메일/직책/성별/권한/관리 (모두 분리)
>   - 모든 데이터 셀 inline 편집
>   - Edit User Dialog · `openEditDialog` · `handleEditUser` · `handleAdminLevelChange` 제거
>   - 신규 헬퍼 `saveUserField`, `saveAdminLevel` 도입
>   - lucide-react `Pencil` import 제거
>
> 갱신 대상 섹션:
> - §7 주요 컴포넌트: `EditableCell` 한 줄 추가 (text/select 두 export)
> - §12 주의사항: 관리자 사용자 관리 표가 inline 편집 방식 (편집 모달 없음) 한 줄
>
> 다른 섹션은 건드리지 마세요. 비구조적 텍스트 변경 금지.

작업 디렉터리: `E:\Projects\posanmeal`

- [ ] **Step 2: PROJECT_MAP 변경 확인 후 커밋**

```
git add .claude/PROJECT_MAP.md
git commit -m "docs(project-map): note EditableCell and admin table inline editing"
```

---

## Task 8: 최종 통합 리뷰 + 사용자 검증 안내

**Files:** (코드 변경 없음)

- [ ] **Step 1: 최종 통합 코드 리뷰**

`feature-dev:code-reviewer` 에이전트로 전체 변경 검토.

컨텍스트:
- BASE_SHA: `6649e23` (spec 커밋)
- HEAD_SHA: 현재 (Task 7 직후)
- 목적: inline 셀 편집 마이그레이션의 통합 안전성, 컴포넌트 추상화 적절성, 표 마크업 변경 일관성, 미사용 코드 잔존 여부
- 7개 task 분량의 diff를 한 번에 검토

지적사항이 있으면 추가 fix 커밋.

- [ ] **Step 2: 사용자에게 push 시점 안내**

> Task 1~7 완료. 변경 요약과 함께 다음 액션 안내:
> 1. `git push origin feat/posanmeal-mvp` — Railway test 서비스 자동 배포
> 2. `https://posanmeal.up.railway.app/admin` 에서 수동 검증 (시나리오는 아래)
> 3. 통과 시 main 머지 → prod 배포

수동 검증 시나리오 (사용자가 직접 수행):
- [ ] 학생 탭 — 표에 이름/학년/반/번호/이메일/성별/관리 7컬럼 표시
- [ ] 학생 이름 셀 클릭 → input 활성 → 다른 이름 입력 → Enter → 저장 → 표 갱신
- [ ] 학생 이름 셀 → 빈 값으로 → Enter → "이름은 비울 수 없습니다." 토스트 + editing 유지
- [ ] 학생 학년 셀 클릭 → 숫자 입력 → blur → 저장
- [ ] 학생 학년 셀 → 빈 값 → "학년은 1 이상 정수여야 합니다." 토스트
- [ ] 학생 성별 셀 → 클릭 → select 활성 → 다른 옵션 선택 → 즉시 저장 → "—" 사라지고 "남"/"여" 표시
- [ ] 셀 편집 중 Escape → 원래 값 복원
- [ ] 교사 탭 — 표에 이름/교과명/담임/이메일/직책/성별/권한/관리 8컬럼
- [ ] 교사 권한 셀 → 클릭 → select → "관리자" 선택 → confirm 다이얼로그 → 확인 → 저장
- [ ] 교사 권한 셀 → 확인 다이얼로그에서 취소 → 셀 값 그대로 (토스트 없음)
- [ ] 본인 ADMIN 행 → 권한 셀이 disabled (회색, 클릭해도 editing 안 됨)
- [ ] 관리 셀에 ✏️ 편집 버튼 없음, 🗑️ 삭제 버튼만 존재
- [ ] 사용자 추가 다이얼로그 — 그대로 동작
- [ ] 모바일 폭 (≤640px) — 표 가로 스크롤 후 sticky 헤더 유지, 셀 클릭 시 input 정상
- [ ] 가상 키보드가 셀을 가리면 자동 scroll로 셀이 보이도록

위 시나리오 통과 후 main 머지 진행.

- [ ] **Step 3: 모든 task 완료 보고**
