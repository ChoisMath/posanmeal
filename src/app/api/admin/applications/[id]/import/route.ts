import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRegistrationSelections, writeRegistration, toDateKey } from "@/lib/meal-plan-server";
import {
  EMAIL_HEADER,
  parseColumnHeader,
  TEMPLATE_FIXED_HEADERS,
  type TemplateColumn,
} from "@/lib/meal-template-columns";
import { monthsOf, expandWeekdays, type MealKind, type MealApplyMethod } from "@/lib/meal-plan";
import { parseIdParam, routeResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import { withEligibilityMutation } from "@/lib/academic-year/eligibility-mutation";
import {
  getRegistrationContext,
  resolveApplicationYear,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import { requireActor } from "@/lib/academic-year/request-actor";
import { readYearState } from "@/lib/academic-year/roster-service";

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

type MealInput = {
  mealKind: MealKind;
  applied: true;
  exempt: false;
  selectedDates?: string[];
  weekdaysByMonth?: Record<string, number[]>;
};

type SheetRow = { rowNumber: number; key: string; marks: MealInput[] };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const applicationId = parseIdParam((await params).id);

    const application = await prisma.mealApplication.findUnique({ where: { id: applicationId } });
    if (!application) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }

    const mode = await rosterMode(prisma);
    const year = await resolveApplicationYear(prisma, mode, application.academicYear);
    if ((await readYearState(prisma, year)) === "DRAFT") {
      throw new DomainError("YEAR_MISMATCH", "초안 학년도 공고에는 일괄 등록할 수 없습니다.");
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    }

    const maxSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB ?? "5", 10);
    if (file.size > maxSizeMb * 1024 * 1024) {
      return NextResponse.json(
        { error: `파일이 너무 큽니다. 최대 ${maxSizeMb}MB까지 업로드할 수 있습니다.` },
        { status: 400 },
      );
    }

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.default.Workbook();
    try {
      await workbook.xlsx.load(await file.arrayBuffer());
    } catch {
      return NextResponse.json({ error: "엑셀 파일을 읽을 수 없습니다." }, { status: 400 });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ error: "시트를 찾을 수 없습니다." }, { status: 400 });
    }

    const [appMealsConfig, openDateRows] = await Promise.all([
      prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
      prisma.mealApplicationMealDate.findMany({
        where: { applicationId },
        select: { mealKind: true, grade: true, date: true },
      }),
    ]);

    const methodByKind = new Map<MealKind, MealApplyMethod>();
    for (const m of appMealsConfig) {
      methodByKind.set(m.mealKind as MealKind, m.method as MealApplyMethod);
    }

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

    const months = monthsOf(
      application.startYear ?? new Date().getFullYear(),
      application.startMonth ?? new Date().getMonth() + 1,
      application.monthCount ?? 1,
    );
    const monthKeys = months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);

    const headerRow = sheet.getRow(1);
    const byEmail = cellText(headerRow.getCell(1).value).trim() === EMAIL_HEADER;
    const firstMealCol = byEmail ? TEMPLATE_FIXED_HEADERS.length + 1 : 5;

    const columnMap = new Map<number, TemplateColumn>();
    for (let c = firstMealCol; c <= sheet.columnCount; c++) {
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

    const rows: SheetRow[] = [];
    let ignoredMarks = 0;
    let skippedInvalid = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;

      const ynMarked = new Set<MealKind>();
      const dateMarks = new Map<MealKind, Set<string>>();
      const weekdayMarks = new Map<MealKind, Set<number>>();
      let anyMark = false;

      for (const [colIdx, col] of columnMap) {
        if (!isOMarked(row.getCell(colIdx).value)) continue;
        anyMark = true;
        if (col.type === "YN") {
          ynMarked.add(col.kind);
        } else if (col.type === "DATE") {
          let set = dateMarks.get(col.kind);
          if (!set) {
            set = new Set();
            dateMarks.set(col.kind, set);
          }
          set.add(col.date);
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

      const key = byEmail
        ? cellText(row.getCell(1).value).trim().toLowerCase()
        : [1, 2, 3].map((c) => cellText(row.getCell(c).value).trim()).join("-");

      rows.push({
        rowNumber,
        key,
        marks: [...ynMarked, ...dateMarks.keys(), ...weekdayMarks.keys()].flatMap<MealInput>(
          (kind) => {
            const method = methodByKind.get(kind);
            if (!method || method === "NONE") return [];
            if (method === "YN") return [{ mealKind: kind, applied: true, exempt: false }];

            if (method === "DATE") {
              // 학년별 개설일 확인은 학년이 정해진 뒤에 한다. 여기서는 표시만 모은다.
              const marks = [...(dateMarks.get(kind) ?? new Set<string>())].sort();
              return [{ mealKind: kind, applied: true, exempt: false, selectedDates: marks }];
            }

            const wds = [...(weekdayMarks.get(kind) ?? [])].sort((a, b) => a - b);
            if (wds.length === 0) return [];
            const weekdaysByMonth: Record<string, number[]> = {};
            for (const mk of monthKeys) weekdaysByMonth[mk] = wds;
            return [{ mealKind: kind, applied: true, exempt: false, weekdaysByMonth }];
          },
        ),
      });
    });

    const resolvedUsers = byEmail
      ? await matchByEmail(rows.map((r) => r.key))
      : await matchByStudentNumber(rows.map((r) => r.key), year, mode === "READY");

    let added = 0;
    let updated = 0;
    let skippedNotFound = 0;

    const targets: { userId: number; marks: MealInput[] }[] = [];
    for (const row of rows) {
      const userId = resolvedUsers.get(row.key);
      if (userId === undefined) {
        skippedNotFound++;
        continue;
      }
      if (row.marks.length === 0) {
        skippedInvalid++;
        continue;
      }
      targets.push({ userId, marks: row.marks });
    }

    // 한 명이라도 자격 검사에 걸리면 이 트랜잭션 전체가 되돌아간다.
    await withEligibilityMutation(
      prisma,
      actor,
      { scope: "REGISTRATION", applicationId },
      async (tx) => {
        for (const target of targets) {
          const existing = await tx.mealRegistration.findUnique({
            where: { applicationId_userId: { applicationId, userId: target.userId } },
            select: { status: true },
          });
          const intent = existing?.status === "APPROVED" ? "EDIT" : existing ? "RESTORE" : "CREATE";
          const context = await getRegistrationContext(
            tx,
            actor,
            applicationId,
            target.userId,
            intent,
          );

          const grade = context.profile.grade ?? 0;
          const meals = target.marks.flatMap<MealInput>((meal) => {
            const openDates = openByGradeKind.get(`${grade}:${meal.mealKind}`) ?? new Set<string>();
            if (meal.selectedDates) {
              const valid = meal.selectedDates.filter((d) => openDates.has(d));
              ignoredMarks += meal.selectedDates.length - valid.length;
              if (valid.length === 0) return [];
              return [{ ...meal, selectedDates: valid }];
            }
            if (meal.weekdaysByMonth) {
              const wds = monthKeys.flatMap((mk) => meal.weekdaysByMonth?.[mk] ?? []);
              const expanded = expandWeekdays([...openDates].sort(), [...new Set(wds)]);
              if (expanded.length === 0) {
                ignoredMarks += new Set(wds).size;
                return [];
              }
            }
            return [meal];
          });

          if (meals.length === 0) {
            skippedInvalid++;
            continue;
          }

          const resolved = await resolveRegistrationSelections(
            applicationId,
            grade,
            meals,
            context.resolveContext,
          );
          if (!resolved.ok) {
            throw new DomainError("INVALID_INPUT", resolved.error);
          }

          const result = await writeRegistration(
            tx,
            applicationId,
            target.userId,
            "(관리자 일괄등록)",
            resolved.resolved,
            "ADMIN",
          );
          if (result.created) added++;
          else updated++;
        }
        return { added, updated };
      },
    );

    return NextResponse.json({
      added,
      updated,
      skippedNotFound,
      skippedInvalid,
      ignoredMarks,
      total: targets.length + skippedNotFound,
    });
  });
}

