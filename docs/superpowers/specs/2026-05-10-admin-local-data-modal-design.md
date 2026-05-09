# 관리자 — 로컬 미동기 체크인 뷰어 모달 + Excel 내보내기

> 작성일: 2026-05-10
> 범위: `/admin` "설정" 탭의 "태블릿 데이터 동기화" 박스에 `[로컬 데이터]` 버튼과 모달 추가

## 1. 배경

`/check` 페이지는 로컬 모드에서 IndexedDB(`posanmeal-local` v4) 의 `checkins` 스토어에 체크인을 쌓고, 관리자가 "데이터 동기화" 버튼을 눌러 `/api/sync/upload` 로 일괄 전송한다. 직전 사이클에서 발견된 데이터 누락 버그(rescue 커밋들로 수정)도 이 경로에서 발생했으며, 운영 중 "QR 체크인 숫자가 부족해 보인다"는 의심을 즉시 검증할 도구가 없다.

본 작업은 관리자가 태블릿/브라우저에서 **현재 IndexedDB 에 쌓여 있고 아직 서버로 가지 못한** 체크인 목록을 표로 확인하고, 필요 시 Excel 로 내보낼 수 있는 모달을 추가한다. 운영 중 누락 의심 사례 추적·증빙용.

## 2. 비-목표 (out of scope)

- "이 행 재전송" / "이 행 삭제" 류 액션 — 본 작업은 **읽기 전용 + Excel 내보내기**.
- 동기화된(synced) 체크인 표시 — 사용자 결정상 unsynced 만.
- 자동 새로고침/polling — 모달은 열 때 1회 스냅샷.
- 페이지네이션 / 가상 스크롤 / 컬럼 정렬·필터 — 행 수 시나리오상 불필요.
- 서버 측 추가 라우트 — 데이터의 정의 자체가 "아직 서버 모름" 이므로 100% 클라이언트 처리.

## 3. 변경 범위

| 영역 | 변경 |
|------|------|
| `src/app/admin/page.tsx` | state 6개, handler 4개(`refreshUnsyncedBadge`, `handleOpenLocalData`, `handleCloseLocalData`, `handleExportLocalDataExcel`) + `triggerDownload` 인라인 헬퍼, 기존 "태블릿 데이터 동기화" 박스에 `[로컬 데이터]` 버튼 + 배지 추가, Dialog 마크업 추가 |
| `src/components/LocalCheckInsTable.tsx` (신규) | 모달 안 표 컴포넌트, `LocalCheckInRow` 타입 + `buildUserLabel` helper export |
| `src/lib/local-checkins-export.ts` (신규) | 클라이언트 exceljs 빌더 — `exportLocalCheckInsXlsx(rows): Promise<Blob>` |
| `src/lib/__tests__/local-checkins-export.test.ts` (신규) | 빌더 + helper vitest |
| 백엔드 `/api/sync/upload`, Prisma 스키마, `local-db.ts` | **변경 없음** |
| `.claude/PROJECT_MAP.md` | §7 컴포넌트 + §8 lib 표에 한 줄씩 추가 |

## 4. UI

### 4.1 "태블릿 데이터 동기화" 박스 (기존 박스 보강)

```
┌─ 태블릿 데이터 동기화 ──────────────────────────────────────┐
│ 사용자·석식기간·설정을 이 기기에 저장합니다              │
│ [상태 메시지 (있을 때)]                                  │
│                                                          │
│                     [로컬 데이터 (3)]  [데이터 동기화]    │
└──────────────────────────────────────────────────────────┘
```

- `[로컬 데이터]` 버튼: outline variant, lucide `Database` 아이콘, 우측 정렬, `[데이터 동기화]` 와 같은 행, 모바일에서 `flex-wrap` 로 줄바꿈 허용.
- 카운트 배지: 빨간 작은 원 안에 숫자 (`bg-red-500 text-white text-xs rounded-full px-1.5`). 0 일 때 숨김.
- 카운트 갱신: 마운트 시 1회, `handleAdminSync` 종료 직후, 모달 닫을 때.

### 4.2 모달 (shadcn `Dialog`)

```
┌─ 로컬 저장 데이터 (서버 미전송) ─────────────── × ┐
│ N건의 체크인이 아직 서버로 전송되지 않았습니다.  │
│ ⓘ M건은 사용자 정보 매핑 실패 (캐시 미스 시에만) │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ 학년반번호│이름 │날짜 │식사│종류    │체크시각 │ID│ │
│ ├──────────────────────────────────────────────┤ │
│ │ 1-2-15  │홍길동│...│석│STUDENT │18:32:11│42│ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│                     [Excel 다운로드] [닫기]       │
└──────────────────────────────────────────────────┘
```

