# 관리자 — 조식/석식 시간 윈도우 설정 UI

> 작성일: 2026-05-09
> 범위: `/admin` 의 "설정" 탭 안에 식사 시간 윈도우 편집 박스 1개 추가

## 1. 배경

`SystemSetting` 의 `breakfast_window_start/end`, `dinner_window_start/end` 4개 키는 이미 운영 중이며, `lib/meal-kind.ts:resolveMealKind(now, windows)` 가 QR 토큰 발급 시점에 사용해 BREAKFAST/DINNER/null 을 결정한다. 백엔드 `/api/system/settings` PUT 도 `mealWindows` 입력을 받아 검증·트랜잭션 upsert·캐시 무효화까지 모두 구현되어 있다.

지금까지 시간 윈도우 변경은 DB 직접 수정으로만 가능했다. 이 작업은 관리자 UI에서 안전하게 편집할 수 있도록 박스 1개를 추가한다.

## 2. 비-목표 (out of scope)

- 자정을 넘는 윈도우(예: 23:00–02:00) 지원 — 현재 백엔드가 `start < end` 만 허용하며, 본 작업에서 이 제약은 유지한다.
- 변경 이력 audit log — `SystemSetting.updatedAt` 만 활용.
- 저장 확인 다이얼로그 — 가역적 변경이므로 confirm 불필요.
- "기본값으로 초기화" / "되돌리기" 버튼 — 사용자 결정상 저장 버튼 1개만.
- 학기·학사일정 등 시간 외 다른 운영 설정.

## 3. 변경 범위

| 영역 | 변경 |
|------|------|
| `src/app/admin/page.tsx` | 설정 탭 카드에 4번째 박스 추가, state 3개 + handler 추가, `fetchSystemSettings` 가 `mealWindows` 도 받도록 확장 |
| `src/lib/meal-windows-validation.ts` (신규) | 클라이언트 검증 순수 함수 1개 (`validateMealWindows`) |
| `src/lib/__tests__/meal-windows-validation.test.ts` (신규) | 위 함수 vitest 케이스 |
| 백엔드 `/api/system/settings` | **변경 없음** (이미 `mealWindows` 받음) |
| `lib/settings-cache.ts`, `lib/meal-kind.ts`, `lib/meal-kind-local.ts` | **변경 없음** |
| `/api/sync/download` | **변경 없음** (이미 응답에 `mealWindows` 포함, 태블릿 자동 반영) |
| Prisma 스키마 / 마이그레이션 | **변경 없음** |

## 4. UI

### 4.1 위치

`/admin` "설정" 탭의 카드(`src/app/admin/page.tsx` line 982 부근) 안, 기존 3개 박스(운영 모드 / QR 세대 / 태블릿 동기화) 다음 4번째 박스로 추가.

### 4.2 마크업 개요

```
┌──────────────────────────────────────────────────────────────┐
│ 식사 시간 윈도우                                              │
│ QR 체크인이 가능한 시간대입니다. 시간 외 스캔은 거부됩니다.   │
│                                                              │
│  [조식]  시작 [04:00 ▾]   종료 [10:00 ▾]                     │
│  [석식]  시작 [15:00 ▾]   종료 [21:00 ▾]                     │
│                                                              │
│  ⚠ <검증 에러 메시지> (검증 실패 시에만)                      │
│  ⓘ 태블릿 동기화 후 적용됩니다. (sysMode === "local" 일 때)   │
│                                                              │
│                                              [저장]          │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 스타일

- 박스 외형: 기존 박스와 동일하게 `p-4 border rounded-xl mt-3`.
- 입력: `<input type="time">` 4개. 모바일에서 `flex-col`, `sm:` 이상에서 `flex-row gap-3`.
- 라벨/도움말 색: 기존 패턴(`font-medium` 제목, `text-sm text-muted-foreground` 설명) 일치.
- 검증 에러: `text-sm text-red-600 dark:text-red-400`.
- 로컬 모드 안내: `text-sm text-amber-600 dark:text-amber-400` (기존 운영 모드 안내와 동일 톤).

### 4.4 모바일 / 반응형

- 시간 입력 행은 모바일에서 세로 스택, sm 이상에서 가로. 라벨 `whitespace-nowrap`.
- 카드 자체는 부모 카드의 패딩을 따라가며 `p-4` 내부 박스 유지.
- 박스 길이가 늘어나도 설정 탭이 이미 스크롤 가능 영역(`overflow-hidden` + 내부 스크롤)이라 추가 처리 불필요.

## 5. 데이터 흐름

### 5.1 추가 state

```ts
type WindowsForm = {
  breakfast: { start: string; end: string };
  dinner: { start: string; end: string };
};

