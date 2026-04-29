# 체크인 시각 날짜 표시 + 출처(QR/관리자/로컬) 구분

작성일: 2026-04-29
상태: Draft

## 배경 / 문제

관리자 당일현황 화면과 일자별 Excel에서 다음을 알 수 없다:

1. 체크인된 시각이 시간만 보여(`HH:mm`) 화면에 떠 있는 날짜와 결합해서만 의미를 갖는다. Excel을 외부에서 열거나 행을 다른 시트에 복사하면 맥락이 사라진다.
2. 체크인이 **QR 스캔**으로 들어왔는지 **관리자가 수동**으로 표시했는지 구분이 불가하다. 이는 출결 검증·이상 감지·문의 응대에 필요하다.

## 목표

1. 당일현황 표 / 일자별 Excel 모두 체크인 시각을 `YYYY-MM-DD HH:mm` 형식으로 표시.
2. 두 곳 모두 **출처** 컬럼을 추가해 `QR` / `관리자` / `로컬` / `—`(unknown)으로 표시.
3. 신규 체크인은 생성 경로에 따라 정확한 출처를 영구 저장.
4. 기존 체크인 row 는 출처를 알 수 없으므로 NULL → `—` 으로 표시(소급 추정 금지).

## 비목표

- 기존 행 백필. 어떤 행이 어디서 왔는지 안전하게 추정할 수 없음.
- 학생/교사 본인 화면(달력·확인 탭) 출처 노출. 관리자 도구 한정.
- 출처 변경 기능. 표시만 한다.

## 데이터 모델 변경

### `CheckIn` 모델 — `source` 컬럼 추가 (additive)

```prisma
enum CheckInSource {
  QR             // QR 스캐너 경유 (/api/checkin)
  ADMIN_MANUAL   // 관리자 수동 cycle/toggle (/api/admin/checkins/toggle)
  LOCAL_SYNC     // 로컬 모드 태블릿 → 동기화 업로드 (/api/sync/upload)
}

model CheckIn {
  id        Int            @id @default(autoincrement())
  userId    Int
  date      DateTime       @db.Date
  checkedAt DateTime       @default(now())
  type      CheckInType
  source    CheckInSource? // nullable: 기존 row 보호

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, date])
  @@index([date])
  @@index([userId])
}
```

마이그레이션은 **순수 additive** 다. CLAUDE.md 의 공유 DB 안전 규칙에 부합:
- 새 enum, 새 nullable 컬럼.
- 기존 row 는 NULL 유지 — 옛 코드(prod) 가 SELECT 시 무시, INSERT 시 NULL 설정 → 정상 동작.
- 신규 코드(test 먼저 배포) 가 모든 신규 INSERT 에 source 를 채움.

배포 순서: feat/posanmeal-mvp 푸시 → test 서비스 마이그레이션 + 새 코드 → 검증 → main 머지 → prod 새 코드.

## API 변경

### `POST /api/checkin` (QR 경로)

```ts
await prisma.checkIn.create({
  data: {
    userId: payload.userId,
    date: todayDate,
    type: payload.type,
    source: "QR",
  },
});
```

### `POST /api/admin/checkins/toggle` (관리자 수동)

`prisma.checkIn.create(...)` 호출 두 곳에 `source: "ADMIN_MANUAL"` 추가. UPDATE 분기는 source 변경 없음(원래 출처 유지).

### `POST /api/sync/upload` (로컬 모드 태블릿)

```ts
await prisma.checkIn.create({
  data: {
    userId: ci.userId,
    date: dateObj,
    checkedAt: new Date(ci.checkedAt),
    type: ci.type,
    source: "LOCAL_SYNC",
  },
});
```

태블릿 IndexedDB 스키마는 변경하지 않는다. 모든 업로드 행은 서버에서 LOCAL_SYNC 로 분류된다.

### `GET /api/admin/dashboard`

응답 records 에 `source` 필드 추가.

```ts
records: records.map((c) => ({
  id: c.id,
  userName: c.user.name,
  role: c.user.role,
  type: c.type,
  source: c.source,  // "QR" | "ADMIN_MANUAL" | "LOCAL_SYNC" | null
  checkedAt: c.checkedAt.toISOString(),
  ...
}))
```

`select` 에 `source: true` 추가.

### `GET /api/admin/export?date=...` (일자별 Excel)

`exportDaily` 의 select 에 `source: true` 추가. 시트에 "출처" 컬럼 추가.

## 프론트엔드 변경

### 타입

