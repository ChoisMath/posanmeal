# 관리자 식사 시간 윈도우 설정 UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` 의 "설정" 탭에 조식/석식 QR 시간 윈도우(4개 시각)를 편집·저장할 수 있는 박스 1개를 추가한다.

**Architecture:** 백엔드(`/api/system/settings` PUT, `getCachedSettings`, `resolveMealKind`)와 sync(`/api/sync/download`)는 이미 `mealWindows` 를 완전히 지원한다. 본 계획은 순수 UI 작업이며, 클라이언트 검증 순수함수(`validateMealWindows`, `mapServerError`) 1개를 새 lib 파일로 추출해 vitest로 단위 테스트한다.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · `<input type="time">` · sonner toast · vitest

**Spec:** `docs/superpowers/specs/2026-05-09-admin-meal-windows-setting-design.md` (commit `46c529d`)

---

## File Structure

| 파일 | 역할 | 변경 |
|------|------|------|
| `src/lib/meal-windows-validation.ts` | 클라이언트 검증 + 서버 에러 한국어 매핑 (순수 함수 모듈) | **신규** |
| `src/lib/__tests__/meal-windows-validation.test.ts` | 위 모듈의 vitest 단위 테스트 | **신규** |
| `src/app/admin/page.tsx` | 설정 탭 카드에 4번째 박스(식사 시간 윈도우) UI + state + handler 추가, `fetchSystemSettings` 확장 | **수정** |
| `.claude/PROJECT_MAP.md` | §8 lib 표에 `meal-windows-validation.ts` 한 줄 추가 | **수정** |

---

## Task 1: 검증 모듈 — 테스트 먼저 (실패)

**Files:**
- Create: `src/lib/__tests__/meal-windows-validation.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
// src/lib/__tests__/meal-windows-validation.test.ts
import { describe, expect, it } from "vitest";
import {
  validateMealWindows,
  mapServerError,
  type MealWindowsForm,
} from "@/lib/meal-windows-validation";

const valid: MealWindowsForm = {
  breakfast: { start: "04:00", end: "10:00" },
  dinner: { start: "15:00", end: "21:00" },
};

describe("validateMealWindows", () => {
  it("returns null for the default valid windows", () => {
    expect(validateMealWindows(valid)).toBeNull();
  });

  it("returns null when breakfast end is exactly equal to dinner start (adjacent allowed)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "10:00" },
        dinner: { start: "10:00", end: "21:00" },
      }),
    ).toBeNull();
  });

  it("rejects empty values", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "", end: "10:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("시간을 HH:MM 형식으로 입력해주세요");
  });

  it("rejects malformed time strings", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "4:00", end: "10:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("시간을 HH:MM 형식으로 입력해주세요");
  });

  it("rejects when breakfast start equals end", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "08:00", end: "08:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("종료 시간은 시작 시간보다 늦어야 합니다");
  });

  it("rejects when dinner end is before dinner start", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "10:00" },
        dinner: { start: "21:00", end: "15:00" },
      }),
    ).toBe("종료 시간은 시작 시간보다 늦어야 합니다");
  });

  it("rejects overlapping windows (breakfast spills into dinner)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "04:00", end: "16:00" },
        dinner: { start: "15:00", end: "21:00" },
      }),
    ).toBe("조식과 석식 시간대가 겹칠 수 없습니다");
  });

  it("rejects overlapping windows (dinner spills into breakfast)", () => {
    expect(
      validateMealWindows({
        breakfast: { start: "08:00", end: "10:00" },
        dinner: { start: "07:00", end: "21:00" },
      }),
    ).toBe("조식과 석식 시간대가 겹칠 수 없습니다");
  });
});

describe("mapServerError", () => {
  it("maps the server's invalid-meal-window message", () => {
    expect(mapServerError("Invalid meal window")).toBe(
      "시간을 HH:MM 형식으로 입력해주세요",
    );
  });

  it("maps the start-before-end message", () => {
    expect(mapServerError("Start time must be before end time")).toBe(
      "종료 시간은 시작 시간보다 늦어야 합니다",
    );
  });

  it("maps the overlap message", () => {
    expect(mapServerError("Meal windows must not overlap")).toBe(
      "조식과 석식 시간대가 겹칠 수 없습니다",
    );
  });

  it("returns null for unknown or missing errors", () => {
    expect(mapServerError(undefined)).toBeNull();
    expect(mapServerError("Some other error")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- meal-windows-validation`
Expected: FAIL with "Cannot find module '@/lib/meal-windows-validation'"

---

## Task 2: 검증 모듈 — 구현

**Files:**
- Create: `src/lib/meal-windows-validation.ts`

- [ ] **Step 1: 모듈 작성**

