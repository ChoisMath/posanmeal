import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseIdParam } from "@/lib/academic-year/api";
import {
  resolveApplicationYear,
  rosterMode,
} from "@/lib/academic-year/registration-context";
import {
  compareByProfile,
  currentClassLabelOf,
  displayNameOf,
  getReportProfiles,
  listYearMemberIds,
  MISSING_PROFILE_WARNING,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";
import { studentNumberOf } from "@/lib/meal-plan";
import { buildStatsWorkbook, type MealKind } from "@/lib/meal-stats-excel";
import { toDateKey } from "@/lib/meal-plan-server";
import {
  buildTemplateColumns,
  columnHeader,
  TEMPLATE_FIXED_HEADERS,
} from "@/lib/meal-template-columns";
import type { MealApplyMethod } from "@/lib/meal-plan";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireActor("WRITE_ADMIN");
    const appId = parseIdParam((await params).id);

    const { searchParams } = new URL(request.url);
    const isTemplate = searchParams.get("template") === "true";
    const includeCurrent = searchParams.get("includeCurrent") === "1";

    const application = await prisma.mealApplication.findUnique({
      where: { id: appId },
    });

    if (!application) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const mode = await rosterMode(prisma);
    const academicYear = await resolveApplicationYear(prisma, mode, application.academicYear);

    const ExcelJS = (await import("exceljs")).default;

    // ── Template mode: 일괄신청 양식 (YN=단일 / DATE=날짜별 / WEEKDAY=요일별 컬럼) ──
    if (isTemplate) {
      // 양식은 공고 학년도의 재학생 명단이다. 진급한 뒤 뽑아도 그 해 학급이 나온다.
      const studentIds = await listYearMemberIds(prisma, academicYear, {
        role: "STUDENT",
        enrolledOnly: true,
      });

      const [appMealsConfig, openDateRows, studentProfiles, studentEmails, approvedRegs] = await Promise.all([
        prisma.mealApplicationMeal.findMany({ where: { applicationId: appId } }),
        prisma.mealApplicationMealDate.findMany({
          where: { applicationId: appId },
          select: { mealKind: true, date: true },
        }),
        getReportProfiles(prisma, studentIds, academicYear, false),
        prisma.user.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, email: true },
        }),
        prisma.mealRegistration.findMany({
          where: { applicationId: appId, status: "APPROVED" },
          include: {
            meals: { select: { mealKind: true, applied: true, weekdaysByMonth: true } },
            mealDates: { select: { mealKind: true, date: true } },
          },
        }),
      ]);

      // 전 학년 합집합 개설일
      const openSets: Partial<Record<MealKind, Set<string>>> = {};
      for (const row of openDateRows) {
        const kind = row.mealKind as MealKind;
        (openSets[kind] ??= new Set()).add(toDateKey(row.date));
      }
      const openDatesUnion: Partial<Record<MealKind, string[]>> = {};
      for (const kind of Object.keys(openSets) as MealKind[]) {
        openDatesUnion[kind] = [...openSets[kind]!].sort();
      }

      const columns = buildTemplateColumns(
        appMealsConfig.map((m) => ({
          mealKind: m.mealKind as MealKind,
          method: m.method as MealApplyMethod,
        })),
        openDatesUnion,
      );

      // userId → 프리필 정보 (YN: applied, DATE: 확정일, WEEKDAY: 월 합집합 요일)
      type Prefill = {
        appliedKinds: Set<MealKind>;
        dateKeys: Set<string>; // "KIND:YYYY-MM-DD"
        weekdays: Set<string>; // "KIND:0..6"
      };
      const prefillByUser = new Map<number, Prefill>();
      for (const reg of approvedRegs) {
        const p: Prefill = { appliedKinds: new Set(), dateKeys: new Set(), weekdays: new Set() };
        for (const m of reg.meals) {
          if (!m.applied) continue;
          p.appliedKinds.add(m.mealKind as MealKind);
          if (m.weekdaysByMonth) {
            const byMonth = JSON.parse(m.weekdaysByMonth) as Record<string, number[]>;
            for (const wds of Object.values(byMonth)) {
              for (const wd of wds) p.weekdays.add(`${m.mealKind}:${wd}`);
            }
          }
        }
        for (const d of reg.mealDates) {
          p.dateKeys.add(`${d.mealKind}:${toDateKey(d.date)}`);
        }
        prefillByUser.set(reg.userId, p);
      }

      const HEADER_FILL: Record<MealKind, string> = {
        BREAKFAST: "FFFFF2CC",
        LUNCH: "FFE2EFDA",
        DINNER: "FFDDEBF7",
      };

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("일괄신청양식");
      const FIXED_HEADERS = TEMPLATE_FIXED_HEADERS;
      const firstMealCol = FIXED_HEADERS.length + 1;
      const totalCols = FIXED_HEADERS.length + columns.length;

      // 1행: 헤더
      const headerRow = sheet.getRow(1);
      FIXED_HEADERS.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
      });
      columns.forEach((col, i) => {
        const cell = headerRow.getCell(firstMealCol + i);
        cell.value = columnHeader(col);
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER_FILL[col.kind] },
        };
      });

      // 2행: 안내문
      sheet.mergeCells(2, 1, 2, Math.max(totalCols, 7));
      const guideCell = sheet.getCell(2, 1);
      const yearLabel = `${academicYear}학년도 `;
      guideCell.value =
        `${yearLabel}신청할 날짜/요일에 O 표시. 이메일 열은 지우거나 바꾸지 마세요. ` +
        "O를 모두 지워도 기존 신청은 취소되지 않습니다 (취소는 신청 명단에서).";
      guideCell.alignment = { horizontal: "left" };
      guideCell.font = { italic: true, color: { argb: "FF888888" } };

      // 열 너비
      [30, 6, 6, 6, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
      columns.forEach((col, i) => {
        sheet.getColumn(firstMealCol + i).width = col.type === "YN" ? 8 : 12;
      });

      // 3행~: 학생 목록 + 프리필
      const emailById = new Map(studentEmails.map((row) => [row.id, row.email]));
      const orderedStudentIds = studentIds
        .slice()
        .sort((a, b) => {
          const left = studentProfiles.get(a)?.historical;
          const right = studentProfiles.get(b)?.historical;
          const gradeDiff = (left?.grade ?? 0) - (right?.grade ?? 0);
          if (gradeDiff !== 0) return gradeDiff;
          return compareByProfile(studentProfiles.get(a), studentProfiles.get(b), "STUDENT");
        });

      let rowIdx = 3;
      for (const studentId of orderedStudentIds) {
        const profile = studentProfiles.get(studentId)?.historical;
        const r = sheet.getRow(rowIdx++);
        r.getCell(1).value = emailById.get(studentId) ?? "";
        r.getCell(2).value = profile?.grade ?? null;
        r.getCell(3).value = profile?.classNum ?? null;
        r.getCell(4).value = profile?.number ?? null;
        r.getCell(5).value = displayNameOf(studentProfiles.get(studentId)) || MISSING_PROFILE_WARNING;
        const p = prefillByUser.get(studentId);
        columns.forEach((col, i) => {
          const cell = r.getCell(firstMealCol + i);
          let marked = false;
          if (p) {
            if (col.type === "YN") marked = p.appliedKinds.has(col.kind);
            else if (col.type === "DATE") marked = p.dateKeys.has(`${col.kind}:${col.date}`);
            else marked = p.weekdays.has(`${col.kind}:${col.weekday}`);
          }
          cell.value = marked ? "O" : "";
          cell.alignment = { horizontal: "center" };
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(`${application.title}_일괄신청양식.xlsx`)}"`,
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
    const registrationRows = await prisma.mealRegistration.findMany({
      where: { applicationId: appId, status: "APPROVED" },
      include: {
        user: { select: { id: true, email: true } },
        meals: {
          select: { mealKind: true, exempt: true },
        },
        mealDates: {
          select: { mealKind: true, date: true },
        },
      },
    });

    const statsProfiles = await getReportProfiles(
      prisma,
      registrationRows.map((reg) => reg.userId),
      academicYear,
      includeCurrent,
    );

    const registrations = registrationRows.slice().sort((a, b) => {
      const left = statsProfiles.get(a.userId)?.historical;
      const right = statsProfiles.get(b.userId)?.historical;
      const gradeDiff = (left?.grade ?? 0) - (right?.grade ?? 0);
      if (gradeDiff !== 0) return gradeDiff;
      return compareByProfile(statsProfiles.get(a.userId), statsProfiles.get(b.userId), "STUDENT");
    });

    // Build rows for buildStatsWorkbook
    const rows = registrations.map((reg, idx) => {
      const report = statsProfiles.get(reg.userId);
      const profile = report?.historical;
      const loginId = reg.user.email.split("@")[0] ?? reg.user.email;
      const grade = profile?.grade ?? 0;
      const classNum = profile?.classNum ?? 0;
      const number = profile?.number ?? 0;
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
        name: displayNameOf(report) || MISSING_PROFILE_WARNING,
        grade: profile?.grade ?? undefined,
        classNum: profile?.classNum ?? undefined,
        number: profile?.number ?? undefined,
        gender: profile?.gender ?? null,
        ...(includeCurrent ? { currentClass: currentClassLabelOf(report) } : {}),
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
      academicYear,
      includeCurrent,
      months,
      meals,
      openDates,
      rows,
    });

    const buffer = await workbook.xlsx.writeBuffer();

    const mm = String(startMonth).padStart(2, "0");
    // title에는 "{년}년 {월}월 " 접두가 이미 포함돼 제목 부분만 사용
    const subject = application.title.replace(/^\d{4}년 \d{2}월 /, "");
    const filename = `${startYear}년_${mm}월_${subject}_내역서(${rows.length}).xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