```ts
type CheckInSource = "QR" | "ADMIN_MANUAL" | "LOCAL_SYNC" | null;

interface DashboardRecord {
  id: number; userName: string; role: string; type: string;
  source: CheckInSource;
  checkedAt: string;
  grade?: number; classNum?: number; number?: number;
}
```

### 라벨 헬퍼

```ts
function sourceLabel(source: CheckInSource): string {
  if (source === "QR") return "QR";
  if (source === "ADMIN_MANUAL") return "관리자";
  if (source === "LOCAL_SYNC") return "로컬";
  return "—";
}
```

`src/lib/checkin-source.ts` 라는 작은 파일을 만들어 export. 관리자 페이지·Excel 라우트에서 공유 가능 (Excel 라우트는 Node 측이라 import 가능).

### 당일현황 표 — `src/app/admin/page.tsx`

**컬럼**: `이름 | 구분 | 체크인 시각 | 출처 | 수정`

- "체크인 시각" 셀: `new Date(r.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })` → 예: `2026. 04. 29. 17:30` (ko-KR 기본).
  - 더 깔끔한 `YYYY-MM-DD HH:mm` 포맷 원하면 `formatDateTimeKST` 헬퍼를 `src/lib/timezone.ts` 에 추가:
    ```ts
    export function formatDateTimeKST(d: Date): string {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
    }
    ```
  - 결정: 위 헬퍼 추가하고 `2026-04-29 17:30` 포맷으로 통일.
- "출처" 셀: Badge `outline` 스타일.
  - QR: 기본 회색 outline
  - 관리자: 노란/앰버 톤 outline
  - 로컬: 파랑 톤 outline
  - —: 회색 muted text
- 셀은 `whitespace-nowrap` 유지 (모바일 가로 스크롤로 대응).

### Excel 시트 — `exportDaily`

**컬럼**: `구분 | 학년 | 반 | 번호 | 이름 | 교과 | 체크인 시각 | 출처`

- "체크인 시각": `formatDateTimeKST(r.checkedAt)` → `2026-04-29 17:30`.
- "출처": `sourceLabel(r.source)` → `QR` / `관리자` / `로컬` / `—`.
- 컬럼 너비: 출처 8, 체크인 시각 18 (날짜 추가에 따라 확대).

## 데이터 흐름

```
[QR 스캔]    → POST /api/checkin             → source="QR"
[관리자 토글] → POST /api/admin/checkins/toggle → source="ADMIN_MANUAL" (CREATE 분기만)
[태블릿 업로드] → POST /api/sync/upload         → source="LOCAL_SYNC"

[당일현황 fetch] → GET /api/admin/dashboard?date=… → records[].source 포함
[일자별 Excel] → GET /api/admin/export?date=…    → "출처" 컬럼 포함
```

## 에러 / 엣지 케이스

- 기존 row(source=null): `—` 로 표시. 별도 백필 안 함.
- /api/admin/checkins/toggle 의 update 분기(WORK ↔ PERSONAL): source 유지. 의미적으로 정확 — type 변경은 분류 변경이지 출처 재할당이 아님.
- 토글로 삭제 후 다시 생성하는 시나리오(예: 학생 toggle): 새 row 의 source="ADMIN_MANUAL". OK.

## 마이그레이션 / 배포 순서

1. `npx prisma migrate dev --name add_checkin_source` 로 로컬 마이그레이션 생성·검증.
2. `prisma-migration-guardian` 으로 검수.
3. feat/posanmeal-mvp 푸시 → Railway test 서비스 자동 배포. start 커맨드의 `prisma migrate deploy` 가 공유 DB 에 컬럼 추가.
4. test 서비스에서 다음 검증:
   - QR 체크인 → Source="QR" 로 기록되는지 (DB 직접 확인 또는 Excel 다운로드로 확인).
   - 관리자 수동 토글 → "관리자".
   - (가능하면) 로컬 태블릿 sync → "로컬".
   - Excel 시각 포맷·출처 컬럼.
   - 대시보드 표 시각 포맷·출처 Badge.
5. main 머지 → prod 배포. 같은 컬럼은 이미 적용된 상태.

## 테스트 / 검증 계획

- `npx tsc --noEmit` 클린.
- `npx eslint` 변경 파일 클린.
- 수동: 위 4번 4가지 시나리오.
- responsive-ui-reviewer 로 표 컬럼 추가에 따른 모바일 가로 스크롤 확인.

## 영향 / 리스크

- 옛 prod 코드가 새 schema 와 공유될 짧은 윈도우(test 먼저 배포 후 main 머지 전)에서 prod 가 만든 신규 row 는 source=null 로 들어감. 운영적으로 며칠 안에 main 머지하면 영향 미미.
- 컬럼 추가 외 기존 동작 변경 없음.
