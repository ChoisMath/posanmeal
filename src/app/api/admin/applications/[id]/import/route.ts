import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import {
  resolveRegistrationSelections,
  writeRegistration,
  toDateKey,
} from "@/lib/meal-plan-server";
import { parseColumnHeader, type TemplateColumn } from "@/lib/meal-template-columns";
import {
  monthsOf,
  expandWeekdays,
  type MealKind,
  type MealApplyMethod,
} from "@/lib/meal-plan";

function cellText(raw: unknown): string {
  // 혼합 서식 셀은 exceljs가 richText 객체로 반환한다
  if (raw != null && typeof raw === "object" && "richText" in raw) {
    return (raw as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  return String(raw ?? "");
}

function isOMarked(raw: unknown): boolean {
  const v = cellText(raw).trim();
  return v === "O" || v === "o" || v === "ㅇ";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const applicationId = parseInt(id);

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: "시트를 찾을 수 없습니다." }, { status: 400 });
  }

  // 공고 식사 설정 + 학년별 개설일 + 전체 학생 목록 병렬 조회
  const [appMealsConfig, openDateRows, allStudents] = await Promise.all([
    prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
    prisma.mealApplicationMealDate.findMany({
      where: { applicationId },
      select: { mealKind: true, grade: true, date: true },
    }),
    prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, grade: true, classNum: true, number: true },
    }),
  ]);

  const methodByKind = new Map<MealKind, MealApplyMethod>();
  for (const m of appMealsConfig) {
    methodByKind.set(m.mealKind as MealKind, m.method as MealApplyMethod);
  }

  // "{grade}:{kind}" → 해당 학년 개설일 Set
  const openByGradeKind = new Map<string, Set<string>>();
  for (const row of openDateRows) {
    const key = `${row.grade}:${row.mealKind}`;
    let set = openByGradeKind.get(key);
    if (!set) {
      set = new Set();
      openByGradeKind.set(key, set);
    }
    set.add(toDateKey(row.date));
  }

  const startYear = application.startYear ?? new Date().getFullYear();
  const startMonth = application.startMonth ?? new Date().getMonth() + 1;
  const monthCount = application.monthCount ?? 1;
  const months = monthsOf(startYear, startMonth, monthCount);
  const monthKeys = months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);

  // 1행 헤더 파싱 (5열~): colIdx → TemplateColumn
  const headerRow = sheet.getRow(1);
  const columnMap = new Map<number, TemplateColumn>();
  for (let c = 5; c <= sheet.columnCount; c++) {
    const col = parseColumnHeader(cellText(headerRow.getCell(c).value), months);
    if (!col) continue;
    const method = methodByKind.get(col.kind);
    if (!method || method === "NONE") continue;
    columnMap.set(c, col);
  }

  if (columnMap.size === 0) {
    return NextResponse.json(
      { error: "양식 형식이 올바르지 않습니다. 양식을 다시 다운로드해 사용해주세요." },
      { status: 400 },
    );
  }

  // 학년-반-번호 → 학생
  const studentMap = new Map<string, { id: number; grade: number }>();
  for (const s of allStudents) {
    if (s.grade != null && s.classNum != null && s.number != null) {
      studentMap.set(`${s.grade}-${s.classNum}-${s.number}`, { id: s.id, grade: s.grade });
    }
  }

  type MealInput = {
    mealKind: MealKind;
    applied: true;
    exempt: false;
    selectedDates?: string[];
    weekdaysByMonth?: Record<string, number[]>;
  };
  type RowEntry = { userId: number; grade: number; meals: MealInput[] };

  const toProcess: RowEntry[] = [];
  let skippedNotFound = 0;
  let skippedInvalid = 0;
  let ignoredMarks = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;

    // 식사별 O 표시 수집
    const ynMarked = new Set<MealKind>();
    const dateMarks = new Map<MealKind, string[]>();
    const weekdayMarks = new Map<MealKind, Set<number>>();
    let anyMark = false;

    for (const [colIdx, col] of columnMap) {
      if (!isOMarked(row.getCell(colIdx).value)) continue;
      anyMark = true;
      if (col.type === "YN") {
        ynMarked.add(col.kind);
      } else if (col.type === "DATE") {
        let arr = dateMarks.get(col.kind);
        if (!arr) {
          arr = [];
          dateMarks.set(col.kind, arr);
        }
        arr.push(col.date);
      } else {
        let set = weekdayMarks.get(col.kind);
        if (!set) {
          set = new Set();
          weekdayMarks.set(col.kind, set);
        }
        set.add(col.weekday);
      }
    }

    // O가 하나도 없으면 건너뜀 (기존 신청 유지)
    if (!anyMark) return;

    const grade = row.getCell(1).value;
    const classNum = row.getCell(2).value;
    const number = row.getCell(3).value;
    const found = studentMap.get(`${grade}-${classNum}-${number}`);
    if (!found) {
      skippedNotFound++;
      return;
    }

    const markedKinds = new Set<MealKind>([
      ...ynMarked,
      ...dateMarks.keys(),
      ...weekdayMarks.keys(),
    ]);
    const meals: MealInput[] = [];

    for (const kind of markedKinds) {
      const method = methodByKind.get(kind);
      if (!method || method === "NONE") continue;
      const open = openByGradeKind.get(`${found.grade}:${kind}`) ?? new Set<string>();

      if (method === "YN") {
        meals.push({ mealKind: kind, applied: true, exempt: false });
        continue;
      }

      if (method === "DATE") {
        const marks = dateMarks.get(kind) ?? [];
        const valid = marks.filter((d) => open.has(d));
        ignoredMarks += marks.length - valid.length;
        if (valid.length === 0) continue; // 유효 날짜 없음 → 이 식사만 제외
        meals.push({ mealKind: kind, applied: true, exempt: false, selectedDates: valid.sort() });
        continue;
      }

      // WEEKDAY: 표시된 요일을 모든 대상 월에 동일 적용
      const wds = [...(weekdayMarks.get(kind) ?? [])].sort((a, b) => a - b);
      const expanded = expandWeekdays([...open].sort(), wds);
      if (wds.length === 0 || expanded.length === 0) {
        ignoredMarks += wds.length;
        continue;
      }
      const weekdaysByMonth: Record<string, number[]> = {};
      for (const mk of monthKeys) weekdaysByMonth[mk] = wds;
      meals.push({ mealKind: kind, applied: true, exempt: false, weekdaysByMonth });
    }

    if (meals.length === 0) {
      skippedInvalid++;
      return;
    }
    toProcess.push({ userId: found.id, grade: found.grade, meals });
  });

  let added = 0;
  let updated = 0;

  for (const entry of toProcess) {
    const resolved = await resolveRegistrationSelections(applicationId, entry.grade, entry.meals);
    if (!resolved.ok) {
      skippedInvalid++;
      continue;
    }

    try {
      const result = await prisma.$transaction((tx) =>
        writeRegistration(tx, applicationId, entry.userId, "(관리자 일괄등록)", resolved.resolved, "ADMIN"),
      );
      if (result.created) {
        added++;
      } else {
        updated++;
      }
    } catch {
      skippedInvalid++;
    }
  }

  return NextResponse.json({
    added,
    updated,
    skippedNotFound,
    skippedInvalid,
    ignoredMarks,
    total: toProcess.length + skippedNotFound,
  });
}
