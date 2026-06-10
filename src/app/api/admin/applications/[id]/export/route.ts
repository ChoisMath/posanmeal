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

    // ── Template mode (Task 14: 건드리지 말 것) ──
    if (isTemplate) {
      const registrations = await prisma.mealRegistration.findMany({
        where: { applicationId: appId, status: "APPROVED" },
        include: {
          user: { select: { id: true, name: true, grade: true, classNum: true, number: true, gender: true } },
        },
      });
      registrations.sort((a, b) =>
        (a.user.grade ?? 0) - (b.user.grade ?? 0) ||
        (a.user.classNum ?? 0) - (b.user.classNum ?? 0) ||
        (a.user.number ?? 0) - (b.user.number ?? 0)
      );

      const allStudents = await prisma.user.findMany({
        where: { role: "STUDENT" },
        select: { id: true, name: true, grade: true, classNum: true, number: true },
        orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }],
      });

      const registeredIds = new Set(registrations.map((r) => r.user.id));
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("신청양식");
      sheet.mergeCells(1, 1, 1, 5);
      const titleCell = sheet.getCell(1, 1);
      titleCell.value = `${application.title} — 일괄 신청 양식`;
      titleCell.font = { bold: true, size: 14 };
      titleCell.alignment = { horizontal: "center" };

      const headerRow = sheet.getRow(3);
      ["학년", "반", "번호", "이름", "신청"].forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
      });
      [6, 6, 6, 12, 8].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

      let row = 4;
      for (const s of allStudents) {
        const r = sheet.getRow(row++);
        r.getCell(1).value = s.grade;
        r.getCell(2).value = s.classNum;
        r.getCell(3).value = s.number;
        r.getCell(4).value = s.name;
        r.getCell(5).value = registeredIds.has(s.id) ? "O" : "";
        r.getCell(5).alignment = { horizontal: "center" };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_form.xlsx"`,
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