- `<DialogContent className="max-w-3xl">` — 모바일에서 너비 자동 축소.
- 표 컨테이너 `overflow-x-auto`, 셀 `whitespace-nowrap`, `<thead>` `sticky top-0` + 불투명 배경.
- 컬럼: 학년반번호 / 이름 / 날짜 / 식사 / 종류 / 체크시각 / ID.
- "식사" 컬럼: `BREAKFAST` → `조`, `DINNER` → `석`.
- "종류" 컬럼: 영문 (`STUDENT/WORK/PERSONAL`) — 디버깅 명확성.
- "체크시각": `formatKST(checkedAt, "HH:mm:ss")`.
- ID 컬럼: IDB autoincrement id (운영 문의 시 식별).
- 버튼 영역: `[Excel 다운로드]` (행 0건이면 disabled, 다운로드 중이면 disabled), `[닫기]`.

### 4.3 빈/오류 상태

- 빈 (unsynced 0): 표 자리에 회색 메시지 "동기화되지 않은 데이터가 없습니다". Excel disabled.
- 로딩: "불러오는 중..." 텍스트 1줄.
- IDB 미지원: "이 브라우저에서는 로컬 저장소를 지원하지 않습니다." 빨간 메시지.
- IDB 조회 실패: 빨간 메시지 "로컬 데이터를 불러오지 못했습니다" + toast.error.

### 4.4 모바일 / 반응형

- 박스 새 버튼은 `flex-wrap` 로 작은 화면에서 줄바꿈.
- 모달은 `Dialog` 의 기본 모바일 풀스크린 처리에 의존.
- 표는 `overflow-x-auto` 컨테이너 안에서 가로 스크롤 (셀 모두 `whitespace-nowrap`).

## 5. 데이터 흐름

### 5.1 행 타입

```ts
// src/components/LocalCheckInsTable.tsx 에서 export
export interface LocalCheckInRow {
  id: number;
  userId: number;
  userLabel: string;          // "1-2-15" | "교사" | "id:N" | u.name
  name: string;               // local users 미스 시 "-"
  date: string;               // "YYYY-MM-DD"
  mealKind: "BREAKFAST" | "DINNER";
  type: "STUDENT" | "WORK" | "PERSONAL";
  checkedAt: string;          // ISO
}
```

### 5.2 admin/page.tsx state

```ts
const [localDataDialogOpen, setLocalDataDialogOpen] = useState(false);
const [localRows, setLocalRows] = useState<LocalCheckInRow[]>([]);
const [localLoading, setLocalLoading] = useState(false);
const [localError, setLocalError] = useState<string | null>(null);
const [unsyncedBadgeCount, setUnsyncedBadgeCount] = useState(0);
const [exportingExcel, setExportingExcel] = useState(false);
```

### 5.3 배지 갱신 (`refreshUnsyncedBadge`)

```ts
async function refreshUnsyncedBadge() {
  try {
    const { getUnsyncedCount } = await import("@/lib/local-db");
    setUnsyncedBadgeCount(await getUnsyncedCount());
  } catch {
    setUnsyncedBadgeCount(0);
  }
}
```

호출 시점:
- 페이지 마운트 useEffect (한 번).
- `handleAdminSync` 의 finally / 종료 직후.
- 모달 닫힐 때 (`onOpenChange(false)`).

### 5.4 모달 열기 (`handleOpenLocalData`)

```ts
async function handleOpenLocalData() {
  setLocalDataDialogOpen(true);
  setLocalLoading(true);
  setLocalError(null);
  setLocalRows([]);
  try {
    const { getUnsyncedCheckIns, getUser } = await import("@/lib/local-db");
    const checkins = await getUnsyncedCheckIns();
    const userIds = Array.from(new Set(checkins.map((c) => c.userId)));
    const userMap = new Map<number, LocalUser>();
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
```

### 5.5 모달 닫기

```ts
function handleCloseLocalData(open: boolean) {
  setLocalDataDialogOpen(open);
  if (!open) {
    setLocalRows([]);
    setLocalError(null);
    refreshUnsyncedBadge();
  }
}
```

### 5.6 Excel 다운로드

```ts
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

## 6. 라이브러리 — `src/lib/local-checkins-export.ts`

```ts
import type { LocalCheckInRow } from "@/components/LocalCheckInsTable";
import { formatKST } from "@/lib/timezone";