```ts
// src/lib/meal-windows-validation.ts
export type MealWindowsForm = {
  breakfast: { start: string; end: string };
  dinner: { start: string; end: string };
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

const ERROR_FORMAT = "시간을 HH:MM 형식으로 입력해주세요";
const ERROR_ORDER = "종료 시간은 시작 시간보다 늦어야 합니다";
const ERROR_OVERLAP = "조식과 석식 시간대가 겹칠 수 없습니다";

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateMealWindows(form: MealWindowsForm): string | null {
  const values = [
    form.breakfast.start,
    form.breakfast.end,
    form.dinner.start,
    form.dinner.end,
  ];
  if (values.some((value) => !TIME_PATTERN.test(value))) {
    return ERROR_FORMAT;
  }

  const bfStart = toMinutes(form.breakfast.start);
  const bfEnd = toMinutes(form.breakfast.end);
  const dnStart = toMinutes(form.dinner.start);
  const dnEnd = toMinutes(form.dinner.end);

  if (bfStart >= bfEnd || dnStart >= dnEnd) {
    return ERROR_ORDER;
  }

  if (bfEnd > dnStart && bfStart < dnEnd) {
    return ERROR_OVERLAP;
  }

  return null;
}

export function mapServerError(serverError: string | undefined): string | null {
  if (!serverError) return null;
  switch (serverError) {
    case "Invalid meal window":
      return ERROR_FORMAT;
    case "Start time must be before end time":
      return ERROR_ORDER;
    case "Meal windows must not overlap":
      return ERROR_OVERLAP;
    default:
      return null;
  }
}
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `npm test -- meal-windows-validation`
Expected: PASS · 12 tests passing

- [ ] **Step 3: 커밋**

```bash
git add src/lib/meal-windows-validation.ts src/lib/__tests__/meal-windows-validation.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add client-side meal windows validation module

Pure function `validateMealWindows` mirrors the backend's
`/api/system/settings` PUT validation (HH:MM, start<end, no overlap).
`mapServerError` translates the backend's English error strings into
the Korean messages the UI surfaces inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: admin/page.tsx — `fetchSystemSettings` 확장 및 state 추가

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: import 추가 (line 22 부근에 추가)**

`src/app/admin/page.tsx` 의 기존 import 블록 끝(line 23 직후)에 다음 줄 추가:

```ts
import {
  validateMealWindows,
  mapServerError,
  type MealWindowsForm,
} from "@/lib/meal-windows-validation";
```

- [ ] **Step 2: state 추가 (line 145 `sysLoading` 선언 직후)**

기존:
```ts
  // System settings
  const [sysMode, setSysMode] = useState<"online" | "local">("online");
  const [sysGeneration, setSysGeneration] = useState(1);
  const [sysLoading, setSysLoading] = useState(false);
```

다음으로 교체:
```ts
  // System settings
  const [sysMode, setSysMode] = useState<"online" | "local">("online");
  const [sysGeneration, setSysGeneration] = useState(1);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysWindows, setSysWindows] = useState<MealWindowsForm | null>(null);
  const [windowsForm, setWindowsForm] = useState<MealWindowsForm | null>(null);
  const [windowsError, setWindowsError] = useState<string | null>(null);
  const [windowsLoadFailed, setWindowsLoadFailed] = useState(false);
```

- [ ] **Step 3: `fetchSystemSettings` 확장 (line 147-152)**

기존:
```ts
  async function fetchSystemSettings() {
    const res = await fetch("/api/system/settings");
    const data = await res.json();
    setSysMode(data.operationMode);
    setSysGeneration(data.qrGeneration);
  }
```

다음으로 교체:
```ts
  async function fetchSystemSettings() {
    try {
      const res = await fetch("/api/system/settings");
      if (!res.ok) {
        setWindowsLoadFailed(true);
        return;
      }
      const data = await res.json();
      setSysMode(data.operationMode);
      setSysGeneration(data.qrGeneration);
      if (data.mealWindows) {
        const windows: MealWindowsForm = {
          breakfast: {
            start: data.mealWindows.breakfast.start,
            end: data.mealWindows.breakfast.end,
          },
          dinner: {
            start: data.mealWindows.dinner.start,
            end: data.mealWindows.dinner.end,
          },
        };
        setSysWindows(windows);
        setWindowsForm(windows);
        setWindowsError(null);
        setWindowsLoadFailed(false);
      }
    } catch {
      setWindowsLoadFailed(true);
    }
  }
```

- [ ] **Step 4: 저장 핸들러 + 입력 변경 핸들러 추가 (`handleRefreshQR` 함수 끝 line 181 직후)**

