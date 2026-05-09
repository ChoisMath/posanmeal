# 관리자 로컬 데이터 모달 + Excel 다운로드 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` 의 "설정" 탭 "태블릿 데이터 동기화" 박스에 `[로컬 데이터]` 버튼을 추가하고, 클릭 시 모달이 IndexedDB 의 unsynced 체크인을 표로 보여주며 그 안의 `[Excel 다운로드]` 가 .xlsx 파일을 생성한다.

**Architecture:** 100% 클라이언트 작업. IndexedDB 의 `getUnsyncedCheckIns()` + `getUser()` 로 행을 조립하고, exceljs 를 dynamic import 해 .xlsx Blob 을 만들어 자동 다운로드. 백엔드·sync·Prisma 는 무변경.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · IndexedDB · exceljs (dynamic import) · shadcn `Dialog` (base-ui 기반) · sonner toast · vitest

**Spec:** `docs/superpowers/specs/2026-05-10-admin-local-data-modal-design.md` (commit `7f263c1`)

---

## File Structure

| 파일 | 역할 | 변경 |
|------|------|------|
| `src/lib/timezone.ts` | 신규 함수 `formatDateTimeSecondsKST(date)` 추가 ("YYYY-MM-DD HH:MM:SS") | **수정** |
| `src/lib/__tests__/timezone-seconds.test.ts` | 새 함수 단위 테스트 | **신규** |
| `src/components/LocalCheckInsTable.tsx` | `LocalCheckInRow` 타입 + `buildUserLabel` helper + 4상태 분기 표 컴포넌트 | **신규** |
| `src/lib/local-checkins-export.ts` | `exportLocalCheckInsXlsx(rows): Promise<Blob>` (exceljs dynamic import) | **신규** |
| `src/lib/__tests__/local-checkins-export.test.ts` | `exportLocalCheckInsXlsx` + `buildUserLabel` 단위 테스트 | **신규** |
| `src/app/admin/page.tsx` | state 6, handler 4, button + 배지, Dialog 마크업 | **수정** |
| `.claude/PROJECT_MAP.md` | §7 컴포넌트 + §8 lib 한 줄씩 추가 | **수정** |

---

## Task 1: `formatDateTimeSecondsKST` — TDD setup

스펙은 `formatKST(date, format)` 시그니처를 가정했지만 실제 lib 에는 그 시그니처가 없다. 모달 표("HH:MM:SS")와 Excel 시각("YYYY-MM-DD HH:MM:SS") 모두 초 단위가 필요하므로 timezone.ts 에 단일 helper 1개를 추가한다.

**Files:**
- Create: `src/lib/__tests__/timezone-seconds.test.ts`
- Modify: `src/lib/timezone.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
// src/lib/__tests__/timezone-seconds.test.ts
import { describe, expect, it } from "vitest";
import { formatDateTimeSecondsKST } from "@/lib/timezone";

describe("formatDateTimeSecondsKST", () => {
  it("formats a UTC ISO date as KST 'YYYY-MM-DD HH:MM:SS'", () => {
    // 2026-05-10T01:23:45Z is 2026-05-10 10:23:45 KST (UTC+9)
    const date = new Date("2026-05-10T01:23:45.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 10:23:45");
  });

  it("formats midnight UTC as 09:00:00 KST same day", () => {
    const date = new Date("2026-05-10T00:00:00.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 09:00:00");
  });

  it("crosses date boundary correctly (15:30 UTC = 00:30 KST next day)", () => {
    const date = new Date("2026-05-09T15:30:00.000Z");
    expect(formatDateTimeSecondsKST(date)).toBe("2026-05-10 00:30:00");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run from `E:/Projects/posanmeal`: `npm test -- timezone-seconds`
Expected: FAIL — `formatDateTimeSecondsKST` is not exported from `@/lib/timezone`

- [ ] **Step 3: 함수 구현**

Append to `src/lib/timezone.ts` (after the existing `formatDateTimeKST` function on line 47):

```ts