const HEADERS = ["IDB ID", "사용자ID", "학년반번호", "이름", "날짜", "식사", "종류", "체크시각(KST)"];

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
      formatKST(r.checkedAt, "yyyy-MM-dd HH:mm:ss"),
    ]);
  }
  ws.columns.forEach((col) => { col.width = 14; });
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
```

dynamic import 로 exceljs 가 초기 번들에 포함되지 않도록 한다 (모달 열고 다운로드 누를 때만 로드).

## 7. 컴포넌트 — `src/components/LocalCheckInsTable.tsx`

Props:
```ts
interface LocalCheckInsTableProps {
  rows: LocalCheckInRow[];
  loading: boolean;
  errorMessage: string | null;
}
```

책임:
- 빈/로딩/에러/정상 4가지 상태 분기.
- 표 마크업 (sticky header, overflow-x-auto, 셀 nowrap).
- `userLabel` / `mealKind 한글화` / `formatKST` 변환은 prop 으로 들어오는 행이 이미 가공되어 있다고 가정 (모달 열기 핸들러에서 처리).

`buildUserLabel` 도 같은 파일에서 export — 단순 함수, 별도 파일 분리는 과함:

```ts
import type { LocalUser } from "@/lib/local-db";

export function buildUserLabel(u: LocalUser | undefined, userId: number): string {
  if (!u) return `id:${userId}`;
  if (u.role === "TEACHER") return "교사";
  if (u.grade && u.classNum && u.number) {
    return `${u.grade}-${u.classNum}-${u.number}`;
  }
  return u.name;
}
```

## 8. 에러 처리 / 엣지 케이스

| 케이스 | 동작 |
|--------|------|
| IDB 미지원 / quota / 잠김 | catch → 표 자리 빨간 메시지 + toast.error. 모달 유지 (재시도 가능). |
| `users` 캐시 미스 | `userLabel = "id:N"`, `name = "-"`. 모달 상단에 "ⓘ M건은 사용자 정보 매핑 실패" 안내 (M ≥ 1 일 때만). |
| unsynced 0건 | 빈 메시지 + Excel disabled. |
| 모달 도중 다른 탭에서 동기화 발생 | 자동 새로고침 안 함. 닫고 다시 열면 최신. |
| exceljs dynamic import 실패 | catch → toast.error("엑셀 모듈 로드 실패. 다시 시도해주세요"). |
| Excel 다운로드 중 연타 | `exportingExcel` 로 버튼 disabled. |
| Blob URL 메모리 누수 | `URL.revokeObjectURL` 명시적 호출. |
| 학생인데 학년/반/번호 결측 | `userLabel = u.name` fallback. |
| `checkedAt` 가 잘못된 ISO | `formatKST` 결과 그대로 표시 (디버깅 가시화). |
| 매우 많은 행 (>10000) | 시나리오상 비현실. 최적화 안 함. |

**의도적으로 안 하는 것 (재확인):**
- 행 단위 액션, 자동 새로고침, 페이지네이션, 컬럼 정렬·필터.

## 9. 권한

설정 탭 자체가 `!adminPerm.isSubadmin` 으로 ADMIN 전용. 새 버튼·모달도 같은 분기 안. 별도 권한 체크 불필요.

## 10. 테스트

| 종류 | 위치 | 내용 |
|------|------|------|
| 단위 (vitest) | `src/lib/__tests__/local-checkins-export.test.ts` (신규) | `exportLocalCheckInsXlsx`: 빈 입력(헤더만) / 정상 행 매핑 / `BREAKFAST→조`·`DINNER→석` 변환 / `formatKST` 적용 / 컬럼 너비 / 헤더 bold / Blob MIME |
| 단위 (vitest) | 같은 파일 | `buildUserLabel`: 학생 정상 / 교사 / 학년 결측 학생 / 캐시 미스 |
| 컴포넌트 테스트 | 안 함 | 단순 props→마크업, 수동 dev 검증으로 충분 |
| 백엔드 통합 | 없음 | 백엔드 미변경 |
| 수동 dev 검증 | — | (1) 빈 모달 (2) 로컬 모드 → `/check` 스캔 N건 → 배지 N (3) 모달 표·Excel 다운로드 (4) 동기화 후 배지 0 |

## 11. 파일별 변경 요약

| 파일 | 변경 | 예상 라인 |
|------|------|-----------|
| `src/app/admin/page.tsx` | state 6개, handler 3개, 박스 버튼+배지, Dialog 마크업 | ~110줄 추가 |
| `src/components/LocalCheckInsTable.tsx` (신규) | Props 정의, 4상태 분기, 표 + helper | ~110줄 |
| `src/lib/local-checkins-export.ts` (신규) | `exportLocalCheckInsXlsx(rows): Promise<Blob>` (exceljs dynamic import) | ~40줄 |
| `src/lib/__tests__/local-checkins-export.test.ts` (신규) | 9 케이스 | ~120줄 |
| `.claude/PROJECT_MAP.md` | §7 + §8 한 줄씩 | 2줄 |

## 12. 마이그레이션 / 롤백

- 마이그레이션 없음 (Prisma 스키마 무변경, IDB 스키마 무변경).
- 롤백 시 새 파일 2개 삭제 + admin/page.tsx 변경분 revert. 기존 동기화·QR·체크인 흐름에 영향 없음.