`handleRefreshQR` 함수 닫는 `}` 바로 다음(line 181 직후)에 추가:

```ts
  function handleWindowsChange(
    meal: "breakfast" | "dinner",
    edge: "start" | "end",
    value: string,
  ) {
    if (!windowsForm) return;
    const next: MealWindowsForm = {
      breakfast: { ...windowsForm.breakfast },
      dinner: { ...windowsForm.dinner },
    };
    next[meal][edge] = value;
    setWindowsForm(next);
    setWindowsError(validateMealWindows(next));
  }

  async function handleSaveWindows() {
    if (!windowsForm) return;
    const validationError = validateMealWindows(windowsForm);
    if (validationError) {
      setWindowsError(validationError);
      return;
    }
    setSysLoading(true);
    try {
      const res = await fetch("/api/system/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealWindows: windowsForm }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWindowsError(mapServerError(data?.error) ?? "저장에 실패했습니다");
        toast.error("식사 시간 저장 실패");
        return;
      }
      await fetchSystemSettings();
      toast.success("식사 시간이 저장되었습니다 · 새 QR부터 적용");
    } finally {
      setSysLoading(false);
    }
  }
```

- [ ] **Step 5: 타입체크 / 빌드 확인 (UI 박스 추가 전 중간 검증)**

Run: `npm run build`
Expected: 빌드 성공. (이 단계에서 페이지를 띄우면 박스는 아직 보이지 않지만 타입 에러 없음)

빌드가 너무 느리면 대신: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): wire meal-windows state and save handler in settings tab

Adds the form state, fetch hook, change handler, and save handler that
the upcoming UI box will render against. The UI box itself follows in
the next commit so this change compiles and ships independently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: admin/page.tsx — 식사 시간 윈도우 박스 마크업 추가

**Files:**
- Modify: `src/app/admin/page.tsx` (설정 탭 영역, "Data Sync for Tablets" 박스 다음)

- [ ] **Step 1: 박스 마크업 삽입**

`src/app/admin/page.tsx` 의 설정 탭 카드 안, "Data Sync for Tablets" 박스가 닫히는 `</div>` 다음 (line 1048 직후) — 즉 다음 줄 직전에 새 박스 추가:

```tsx
                  {sysMode === "local" && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-3">
                      태블릿에서 동기화를 실행해야 설정이 반영됩니다.
                    </p>
                  )}
```

박스를 위 `{sysMode === "local" && ...}` **바로 위**에 다음 마크업으로 삽입:

```tsx
                  {/* Meal Time Windows */}
                  <div className="p-4 border rounded-xl mt-3">
                    <p className="font-medium">식사 시간 윈도우</p>
                    <p className="text-sm text-muted-foreground">
                      QR 체크인이 가능한 시간대입니다. 시간 외 스캔은 거부됩니다.
                    </p>

                    {windowsLoadFailed && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                        설정을 불러올 수 없습니다. 새로고침 해주세요.
                      </p>
                    )}

                    {windowsForm && (
                      <>
                        <div className="mt-3 space-y-2">
                          {(["breakfast", "dinner"] as const).map((meal) => (
                            <div
                              key={meal}
                              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                            >
                              <span className="font-medium text-sm whitespace-nowrap w-12">
                                {meal === "breakfast" ? "조식" : "석식"}
                              </span>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`${meal}-start`} className="text-sm whitespace-nowrap">
                                  시작
                                </Label>
                                <Input
                                  id={`${meal}-start`}
                                  type="time"
                                  value={windowsForm[meal].start}
                                  onChange={(e) =>
                                    handleWindowsChange(meal, "start", e.target.value)
                                  }
                                  disabled={sysLoading}
                                  className="w-32"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`${meal}-end`} className="text-sm whitespace-nowrap">
                                  종료
                                </Label>
                                <Input
                                  id={`${meal}-end`}
                                  type="time"
                                  value={windowsForm[meal].end}
                                  onChange={(e) =>
                                    handleWindowsChange(meal, "end", e.target.value)
                                  }
                                  disabled={sysLoading}
                                  className="w-32"
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        {windowsError && (
                          <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                            ⚠ {windowsError}
                          </p>
                        )}

                        <div className="flex justify-end mt-3">
                          <Button
                            size="sm"
                            onClick={handleSaveWindows}
                            disabled={
                              sysLoading ||
                              !sysWindows ||
                              !!windowsError ||
                              JSON.stringify(windowsForm) === JSON.stringify(sysWindows)
                            }
                          >
                            저장
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
```

- [ ] **Step 2: 빌드 / 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): render meal time windows editor in settings tab