async function matchByEmail(keys: string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(keys)].filter((key) => key.length > 0);
  if (wanted.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { emailKey: { in: wanted } },
    select: { id: true, emailKey: true },
  });
  return new Map(users.flatMap((u) => (u.emailKey ? [[u.emailKey, u.id] as const] : [])));
}

/**
 * 이메일 열이 없는 옛 양식. 학번은 그 학년도 안에서만 유일하므로 후보를 모두
 * 모으고, 정확히 한 명일 때만 받아들인다. Map에 마지막 값을 덮어쓰면 동명의
 * 다른 학생에게 신청이 붙는다.
 */
async function matchByStudentNumber(
  keys: string[],
  year: number,
  ready: boolean,
): Promise<Map<string, number>> {
  const candidates = new Map<string, number[]>();

  if (ready) {
    const records = await prisma.userAcademicRecord.findMany({
      where: { year, role: "STUDENT", memberState: "ENROLLED" },
      select: { userId: true, grade: true, classNum: true, number: true },
    });
    for (const r of records) {
      if (r.grade == null || r.classNum == null || r.number == null) continue;
      const key = `${r.grade}-${r.classNum}-${r.number}`;
      candidates.set(key, [...(candidates.get(key) ?? []), r.userId]);
    }
  } else {
    const users = await prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, grade: true, classNum: true, number: true },
    });
    for (const u of users) {
      if (u.grade == null || u.classNum == null || u.number == null) continue;
      const key = `${u.grade}-${u.classNum}-${u.number}`;
      candidates.set(key, [...(candidates.get(key) ?? []), u.id]);
    }
  }

  const resolved = new Map<string, number>();
  for (const key of new Set(keys)) {
    const found = candidates.get(key);
    if (!found) continue;
    if (found.length > 1) {
      throw new DomainError(
        "IDENTITY_CONFLICT",
        `학번 ${key}에 해당하는 학생이 여러 명입니다. 이메일이 있는 새 양식을 사용하세요.`,
      );
    }
    resolved.set(key, found[0]);
  }
  return resolved;
}
