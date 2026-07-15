# 신청 통계 엑셀 "학년별-성별" 시트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고 통계 엑셀 내보내기(`GET /api/admin/applications/[id]/export`)에 4번째 시트 "학년별-성별"을 추가한다 — 식사(조/중/석)별로 학년×성별 신청 인원 표를 세로로 쌓는다.

**Architecture:** `src/lib/meal-stats-excel.ts`의 `buildStatsWorkbook`에 `buildSheet4`를 추가한다(시트2 "요일별"과 같은 정적 값 계산 방식). export 라우트는 user select에 `gender`만 추가해 이미 선언돼 있지만 채워지지 않던 `StatsExcelInput.rows[].gender`를 연결한다. DB·UI 변경 없음.

**Tech Stack:** Next.js 16 Route Handler, exceljs(dynamic import), vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-grade-gender-sheet-design.md`

## Global Constraints

- 시트명은 정확히 `학년별-성별`, 워크북의 4번째(마지막) 시트.
- 식사 블록 순서는 `MEAL_KINDS` 순(조식→중식→석식), 공고가 제공하는 식사(`input.meals`)만 생성. 블록 = 라벨 행(bold) + 헤더 행 + 학년 행들 + 합계 행, 블록 사이 빈 행 1줄.
- 카운트 기준: `(row.dates[kind]?.length ?? 0) > 0` (시트1 "식수" 컬럼과 동일). 면제 학생 포함.
- 성별 매핑: `"MALE"`→남, `"FEMALE"`→여, 그 외(null/undefined 등)→미지정.
- 미지정 열·학년미상 행은 **카운트되는 신청자**(확정일 1일 이상) 중 해당자가 있을 때만, 시트 전체에 일괄 추가.
- 헤더/라벨 스타일은 파일 내 기존 `styleHeader`/`HEADER_FILL`/`THIN_BORDER` 재사용.
- 라벨 문자열: `구분`, `남`, `여`, `미지정`, `계`, `1학년`/`2학년`/`3학년`, `학년미상`, `합계`. 식사 라벨은 `MEAL_LABEL` (조식/중식/석식).

---

### Task 1: `buildSheet4` — 학년별-성별 시트 생성 (TDD)

**Files:**
- Modify: `src/lib/meal-stats-excel.ts` (import 1줄, `buildSheet4` 함수 추가, `buildStatsWorkbook`에서 호출)
- Test: `src/lib/__tests__/meal-stats-excel.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 기존 `StatsExcelInput` (rows에 `gender?: string | null` 이미 선언됨), `styleHeader`/`HEADER_FILL`/`THIN_BORDER`, `MEAL_KINDS`/`MEAL_LABEL` (`@/lib/meal-plan`)
- Produces: 워크북 4번째 시트 `학년별-성별`. 함수 시그니처 `buildSheet4(workbook: ExcelJSType.Workbook, input: StatsExcelInput): void` (파일 내부 전용, export 아님)

- [ ] **Step 1: feature 브랜치 생성**

```bash
git checkout -b feat/stats-grade-gender-sheet
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/meal-stats-excel.test.ts` 맨 아래에 추가:

```ts
// ── 학년별-성별 시트 ──
// 중식+석식 제공 공고. s4는 확정일 0일 + 성별 누락 → 어디에도 카운트되지 않고
// 미지정 열도 유발하지 않아야 한다.
const gradeGenderInput = {
  title: "2026년 07월 급식신청",
  months: [{ year: 2026, month: 7 }],
  meals: [
    { mealKind: "LUNCH" as const, price: 6000 },
    { mealKind: "DINNER" as const, price: 5680 },
  ],
  openDates: {
    LUNCH: ["2026-07-21"],
    DINNER: ["2026-07-21", "2026-07-22"],
  },
  rows: [
    {
      seq: 1, createdAt: "2026-06-10 09:00:00", loginId: "s1", studentNo: 10101,
      name: "학생A", grade: 1, classNum: 1, number: 1, gender: "MALE",
      exempt: {}, dates: { LUNCH: ["2026-07-21"], DINNER: ["2026-07-21"] },
    },
    {
      seq: 2, createdAt: "2026-06-10 09:01:00", loginId: "s2", studentNo: 10102,
      name: "학생B", grade: 1, classNum: 1, number: 2, gender: "FEMALE",
      exempt: {}, dates: { DINNER: ["2026-07-22"] },
    },
    {
      seq: 3, createdAt: "2026-06-10 09:02:00", loginId: "s3", studentNo: 20101,
      name: "학생C", grade: 2, classNum: 1, number: 1, gender: "MALE",
      exempt: {}, dates: { DINNER: ["2026-07-21", "2026-07-22"] },
    },
    {
      seq: 4, createdAt: "2026-06-10 09:03:00", loginId: "s4", studentNo: 30101,
      name: "학생D", grade: 3, classNum: 1, number: 1, gender: null,
      exempt: {}, dates: {},
    },
  ],
};

describe("buildStatsWorkbook — 학년별-성별 시트", () => {
  // 레이아웃 (미지정·학년미상 없음):
  // 1:중식라벨 2:헤더 3~5:1~3학년 6:합계 7:(빈) 8:석식라벨 9:헤더 10~12:1~3학년 13:합계
  it("4번째 시트로 존재", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    expect(wb.worksheets[3]?.name).toBe("학년별-성별");
  });

  it("중식 표가 위, 석식 표가 아래 (조식 표 없음)", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("A1").value).toBe("중식");
    expect(ws.getCell("A8").value).toBe("석식");
    const colA: unknown[] = [];
    ws.eachRow((row) => colA.push(row.getCell(1).value));
    expect(colA).not.toContain("조식");
  });

  it("성별 누락자가 카운트 대상에 없으면 남/여/계 3열", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B2").value).toBe("남");
    expect(ws.getCell("C2").value).toBe("여");
    expect(ws.getCell("D2").value).toBe("계");
  });

  it("중식 1학년 남 1 / 계 1, 합계 행 일치", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B3").value).toBe(1); // 1학년 남
    expect(ws.getCell("C3").value).toBe(0);
    expect(ws.getCell("D3").value).toBe(1);
    expect(ws.getCell("A6").value).toBe("합계");
    expect(ws.getCell("B6").value).toBe(1);
    expect(ws.getCell("D6").value).toBe(1);
  });

  it("석식 학년×성별 카운트 (dates 없는 s4 제외)", async () => {
    const wb = await buildStatsWorkbook(gradeGenderInput);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("B10").value).toBe(1); // 1학년 남
    expect(ws.getCell("C10").value).toBe(1); // 1학년 여
    expect(ws.getCell("D10").value).toBe(2);
    expect(ws.getCell("B11").value).toBe(1); // 2학년 남
    expect(ws.getCell("B13").value).toBe(2); // 합계 남
    expect(ws.getCell("C13").value).toBe(1); // 합계 여
    expect(ws.getCell("D13").value).toBe(3); // 합계 계
  });

  it("성별 누락 신청자가 있으면 미지정 열 추가", async () => {
    const input = {
      ...gradeGenderInput,
      rows: [
        ...gradeGenderInput.rows,
        {
          seq: 5, createdAt: "2026-06-10 09:04:00", loginId: "s5", studentNo: 30102,
          name: "학생E", grade: 3, classNum: 1, number: 2, gender: null,
          exempt: {}, dates: { DINNER: ["2026-07-21"] },
        },
      ],
    };
    const wb = await buildStatsWorkbook(input);
    const ws = wb.getWorksheet("학년별-성별")!;
    expect(ws.getCell("D2").value).toBe("미지정");
    expect(ws.getCell("E2").value).toBe("계");
    expect(ws.getCell("D12").value).toBe(1); // 석식 3학년 미지정
    expect(ws.getCell("E13").value).toBe(4); // 석식 합계 계
  });

  it("학년 정보 없는 신청자가 있으면 학년미상 행 추가", async () => {
    const input = {
      ...gradeGenderInput,
      rows: [
        ...gradeGenderInput.rows,
        {
          seq: 5, createdAt: "2026-06-10 09:05:00", loginId: "s6", studentNo: 0,
          name: "학생F", grade: undefined, classNum: undefined, number: undefined,
          gender: "MALE", exempt: {}, dates: { LUNCH: ["2026-07-21"] },
        },
      ],
    };
    const wb = await buildStatsWorkbook(input);
    const ws = wb.getWorksheet("학년별-성별")!;
    // 학년미상 행이 3학년 아래 삽입: 3~5:1~3학년 6:학년미상 7:합계
    expect(ws.getCell("A6").value).toBe("학년미상");
    expect(ws.getCell("B6").value).toBe(1);
    expect(ws.getCell("A7").value).toBe("합계");
    expect(ws.getCell("B7").value).toBe(2); // 중식 합계 남 = 학생A + 학생F
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/meal-stats-excel.test.ts`
Expected: 기존 테스트 PASS, 새 describe 7건 모두 FAIL (`학년별-성별` 시트가 없어 `getWorksheet(...)!` 이후 접근에서 실패 / `worksheets[3]` undefined)

- [ ] **Step 4: `buildSheet4` 구현**

`src/lib/meal-stats-excel.ts` 수정.

(a) import에 `MEAL_LABEL` 추가:

```ts
import { MEAL_KINDS, MEAL_LABEL, MEAL_SHORT, WEEKDAY_LABELS, weekdayOf } from "@/lib/meal-plan";
```

(b) `buildSheet3` 함수 뒤에 추가:

```ts
type GenderKey = "MALE" | "FEMALE" | "UNKNOWN";

function genderKeyOf(gender: string | null | undefined): GenderKey {
  return gender === "MALE" || gender === "FEMALE" ? gender : "UNKNOWN";
}

const KNOWN_GRADES = [1, 2, 3];

function buildSheet4(
  workbook: ExcelJSType.Workbook,
  input: StatsExcelInput,
): void {
  const ws = workbook.addWorksheet("학년별-성별");

  const kinds = (MEAL_KINDS as MealKind[]).filter((kind) =>
    input.meals.some((m) => m.mealKind === kind),
  );

  // 시트1 "식수"와 동일 기준: 확정일 1일 이상인 신청자만 카운트
  const appliedRowsOf = (kind: MealKind) =>
    input.rows.filter((r) => (r.dates[kind]?.length ?? 0) > 0);

  const countedRows = kinds.flatMap(appliedRowsOf);
  const hasUnknownGender = countedRows.some(
    (r) => genderKeyOf(r.gender) === "UNKNOWN",
  );
  const hasUnknownGrade = countedRows.some(
    (r) => !KNOWN_GRADES.includes(r.grade ?? 0),
  );

  const genderCols: Array<{ key: GenderKey; label: string }> = [
    { key: "MALE", label: "남" },
    { key: "FEMALE", label: "여" },
    ...(hasUnknownGender ? [{ key: "UNKNOWN" as const, label: "미지정" }] : []),
  ];

  type StatsRow = StatsExcelInput["rows"][number];
  const gradeGroups: Array<{ label: string; match: (r: StatsRow) => boolean }> = [
    ...KNOWN_GRADES.map((g) => ({
      label: `${g}학년`,
      match: (r: StatsRow) => r.grade === g,
    })),
    ...(hasUnknownGrade
      ? [{
          label: "학년미상",
          match: (r: StatsRow) => !KNOWN_GRADES.includes(r.grade ?? 0),
        }]
      : []),
    { label: "합계", match: () => true },
  ];

  let rowNum = 1;
  for (const kind of kinds) {
    const labelCell = ws.getCell(rowNum, 1);
    labelCell.value = MEAL_LABEL[kind];
    labelCell.font = { bold: true };
    rowNum++;

    const headerLabels = ["구분", ...genderCols.map((g) => g.label), "계"];
    headerLabels.forEach((label, i) => {
      const cell = ws.getCell(rowNum, i + 1);
      cell.value = label;
      styleHeader(cell);
    });
    rowNum++;

    const kindRows = appliedRowsOf(kind);
    for (const group of gradeGroups) {
      const groupRows = kindRows.filter(group.match);
      const groupLabelCell = ws.getCell(rowNum, 1);
      groupLabelCell.value = group.label;
      styleHeader(groupLabelCell);

      genderCols.forEach((g, i) => {
        const cell = ws.getCell(rowNum, 2 + i);
        cell.value = groupRows.filter(
          (r) => genderKeyOf(r.gender) === g.key,
        ).length;
        cell.alignment = { horizontal: "center" };
        cell.border = THIN_BORDER;
      });

      const totalCell = ws.getCell(rowNum, 2 + genderCols.length);
      totalCell.value = groupRows.length;
      totalCell.alignment = { horizontal: "center" };
      totalCell.border = THIN_BORDER;
      totalCell.font = { bold: true };
      rowNum++;
    }
    rowNum++; // 표 사이 빈 행
  }

  ws.getColumn(1).width = 10;
  for (let c = 2; c <= 2 + genderCols.length; c++) {
    ws.getColumn(c).width = 8;
  }
}
```

(c) `buildStatsWorkbook`에서 호출 — `buildSheet3(workbook, input);` 다음 줄에:

```ts
  buildSheet1(workbook, input, allDates, priceMap);
  buildSheet2(workbook, input);
  buildSheet3(workbook, input);
  buildSheet4(workbook, input);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/meal-stats-excel.test.ts`
Expected: 전체 PASS (기존 + 신규 7건)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/meal-stats-excel.ts src/lib/__tests__/meal-stats-excel.test.ts
git commit -m "feat(export): 신청 통계 엑셀에 학년별-성별 시트 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: export 라우트에 gender 연결 + 전체 검증

**Files:**
- Modify: `src/app/api/admin/applications/[id]/export/route.ts` (user select ~line 210-218, rows 매핑 ~line 263-274)

**Interfaces:**
- Consumes: Task 1의 `buildSheet4` (이미 `buildStatsWorkbook` 내부에서 호출됨 — 라우트는 함수 호출 변경 없음)
- Produces: `rows[].gender`에 Prisma `User.gender`("MALE"/"FEMALE"/null) 전달. 이것이 없으면 시트4의 모든 인원이 "미지정"으로 집계된다.

- [ ] **Step 1: user select에 gender 추가**

`registrations` 조회의 `user.select`에 `gender: true` 추가:

```ts
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            grade: true,
            classNum: true,
            number: true,
            gender: true,
          },
        },
```

rows 매핑 return 객체에 `gender` 추가 (`number: u.number ?? undefined,` 다음 줄):

```ts
      return {
        seq: idx + 1,
        createdAt,
        loginId,
        studentNo,
        name: u.name,
        grade: u.grade ?? undefined,
        classNum: u.classNum ?? undefined,
        number: u.number ?? undefined,
        gender: u.gender,
        exempt,
        dates,
      };
```

- [ ] **Step 2: 전체 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 3: 프로덕션 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/applications/[id]/export/route.ts
git commit -m "feat(export): 신청자 gender를 통계 워크북에 전달

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