export function formatDateTimeSecondsKST(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- timezone-seconds`
Expected: PASS — 3 tests passing

- [ ] **Step 5: 커밋**

```bash
git add src/lib/timezone.ts src/lib/__tests__/timezone-seconds.test.ts
git commit -m "$(cat <<'EOF'
feat(timezone): add formatDateTimeSecondsKST helper

Mirrors formatDateTimeKST but includes seconds. Needed by the upcoming
admin local-data modal (table cell + Excel export both want second
precision so an operator can pinpoint when a check-in was queued).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `LocalCheckInsTable` 컴포넌트 + `buildUserLabel` helper (TDD)

테스트 가능한 helper 와 함께 컴포넌트의 뼈대를 만든다. 표 본문 마크업은 Task 4에서 채운다.

**Files:**
- Create: `src/components/LocalCheckInsTable.tsx`
- Create: `src/lib/__tests__/local-checkins-export.test.ts` (이 파일은 Task 3의 export 테스트와 합쳐 단일 파일에 둔다 — 우선 Task 2 에서 helper 케이스만 작성)

- [ ] **Step 1: 테스트 파일 작성 (helper 4 케이스)**

```ts
// src/lib/__tests__/local-checkins-export.test.ts
import { describe, expect, it } from "vitest";
import { buildUserLabel, type LocalCheckInRow } from "@/components/LocalCheckInsTable";
import type { LocalUser } from "@/lib/local-db";

describe("buildUserLabel", () => {
  it("formats a student with full grade/class/number", () => {
    const u: LocalUser = { id: 1, name: "홍길동", role: "STUDENT", grade: 1, classNum: 2, number: 15 };
    expect(buildUserLabel(u, 1)).toBe("1-2-15");
  });

  it("returns '교사' for teachers regardless of other fields", () => {
    const u: LocalUser = { id: 2, name: "김선생", role: "TEACHER" };
    expect(buildUserLabel(u, 2)).toBe("교사");
  });

  it("falls back to the user's name when a student is missing class info", () => {
    const u: LocalUser = { id: 3, name: "박학생", role: "STUDENT" };
    expect(buildUserLabel(u, 3)).toBe("박학생");
  });

  it("returns 'id:N' when the user is not in the local cache", () => {
    expect(buildUserLabel(undefined, 99)).toBe("id:99");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- local-checkins-export`
Expected: FAIL — module `@/components/LocalCheckInsTable` not found

- [ ] **Step 3: 컴포넌트 파일 생성 (skeleton — 타입 + helper 만, 본 표 마크업은 Task 4)**

Create `src/components/LocalCheckInsTable.tsx`:

```tsx
import type { LocalUser } from "@/lib/local-db";

export interface LocalCheckInRow {
  id: number;
  userId: number;
  userLabel: string;
  name: string;
  date: string;
  mealKind: "BREAKFAST" | "DINNER";
  type: "STUDENT" | "WORK" | "PERSONAL";
  checkedAt: string;
}

export function buildUserLabel(u: LocalUser | undefined, userId: number): string {
  if (!u) return `id:${userId}`;
  if (u.role === "TEACHER") return "교사";
  if (u.grade && u.classNum && u.number) {
    return `${u.grade}-${u.classNum}-${u.number}`;
  }
  return u.name;
}

interface LocalCheckInsTableProps {
  rows: LocalCheckInRow[];
  loading: boolean;
  errorMessage: string | null;
}

export function LocalCheckInsTable({ rows, loading, errorMessage }: LocalCheckInsTableProps) {
  if (errorMessage) {
    return <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">동기화되지 않은 데이터가 없습니다</p>;
  }
  // Full table markup added in Task 4
  return <p className="text-sm">{rows.length}건</p>;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- local-checkins-export`
Expected: PASS — 4 tests passing

- [ ] **Step 5: 커밋**

```bash
git add src/components/LocalCheckInsTable.tsx src/lib/__tests__/local-checkins-export.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add LocalCheckInsTable skeleton with buildUserLabel helper

Adds the type, helper, and four-state branching for the upcoming
local-data modal. Table body markup follows in a later commit so
this change compiles and ships independently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `exportLocalCheckInsXlsx` (TDD)

**Files:**
- Modify: `src/lib/__tests__/local-checkins-export.test.ts` (append `exportLocalCheckInsXlsx` cases)
- Create: `src/lib/local-checkins-export.ts`

- [ ] **Step 1: 테스트 추가 (5 케이스)**

In `src/lib/__tests__/local-checkins-export.test.ts`:

(a) Add 2 import lines at the TOP of the file (immediately after the existing `import { describe, expect, it } from "vitest";` line):

```ts
import { exportLocalCheckInsXlsx } from "@/lib/local-checkins-export";
import ExcelJS from "exceljs";
```

(b) Append the following block at the END of the file (after the existing `describe("buildUserLabel", () => { ... })` block):

```ts
const sampleRows: LocalCheckInRow[] = [
  {
    id: 42,
    userId: 1,
    userLabel: "1-2-15",
    name: "홍길동",
    date: "2026-05-10",
    mealKind: "DINNER",
    type: "STUDENT",
    checkedAt: "2026-05-10T09:32:11.000Z",
  },
  {
    id: 43,
    userId: 2,
    userLabel: "교사",
    name: "김선생",
    date: "2026-05-10",
    mealKind: "BREAKFAST",
    type: "WORK",
    checkedAt: "2026-05-10T00:15:00.000Z",
  },
];

async function loadWorkbook(blob: Blob): Promise<ExcelJS.Workbook> {
  const buffer = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe("exportLocalCheckInsXlsx", () => {
  it("returns a workbook with a header row only when input is empty", async () => {
    const blob = await exportLocalCheckInsXlsx([]);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws).toBeDefined();
    expect(ws.rowCount).toBe(1);
    const header = ws.getRow(1).values as Array<string | undefined>;
    expect(header.slice(1)).toEqual([
      "IDB ID", "사용자ID", "학년반번호", "이름", "날짜", "식사", "종류", "체크시각(KST)",
    ]);
  });

  it("maps every row's fields into the worksheet in order", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.rowCount).toBe(3);
    const row2 = ws.getRow(2).values as Array<unknown>;
    expect(row2.slice(1)).toEqual([42, 1, "1-2-15", "홍길동", "2026-05-10", "석", "STUDENT", "2026-05-10 18:32:11"]);
    const row3 = ws.getRow(3).values as Array<unknown>;
    expect(row3.slice(1)).toEqual([43, 2, "교사", "김선생", "2026-05-10", "조", "WORK", "2026-05-10 09:15:00"]);
  });

  it("translates BREAKFAST to '조' and DINNER to '석'", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.getRow(2).getCell(6).value).toBe("석");
    expect(ws.getRow(3).getCell(6).value).toBe("조");
  });

  it("makes the header row bold", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it("sets every column to width 14", async () => {
    const blob = await exportLocalCheckInsXlsx(sampleRows);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet("로컬 미동기")!;
    for (const col of ws.columns) {
      expect(col.width).toBe(14);
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- local-checkins-export`
Expected: FAIL — module `@/lib/local-checkins-export` not found (4 buildUserLabel tests still pass, 5 new fail)

- [ ] **Step 3: 모듈 구현**

Create `src/lib/local-checkins-export.ts`:

```ts
import type { LocalCheckInRow } from "@/components/LocalCheckInsTable";
import { formatDateTimeSecondsKST } from "@/lib/timezone";

const HEADERS = [
  "IDB ID",
  "사용자ID",
  "학년반번호",
  "이름",
  "날짜",
  "식사",
  "종류",
  "체크시각(KST)",
];

export async function exportLocalCheckInsXlsx(rows: LocalCheckInRow[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("로컬 미동기");
  ws.addRow(HEADERS);
  for (const r of rows) {
    ws.addRow([
      r.id,
      r.userId,
      r.userLabel,
      r.name,
      r.date,
      r.mealKind === "BREAKFAST" ? "조" : "석",
      r.type,
      formatDateTimeSecondsKST(new Date(r.checkedAt)),
    ]);
  }
  ws.columns.forEach((col) => {
    col.width = 14;
  });
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- local-checkins-export`
Expected: PASS — 9 tests passing (4 helper + 5 export)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/local-checkins-export.ts src/lib/__tests__/local-checkins-export.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): add client-side local check-ins .xlsx exporter

exportLocalCheckInsXlsx builds an .xlsx Blob from the modal's row list
using a dynamically-imported exceljs so the library stays out of the
initial admin bundle. Translates BREAKFAST/DINNER to 조/석 and uses
formatDateTimeSecondsKST for the check-in timestamp column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `LocalCheckInsTable` 표 마크업 채우기

`rows.length > 0` 분기에 본 표 마크업을 추가한다. 컴포넌트는 props 만 받는 순수 표시 컴포넌트.

**Files:**
- Modify: `src/components/LocalCheckInsTable.tsx`

- [ ] **Step 1: 표 마크업 교체**

`src/components/LocalCheckInsTable.tsx` 의 마지막 `return <p className="text-sm">{rows.length}건</p>;` 부분을 다음으로 교체:

```tsx
  const missingUserCount = rows.filter((r) => r.userLabel.startsWith("id:")).length;

  return (
    <>
      <p className="text-sm text-muted-foreground mb-2">
        {rows.length}건의 체크인이 아직 서버로 전송되지 않았습니다.
      </p>
      {missingUserCount > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
          ⓘ {missingUserCount}건은 사용자 정보 매핑 실패
        </p>
      )}
      <div className="overflow-x-auto border rounded-lg max-h-[60vh]">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">학년반번호</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-left font-medium">식사</th>
              <th className="px-3 py-2 text-left font-medium">종류</th>
              <th className="px-3 py-2 text-left font-medium">체크시각</th>
              <th className="px-3 py-2 text-left font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">{r.userLabel}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.mealKind === "BREAKFAST" ? "조" : "석"}</td>
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2">{formatDateTimeSecondsKST(new Date(r.checkedAt)).slice(11)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
```

- [ ] **Step 2: import 추가**

`src/components/LocalCheckInsTable.tsx` 상단의 기존 import 블록에 `formatDateTimeSecondsKST` 를 추가:

```tsx
import type { LocalUser } from "@/lib/local-db";
import { formatDateTimeSecondsKST } from "@/lib/timezone";
```

- [ ] **Step 3: 타입 / 테스트 검증**

Run: `npx tsc --noEmit`
Expected: 사전 에러 외 신규 에러 없음

Run: `npm test`
Expected: 모든 기존 테스트 (해당 시점 ~57개) PASS — 회귀 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/LocalCheckInsTable.tsx
git commit -m "$(cat <<'EOF'
feat(admin): render LocalCheckInsTable rows with sticky header

Fills in the rows>0 branch of the modal table: sticky header, nowrap
cells, scrollable container, BREAKFAST/DINNER → 조/석 translation,
HH:MM:SS timestamps, and an inline notice when any rows have missing
user-cache entries (displayed as id:N in the userLabel column).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `admin/page.tsx` — state + handlers (UI 박스/모달 마크업은 Task 6)

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: import 추가**

`src/app/admin/page.tsx` 상단의 기존 import 블록 끝(`import { sourceLabel, type CheckInSourceLabel } from "@/lib/checkin-source";` 다음)에 추가:

```ts
import { LocalCheckInsTable, buildUserLabel, type LocalCheckInRow } from "@/components/LocalCheckInsTable";
```

기존 lucide-react import 라인에 `Database` 아이콘 추가 (현재 라인은 `import { LogOut, Plus, Download, ..., AlertTriangle } from "lucide-react";` 형태):

```ts
import { LogOut, Plus, Download, Trash2, Pencil, FileSpreadsheet, ArrowLeftRight, RefreshCw, Camera, Settings, Users, Search, ChevronLeft, ChevronRight, AlertTriangle, Database } from "lucide-react";
```

- [ ] **Step 2: state 추가**

기존 `windowsLoadFailed` 줄 다음(현재 line 150 부근)에 6개 state 추가:

```ts
  const [localDataDialogOpen, setLocalDataDialogOpen] = useState(false);
  const [localRows, setLocalRows] = useState<LocalCheckInRow[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [unsyncedBadgeCount, setUnsyncedBadgeCount] = useState(0);
  const [exportingExcel, setExportingExcel] = useState(false);
```

- [ ] **Step 3: 4개 handler + 1개 헬퍼 추가**

`handleSaveWindows` 함수 닫는 `}` 직후(현재 line 261 부근)에 추가:

```ts
  async function refreshUnsyncedBadge() {
    try {
      const { getUnsyncedCount } = await import("@/lib/local-db");
      setUnsyncedBadgeCount(await getUnsyncedCount());
    } catch {
      setUnsyncedBadgeCount(0);
    }
  }

  async function handleOpenLocalData() {
    setLocalDataDialogOpen(true);
    setLocalLoading(true);
    setLocalError(null);
    setLocalRows([]);
    try {
      const { getUnsyncedCheckIns, getUser } = await import("@/lib/local-db");
      const checkins = await getUnsyncedCheckIns();
      const userIds = Array.from(new Set(checkins.map((c) => c.userId)));
      const userMap = new Map<number, Awaited<ReturnType<typeof getUser>>>();
      await Promise.all(
        userIds.map(async (id) => {
          const u = await getUser(id);
          if (u) userMap.set(id, u);
        }),
      );
      const rows: LocalCheckInRow[] = checkins.map((c) => ({
        id: c.id!,
        userId: c.userId,
        userLabel: buildUserLabel(userMap.get(c.userId), c.userId),
        name: userMap.get(c.userId)?.name ?? "-",
        date: c.date,
        mealKind: c.mealKind,
        type: c.type,
        checkedAt: c.checkedAt,
      }));
      setLocalRows(rows);
    } catch (err) {
      setLocalError("로컬 데이터를 불러오지 못했습니다");
      toast.error("로컬 데이터를 불러오지 못했습니다");
      console.error(err);
    } finally {
      setLocalLoading(false);
    }
  }

  function handleCloseLocalData(open: boolean) {
    setLocalDataDialogOpen(open);
    if (!open) {
      setLocalRows([]);
      setLocalError(null);
      refreshUnsyncedBadge();
    }
  }

  async function handleExportLocalDataExcel() {
    if (localRows.length === 0) return;
    setExportingExcel(true);
    try {
      const { exportLocalCheckInsXlsx } = await import("@/lib/local-checkins-export");
      const blob = await exportLocalCheckInsXlsx(localRows);
      const filename = `local-checkins-${todayKST()}.xlsx`;
      triggerDownload(blob, filename);
    } catch (err) {
      toast.error("엑셀 다운로드 실패");
      console.error(err);
    } finally {
      setExportingExcel(false);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
```

- [ ] **Step 4: 마운트 시 배지 갱신 + 동기화 후 갱신 hook 추가**

기존 `useEffect(() => { fetchUsers(); fetchSystemSettings(); fetchApps(); }, [userFilter]);` 라인을 찾아 그 다음 줄에 새 useEffect 추가:

```ts
  useEffect(() => { refreshUnsyncedBadge(); }, []);
```

기존 `handleAdminSync` 함수의 본문 끝부분(현재 setIsSyncing(false) 직후)에 다음 줄 추가:

```ts
      await refreshUnsyncedBadge();
```

(정확한 위치: 현재 `handleAdminSync` 의 try/catch 블록 가장 바깥 finally 직전 또는 함수 본문 마지막 줄. 같은 함수 내 어디에 들어가도 무방하지만 모든 동기화 경로에서 한 번 호출되도록 finally 안 권장.)

위치를 명확히: `handleAdminSync` 의 `} finally { setIsSyncing(false); }` 패턴이 있으면 finally 안에서 `setIsSyncing(false)` 다음에 `await refreshUnsyncedBadge();` 추가. finally 가 없고 함수가 try 만으로 끝나면 try 블록 마지막 줄에 추가.

- [ ] **Step 5: 타입체크 / 회귀 테스트**

Run: `npx tsc --noEmit`
Expected: 사전 에러 외 신규 에러 없음

Run: `npm test`
Expected: 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): wire local-data modal state and handlers

Adds the state, badge refresh, modal open/close, and Excel export
handlers for the upcoming UI box. The button and Dialog markup ship
in the next commit so this change compiles independently.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `admin/page.tsx` — UI 박스 버튼 + Dialog 마크업

**Files:**
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: 박스 안에 `[로컬 데이터]` 버튼 추가**

기존 "Data Sync for Tablets" 박스의 `<Button>` (변동 자동 동기화 트리거)이 우측에 단독으로 있는 형태다. 그 버튼을 감싸는 컨테이너로 바꾸고 새 버튼을 추가한다.

먼저 기존 마크업을 찾는다 — "Data Sync for Tablets" 주석 뒤 `<div className="flex items-center justify-between p-4 border rounded-xl mt-3">` 안의 `<Button>...</Button>` 부분.

기존 (대략적인 형태):
```tsx
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAdminSync}
                      disabled={isSyncing}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {isSyncing ? "동기화 중..." : "데이터 동기화"}
                    </Button>
```

이 `<Button>` 을 다음 wrapping div + 새 버튼 + 기존 버튼으로 교체:

```tsx
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenLocalData}
                        className="relative"
                      >
                        <Database className="h-4 w-4 mr-1" />
                        로컬 데이터
                        {unsyncedBadgeCount > 0 && (
                          <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-xs font-medium rounded-full bg-red-500 text-white">
                            {unsyncedBadgeCount}
                          </span>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAdminSync}
                        disabled={isSyncing}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {isSyncing ? "동기화 중..." : "데이터 동기화"}
                      </Button>
                    </div>
```

- [ ] **Step 2: Dialog 마크업 추가**

`src/app/admin/page.tsx` 의 다른 Dialog들이 모인 영역(첫 번째가 `<Dialog open={sheetDialogOpen}` 부근, 현재 line 1280 근처) 바로 위 또는 아래에 추가:

```tsx
      <Dialog open={localDataDialogOpen} onOpenChange={handleCloseLocalData}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>로컬 저장 데이터 (서버 미전송)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <LocalCheckInsTable
              rows={localRows}
              loading={localLoading}
              errorMessage={localError}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportLocalDataExcel}
                disabled={exportingExcel || localRows.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {exportingExcel ? "다운로드 중..." : "Excel 다운로드"}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => handleCloseLocalData(false)}
              >
                닫기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: 타입체크 / 회귀 테스트**

Run: `npx tsc --noEmit`
Expected: 사전 에러 외 신규 에러 없음

Run: `npm test`
Expected: 회귀 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/admin/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): render local-data button and modal in settings tab

Adds the [로컬 데이터] button (with red unsynced count badge) next to
the existing sync button, plus the Dialog markup that hosts the
LocalCheckInsTable and Excel download button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 수동 dev 검증

**Files:** 없음 (코드 변경 없음)

- [ ] **Step 1: dev 서버 시작**

Run: `npm run dev`
Expected: `http://localhost:3000` 기동

- [ ] **Step 2: 빈 상태 확인**

브라우저에서 `http://localhost:3000/admin/login` → 로그인 → "설정" 탭 → "태블릿 데이터 동기화" 박스에서 `[로컬 데이터]` 버튼 확인. 배지 없음 (미동기 0건).

`[로컬 데이터]` 클릭 → 모달 열림 → "동기화되지 않은 데이터가 없습니다" 메시지 + `[Excel 다운로드]` 버튼 비활성. `[닫기]` 로 닫기.

- [ ] **Step 3: 미동기 데이터 생성**

설정 탭 → 운영 모드를 "로컬"로 토글 → "데이터 동기화" 클릭해 사용자 캐시 다운로드. → 다른 탭에서 `/check` 열기 → QR 몇 건 스캔 (테스트용 학생/교사 QR). 또는 IndexedDB devtools 로 직접 검사 입력.

설정 탭으로 돌아옴 → `[로컬 데이터]` 옆 빨간 배지에 N 카운트 노출 확인.

- [ ] **Step 4: 모달 표 확인**

`[로컬 데이터]` 클릭 → 모달에 표가 보임. 학년반번호·이름·날짜·식사·종류·체크시각·ID 7컬럼. 헤더 sticky, 셀 nowrap, 가로 스크롤 가능. 미동기 N건 텍스트 일치.

- [ ] **Step 5: Excel 다운로드 확인**

`[Excel 다운로드]` 클릭 → `local-checkins-YYYY-MM-DD.xlsx` 파일 다운로드. Excel/Numbers 로 열어 확인:
- 시트명 "로컬 미동기"
- 1행 헤더 8컬럼 bold
- 2행부터 데이터 — `BREAKFAST→조`, `DINNER→석` 변환 확인
- 체크시각 형식 `YYYY-MM-DD HH:MM:SS` (KST 변환됨)
- 컬럼 폭 균일

- [ ] **Step 6: 동기화 후 배지 갱신 확인**

모달 닫기 → "데이터 동기화" 클릭 → 동기화 완료 후 배지 0이 되거나 사라지는지 확인 (성공 동기화 시).

- [ ] **Step 7: dev 서버 종료**

`Ctrl+C` 로 정지.

> 코드 변경 없음 — 별도 커밋 없음. 이슈 발견 시 해당 Task 로 돌아가 수정.

---

## Task 8: PROJECT_MAP.md 갱신 + 최종 검증

**Files:**
- Modify: `.claude/PROJECT_MAP.md`

- [ ] **Step 1: §7 컴포넌트 표에 한 줄 추가**

`.claude/PROJECT_MAP.md` 의 §7 (`## §7 주요 컴포넌트`) 표 안, 마지막 줄(`PageSkeleton` 줄) 다음에 추가:

```markdown
| `LocalCheckInsTable` | `src/components/LocalCheckInsTable.tsx` | 관리자 설정 탭 모달 안 미동기 IDB 체크인 표 + `buildUserLabel` helper |
```

- [ ] **Step 2: §8 lib 표에 한 줄 추가**

§8 lib 표의 `meal-windows-validation.ts` 줄 다음에 추가:

```markdown
| `src/lib/local-checkins-export.ts` | 로컬 미동기 체크인 → .xlsx Blob (관리자 설정 모달 전용, exceljs dynamic import) |
```

- [ ] **Step 3: 펜딩 로그 비우기**

Run (Bash): `: > "E:/Projects/posanmeal/.claude/.project-map-pending.log"`

- [ ] **Step 4: 전체 테스트 + 타입체크 최종**

Run: `npm test`
Expected: 모든 테스트 PASS (기존 + 신규 12개 = ~60개)

Run: `npx tsc --noEmit`
Expected: 사전 에러 외 신규 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add .claude/PROJECT_MAP.md .claude/.project-map-pending.log
git commit -m "$(cat <<'EOF'
docs(project-map): note LocalCheckInsTable and local-checkins-export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 완료 기준

- [ ] `npm test` 통과 (신규 12개: 3 timezone-seconds + 4 buildUserLabel + 5 exportLocalCheckInsXlsx)
- [ ] `npx tsc --noEmit` 통과 (사전 에러 외 신규 없음)
- [ ] `/admin` 설정 탭에서 `[로컬 데이터]` 버튼이 보이고, 미동기 카운트 배지가 정확
- [ ] 모달에서 표·빈 상태·로딩 상태 모두 동작
- [ ] Excel 다운로드 후 파일 헤더·행·시트명·시각 포맷 검증 통과
- [ ] 동기화 후 배지가 갱신
- [ ] PROJECT_MAP §7 + §8 갱신
- [ ] 모든 변경이 git 에 커밋됨 (6개 기능 커밋 + 1개 docs 커밋 = 7개)