const [sysWindows, setSysWindows] = useState<WindowsForm | null>(null);   // 마지막 서버값
const [windowsForm, setWindowsForm] = useState<WindowsForm | null>(null); // 사용자 편집 폼
const [windowsError, setWindowsError] = useState<string | null>(null);
```

### 5.2 로드

기존 `fetchSystemSettings()` 한 곳에서 `data.mealWindows` 도 받아 `sysWindows` 와 `windowsForm` 둘 다 set. 별도 fetch 호출은 추가하지 않는다.

### 5.3 입력 → 검증

- `<input type="time">` onChange → `windowsForm` 업데이트 → `validateMealWindows(windowsForm)` 실행 → `windowsError` 갱신.
- `isDirty = JSON.stringify(windowsForm) !== JSON.stringify(sysWindows)`.
- `[저장]` 버튼: `disabled={!isDirty || !!windowsError || sysLoading}`.

### 5.4 저장

```ts
async function handleSaveWindows() {
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

### 5.5 적용 시점 (동작 사실)

- 서버 인메모리 캐시: 백엔드가 PUT 직전에 `invalidateSettingsCache()` 호출 → 다음 GET 즉시 반영.
- QR 토큰: 학생/교사 페이지가 30초 간격으로 `/api/qr/token` 재발급 → 다음 발급부터 새 윈도우의 `mealKind`. 이미 발급된 3분 만료 토큰은 옛 윈도우. → toast 문구 "새 QR부터 적용" 으로 전달.
- 로컬 모드(태블릿): 다음 동기화에서 `/api/sync/download` 응답의 `mealWindows` 로 갱신. → 박스 하단 안내로 전달.

## 6. 검증 (`src/lib/meal-windows-validation.ts`)

```ts
export type MealWindowsForm = {
  breakfast: { start: string; end: string };
  dinner: { start: string; end: string };
};

export function validateMealWindows(form: MealWindowsForm): string | null;
export function mapServerError(serverError: string | undefined): string | null;
```

규칙 (백엔드 `/api/system/settings` PUT 와 의미 동일):

1. 4개 값 모두 `^\d{2}:\d{2}$` 매칭. 미매칭 → `"시간을 HH:MM 형식으로 입력해주세요"`.
2. 각 윈도우: `start < end` (분 단위 변환 비교). 위반 → `"종료 시간은 시작 시간보다 늦어야 합니다"`.
3. 두 윈도우 비겹침: `bfEnd > dnStart && bfStart < dnEnd` 가 true 면 겹침. 위반 → `"조식과 석식 시간대가 겹칠 수 없습니다"`.
4. 인접(`bfEnd === dnStart` 또는 `dnEnd === bfStart`)은 허용.
5. 자정을 넘는 윈도우(`start > end`)는 허용하지 않음 — 위 규칙 2에서 잡힘.

`mapServerError(serverErrorString)` 도 같은 모듈에 두어 백엔드 영문 에러를 위 한국어 메시지로 매핑.

## 7. 에러 처리 / 엣지 케이스

| 케이스 | 동작 |
|--------|------|
| GET `/api/system/settings` 실패 | `sysWindows`/`windowsForm` `null` 유지 → "설정을 불러올 수 없습니다. 새로고침 해주세요." 표시, 입력 비활성. |
| `<input type="time">` 빈 값 | 검증 함수가 즉시 에러 반환, 저장 버튼 비활성. |
| 두 윈도우 정확히 인접 (예: 10:00 / 10:00) | 통과. |
| 자정을 넘는 윈도우 | 규칙 2에서 거부. |
| 동시 편집 (관리자 두 명) | 마지막 저장 승. 별도 충돌 처리 없음. 저장 후 폼이 최신 서버값으로 동기화. |

## 8. 권한

설정 탭 자체가 `!adminPerm.isSubadmin` 으로 ADMIN 전용 표시(`src/app/admin/page.tsx` line 1004 부근). 새 박스도 같은 분기 안에 들어가므로 별도 권한 체크 불필요. 백엔드 PUT 도 `canWriteAdmin` 으로 ADMIN 만 통과.

## 9. 테스트

| 종류 | 위치 | 내용 |
|------|------|------|
| 단위 (vitest) | `src/lib/__tests__/meal-windows-validation.test.ts` (신규) | `validateMealWindows` — 정상값 통과, start≥end 거부, 겹침 거부, 빈값 거부, 인접 허용, 한국어 메시지 매핑 |
| 단위 | 기존 `meal-kind.ts` 테스트 | **변경 없음** (resolveMealKind 미수정) |
| 백엔드 통합 | 없음 | `/api/system/settings` PUT 검증은 이미 백엔드에 있음. 본 작업이 백엔드를 안 바꾸므로 추가 테스트 안 만듦. |
| 수동 dev 검증 | — | (1) 박스 로드 (2) 정상 저장 → toast (3) start≥end → 인라인 에러 + 저장 비활성 (4) 윈도우 겹침 → 동일 (5) 저장 후 학생 페이지 30초 내 새 토큰 발급 시 mealKind 변경 |

## 10. 파일별 변경 요약

| 파일 | 변경 내용 | 예상 라인 |
|------|----------|-----------|
| `src/app/admin/page.tsx` | state 3개, handler 1개, `fetchSystemSettings` 확장, 설정 탭 4번째 박스 마크업 | ~80줄 추가 |
| `src/lib/meal-windows-validation.ts` (신규) | `MealWindowsForm`, `validateMealWindows`, `mapServerError` | ~50줄 |
| `src/lib/__tests__/meal-windows-validation.test.ts` (신규) | vitest 케이스 | ~40줄 |
| `.claude/PROJECT_MAP.md` | §8 lib 표에 `meal-windows-validation.ts` 한 줄 추가 | 1줄 |

## 11. 마이그레이션 / 롤백

- 마이그레이션 없음.
- 롤백 시 새 박스만 제거하면 끝. SystemSetting DB 값은 변경되지 않으며, 변경된 값이 있어도 백엔드/`resolveMealKind` 가 동일 키를 계속 사용하므로 무영향.
