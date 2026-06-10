import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { studentNumberOf } from "@/lib/meal-plan";
import { buildStatsWorkbook, type MealKind } from "@/lib/meal-stats-excel";
import { toDateKey } from "@/lib/meal-plan-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const appId = parseInt(id);
    if (isNaN(appId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const isTemplate = searchParams.get("template") === "true";

    const application = await prisma.mealApplication.findUnique({
      where: { id: appId },
    });

    if (!application) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ExcelJS = (await import("exceljs")).default;

    // ── Template mode: 일괄신청 양식 (조식/중식/석식 3열) ──
    if (isTemplate) {
      const MEAL_KINDS_ORDER: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];
      const MEAL_LABEL_KO: Record<MealKind, string> = {
        BREAKFAST: "조식",
        LUNCH: "중식",
        DINNER: "석식",
      };

      // 공고 식사 설정 + 학생 목록 + 기존 APPROVED 신청 병렬 조회
      const [appMealsConfig, allStudents, approvedRegs] = await Promise.all([
        prisma.mealApplicationMeal.findMany({ where: { applicationId: appId } }),
        prisma.user.findMany({
          where: { role: "STUDENT" },
          select: { id: true, name: true, grade: true, classNum: true, number: true },
          orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }],
        }),
        prisma.mealRegistration.findMany({
          where: { applicationId: appId, status: "APPROVED" },
          include: { meals: { select: { mealKind: true, applied: true } } },
        }),
      ]);

      // userId → 신청된 mealKind Set
      const approvedMealsByUser = new Map<number, Set<MealKind>>();
      for (const reg of approvedRegs) {
        const kinds = new Set<MealKind>();
        for (const m of reg.meals) {
          if (m.applied) kinds.add(m.mealKind as MealKind);
        }
        approvedMealsByUser.set(reg.userId, kinds);
      }

      // 열 헤더: NONE이거나 미설정인 식사는 "(신청불가)" 표기
      const mealMethodMap = new Map<MealKind, string>();
      for (const m of appMealsConfig) {
        mealMethodMap.set(m.mealKind as MealKind, m.method);
      }
      const mealHeaders = MEAL_KINDS_ORDER.map((kind) => {
        const method = mealMethodMap.get(kind);
        return method && method !== "NONE"
          ? MEAL_LABEL_KO[kind]
          : `${MEAL_LABEL_KO[kind]}(신청불가)`;
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("일괄신청양식");

      // 1행: 헤더
      const headerRow = sheet.getRow(1);
      ["학년", "반", "번호", "이름", ...mealHeaders].forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
      });

      // 2행: 안내문 (A2:G2 병합)
      sheet.mergeCells(2, 1, 2, 7);
      const guideCell = sheet.getCell(2, 1);
      guideCell.value = "신청할 식사에 O 표시 (해당 학년 개설일 전체 신청 처리)";
      guideCell.alignment = { horizontal: "center" };
      guideCell.font = { italic: true, color: { argb: "FF888888" } };

      // 열 너비
      [6, 6, 6, 14, 8, 8, 8].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

      // 3행~: 학생 목록
      let rowIdx = 3;
      for (const s of allStudents) {
        const r = sheet.getRow(rowIdx++);
        r.getCell(1).value = s.grade;
        r.getCell(2).value = s.classNum;
        r.getCell(3).value = s.number;
        r.getCell(4).value = s.name;
        const approvedKinds = approvedMealsByUser.get(s.id);
        MEAL_KINDS_ORDER.forEach((kind, ki) => {
          const cell = r.getCell(5 + ki);
          cell.value = approvedKinds?.has(kind) ? "O" : "";
          cell.alignment = { horizontal: "center" };
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_일괄신청양식.xlsx"`,
        },
      });
    }

    // ── 신청명단 모드: 리로 양식 3시트 ──

    // Fetch meals config
    const appMeals = await prisma.mealApplicationMeal.findMany({
      where: { applicationId: appId, method: { not: "NONE" } },
    });

    // All open dates across all grades (distinct union)
    const allOpenDateRows = await prisma.mealApplicationMealDate.findMany({
      where: { applicationId: appId },
      select: { mealKind: true, date: true },
    });

    const openDatesMap: Partial<Record<MealKind, Set<string>>> = {};
    for (const row of allOpenDateRows) {
      const kind = row.mealKind as MealKind;
      const dateKey = toDateKey(row.date);
      if (!openDatesMap[kind]) openDatesMap[kind] = new Set();
      openDatesMap[kind]!.add(dateKey);
    }
    const openDates: Partial<Record<MealKind, string[]>> = {};
    for (const kind of Object.keys(openDatesMap) as MealKind[]) {
      openDates[kind] = [...openDatesMap[kind]!].sort();
    }

    // APPROVED registrations with meal and date details, sorted grade→class→number
    const registrations = await prisma.mealRegistration.findMany({
      where: { applicationId: appId, status: "APPROVED" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            grade: true,
            classNum: true,
            number: true,
          },
        },
        meals: {
          select: { mealKind: true, exempt: true },
        },
        mealDates: {
          select: { mealKind: true, date: true },
        },
      },
      orderBy: [
        { user: { grade: "asc" } },
        { user: { classNum: "asc" } },
        { user: { number: "asc" } },
      ],
    });

    // Build rows for buildStatsWorkbook
    const rows = registrations.map((reg, idx) => {
      const u = reg.user;
      const loginId = u.email.split("@")[0] ?? u.email;
      const grade = u.grade ?? 0;
      const classNum = u.classNum ?? 0;
      const number = u.number ?? 0;
      const studentNo =
        grade && classNum && number ? studentNumberOf(grade, classNum, number) : 0;

      const exempt: Partial<Record<MealKind, boolean>> = {};
      for (const m of reg.meals) {
        exempt[m.mealKind as MealKind] = m.exempt;
      }

      const dates: Partial<Record<MealKind, string[]>> = {};
      for (const md of reg.mealDates) {
        const kind = md.mealKind as MealKind;
        const dateKey = toDateKey(md.date);
        if (!dates[kind]) dates[kind] = [];
        dates[kind]!.push(dateKey);
      }
      for (const kind of Object.keys(dates) as MealKind[]) {
        dates[kind] = dates[kind]!.sort();
      }

      const createdAt = reg.createdAt.toLocaleString("sv-SE", {
        timeZone: "Asia/Seoul",
      }).replace("T", " ");

      return {
        seq: idx + 1,
        createdAt,
        loginId,
        studentNo,
        name: u.name,
        grade: u.grade ?? undefined,
        classNum: u.classNum ?? undefined,
        number: u.number ?? undefined,
        exempt,
        dates,
      };
    });

    // months array from application
    const startYear = application.startYear ?? new Date().getFullYear();
    const startMonth = application.startMonth ?? new Date().getMonth() + 1;
    const monthCount = application.monthCount ?? 1;
    const months = Array.from({ length: monthCount }, (_, i) => {
      const m = startMonth - 1 + i;
      return { year: startYear + Math.floor(m / 12), month: (m % 12) + 1 };
    });

    const meals = appMeals.map((m) => ({
      mealKind: m.mealKind as MealKind,
      price: m.price,
    }));

    const workbook = await buildStatsWorkbook({
      title: application.title,
      months,
      meals,
      openDates,
      rows,
    });

    const buffer = await workbook.xlsx.writeBuffer();

    const mm = String(startMonth).padStart(2, "0");
    const filename = `${startYear}년_${mm}월_${application.title}_내역서(${rows.length}).xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