Adds the fourth box to the /admin settings card: four <input type="time">
fields (breakfast start/end, dinner start/end) with inline validation,
a save button gated on dirty + valid state, and toast feedback. The
existing local-mode reminder still renders below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 수동 dev 검증

**Files:** 없음 (코드 변경 없음)

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: `http://localhost:3000` 에서 서버 기동

- [ ] **Step 2: 관리자 로그인 → /admin → 설정 탭**

브라우저에서 `http://localhost:3000/admin/login` → 로그인 → "설정" 탭 클릭. 식사 시간 윈도우 박스가 보이고 기본값(또는 현재 DB 값)이 채워져 있는지 확인.

- [ ] **Step 3: 검증 케이스 5종 수동 확인**

각 케이스를 차례로 수행:

1. **정상 저장**: 조식 종료를 `10:30` 으로 변경 → 저장 버튼 활성 → 클릭 → toast "식사 시간이 저장되었습니다 · 새 QR부터 적용" 표시. 페이지 새로고침 후에도 `10:30` 유지.
2. **start ≥ end**: 조식 종료를 `04:00` (시작과 동일)으로 변경 → 빨간 인라인 에러 "종료 시간은 시작 시간보다 늦어야 합니다" 표시 + 저장 비활성.
3. **윈도우 겹침**: 조식 종료를 `16:00` 으로 변경 → 인라인 에러 "조식과 석식 시간대가 겹칠 수 없습니다" 표시 + 저장 비활성.
4. **인접 허용**: 조식 종료를 `15:00` (석식 시작과 동일)으로 변경 → 에러 없음, 저장 활성. 저장 후 정상 반영 확인.
5. **변경 없음**: 페이지 다시 로드 후 아무것도 건드리지 않은 상태에서 저장 버튼이 회색(비활성)인지 확인.

- [ ] **Step 4: 새 QR 적용 확인**

설정 탭에서 윈도우를 의도적으로 좁게(예: 조식 `04:00–04:01`, 석식 현재 시각 포함) 저장 → 다른 탭에서 학생/교사 페이지 열기 → 30초 이내 QR 토큰이 새 윈도우 기준으로 갱신되는지 확인 (네트워크 탭에서 `/api/qr/token` 응답의 `mealKind` 가 새 윈도우에 맞는지).

검증 후 윈도우는 원래 값으로 되돌려 둘 것.

- [ ] **Step 5: dev 서버 종료**

`Ctrl+C` 로 서버 정지.

> 이 단계는 코드 변경이 없어 별도 커밋 없음. 이슈 발견 시 해당 Task 로 돌아가 수정.

---

## Task 6: PROJECT_MAP.md 갱신

**Files:**
- Modify: `.claude/PROJECT_MAP.md`

- [ ] **Step 1: §8 lib 표에 한 줄 추가**

`.claude/PROJECT_MAP.md` 의 §8 (`## §8 주요 lib 파일`) 표 안, `src/lib/meal-kind-local.ts` 줄 다음에 추가:

```markdown
| `src/lib/meal-windows-validation.ts` | 클라이언트 검증 + 서버 에러 한국어 매핑 (관리자 설정 UI 전용) |
```

- [ ] **Step 2: 펜딩 로그 비우기**

Run (PowerShell): `Set-Content -Path "E:/Projects/posanmeal/.claude/.project-map-pending.log" -Value "" -Encoding utf8`

또는 Bash 가능 시: `: > E:/Projects/posanmeal/.claude/.project-map-pending.log`

- [ ] **Step 3: 커밋**

```bash
git add .claude/PROJECT_MAP.md .claude/.project-map-pending.log
git commit -m "$(cat <<'EOF'
docs(project-map): note meal-windows-validation lib

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 전체 테스트 스위트 통과 확인

**Files:** 없음

- [ ] **Step 1: 전체 vitest 실행**

Run: `npm test`
Expected: 모든 기존 테스트 + 신규 12개 테스트 PASS · 회귀 없음

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

이 단계에서 실패가 보이면 해당 Task 로 돌아가 수정. 별도 커밋 없음.

---

## 완료 기준

- [ ] `npm test` 통과 (신규 12개 포함)
- [ ] `npx tsc --noEmit` 통과
- [ ] `/admin` 설정 탭에서 식사 시간 윈도우 박스가 보이고, 정상값 저장 시 toast 가 뜸
- [ ] 잘못된 값(start≥end, 겹침)은 인라인 에러 + 저장 비활성
- [ ] 저장 후 학생/교사 페이지 QR 토큰이 새 윈도우 기준으로 발급
- [ ] PROJECT_MAP.md §8 에 새 lib 한 줄 추가
- [ ] 모든 변경이 git 에 커밋됨 (4개 커밋: 검증 모듈, state/handler, UI 박스, 프로젝트맵)
