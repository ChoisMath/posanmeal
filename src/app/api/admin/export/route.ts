import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDateTimeKST } from "@/lib/timezone";
import { sourceLabel } from "@/lib/checkin-source";
import { buildMonthDateRange, dateKeyToUtcDate, formatMonthDateKey } from "@/lib/date-range";
import { MEAL_LABEL } from "@/lib/meal-plan";
import { academicYearOfDate } from "@/lib/academic-year/calendar";
import { errorResponse } from "@/lib/academic-year/api";
import { DomainError } from "@/lib/academic-year/errors";
import {
  currentClassLabelOf,
  displayNameOf,
  getReportProfiles,
  listPeriodBuckets,
  reportBucketOf,
  MISSING_PROFILE_WARNING,
  UNKNOWN_CATEGORY_LABEL,
  type ReportCategory,
  type ReportProfile,
} from "@/lib/academic-year/report-profile";
import { requireActor } from "@/lib/academic-year/request-actor";

type ExportCheckIn = { date: Date; type?: string; mealKind?: string | null };

type ExportUser = {
  name: string;
  subject: string | null;
  classNum: number | null;
  number: number | null;
  currentClass: string | null;
  checkIns: ExportCheckIn[];
};

export async function GET(request: Request) {
  try {
    await requireActor("READ_ADMIN");

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const includeCurrent = searchParams.get("includeCurrent") === "1";

    if (dateParam) {
      return await exportDaily(dateParam, includeCurrent);
    }

    return await exportMonthly(searchParams, includeCurrent);
  } catch (err) {
    return errorResponse(err);
  }
}

async function exportMonthly(
  searchParams: URLSearchParams,
  includeCurrent: boolean,
): Promise<NextResponse> {
  const now = new Date();
  const year = Number.parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
  const month = Number.parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("INVALID_INPUT", "조회 기간을 확인하세요.");
  }

  const { startDate, endDate, daysInMonth } = buildMonthDateRange(year, month);
  const academicYear = academicYearOfDate(formatMonthDateKey(year, month, 1));

  // 다섯 묶음을 한 번에 가른다. 시트마다 다시 세면 서로 어긋날 수 있다.
  const { profiles, byCategory } = await listPeriodBuckets(
    prisma,
    academicYear,
    { startDate, endDate },
    includeCurrent,
  );
  const allIds = [...byCategory.values()].flat();
  const checkIns = await prisma.checkIn.findMany({
    where: { userId: { in: allIds }, date: { gte: startDate, lte: endDate } },
    select: { userId: true, date: true, type: true, mealKind: true },
    orderBy: [{ date: "asc" }, { mealKind: "asc" }],
  });

  const byUser = new Map<number, ExportCheckIn[]>();
  for (const { userId, ...rest } of checkIns) {
    const list = byUser.get(userId);
    if (list) list.push(rest);
    else byUser.set(userId, [rest]);
  }

  function usersOf(category: ReportCategory): ExportUser[] {
    return (byCategory.get(category) ?? []).map((id) => {
      const report: ReportProfile | undefined = profiles.get(id);
      const profile = report?.historical;
      return {
        name: displayNameOf(report) || MISSING_PROFILE_WARNING,
        subject: profile?.subject ?? null,
        classNum: profile?.classNum ?? null,
        number: profile?.number ?? null,
        currentClass: includeCurrent ? currentClassLabelOf(report) : null,
        checkIns: byUser.get(id) ?? [],
      };
    });
  }

  const [teachers, grade1, grade2, grade3, unknown] = (
    ["teacher", "1", "2", "3", "unknown"] as const
  ).map(usersOf);

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  workbook.title = `${academicYear}학년도 ${year}년 ${month}월 급식 현황`;

  const categories = [
    { sheetName: "교사", title: `포산고등학교 ${month}월 교사`, label: "이름", users: teachers, isTeacher: true, nameOnly: true },
    { sheetName: "1학년", title: `포산고등학교 ${month}월 1학년`, label: "반-번호 이름", users: grade1, isTeacher: false, nameOnly: false },
    { sheetName: "2학년", title: `포산고등학교 ${month}월 2학년`, label: "반-번호 이름", users: grade2, isTeacher: false, nameOnly: false },
    { sheetName: "3학년", title: `포산고등학교 ${month}월 3학년`, label: "반-번호 이름", users: grade3, isTeacher: false, nameOnly: false },
    // 그 해 명부 기록이 없는 사람. 학년을 추측하지 않고 마지막에 따로 모아 고칠 수 있게 한다.
    ...(unknown.length === 0
      ? []
      : [{
          sheetName: UNKNOWN_CATEGORY_LABEL,
          title: `포산고등학교 ${month}월 ${UNKNOWN_CATEGORY_LABEL} (${academicYear}학년도 명부 기록 없음)`,
          label: "이름",
          users: unknown,
          isTeacher: false,
          nameOnly: true,
        }]),
  ];

  for (let si = 0; si < categories.length; si++) {
    const { sheetName, title, label, users, isTeacher, nameOnly } = categories[si];
    const sheet = workbook.addWorksheet(sheetName);

    // 열 구성: A(이름) + daysInMonth + 개인/근무(교사만) + 합계
    const summaryCols = isTeacher ? 3 : 1; // 개인,근무,합계 | 합계
    const lastCol = daysInMonth + 1 + summaryCols;
    const personalCol = isTeacher ? daysInMonth + 2 : 0;
    const workCol = isTeacher ? daysInMonth + 3 : 0;
    const totalCol = lastCol;

    // 행1: 제목 (병합)
    sheet.mergeCells(1, 1, 1, lastCol);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center" };

    // 행3: 헤더
    const headerRow = sheet.getRow(3);
    headerRow.getCell(1).value = label;
    for (let d = 1; d <= daysInMonth; d++) {
      headerRow.getCell(d + 1).value = d;
    }
    if (isTeacher) {
      headerRow.getCell(personalCol).value = "개인";
      headerRow.getCell(workCol).value = "근무";
    }
    headerRow.getCell(totalCol).value = "합계";
    const currentCol = includeCurrent ? lastCol + 1 : 0;
    if (includeCurrent) {
      headerRow.getCell(currentCol).value = "현재 학급";
      sheet.getColumn(currentCol).width = 12;
    }
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: "center" };
    headerRow.getCell(1).alignment = { horizontal: "left" };

    // 열 너비
    sheet.getColumn(1).width = isTeacher ? 12 : 16;
    for (let d = 1; d <= daysInMonth; d++) {
      sheet.getColumn(d + 1).width = 4;
    }
    if (isTeacher) {
      sheet.getColumn(personalCol).width = 6;
      sheet.getColumn(workCol).width = 6;
    }
    sheet.getColumn(totalCol).width = 6;

    // 일자별 합계 누적용
    const dailyPersonal = new Array(daysInMonth + 1).fill(0);
    const dailyWork = new Array(daysInMonth + 1).fill(0);
    const dailyTotal = new Array(daysInMonth + 1).fill(0);

    type DaySlot = {
      dinner?: ExportCheckIn;
      breakfast?: ExportCheckIn;
      lunch?: ExportCheckIn;
    };
    for (const user of users) {
      const row = sheet.addRow([]);
      const slotMap = new Map<number, DaySlot>();
      for (const c of user.checkIns) {
        const day = new Date(c.date).getDate();
        const slot = slotMap.get(day) ?? {};
        if (c.mealKind === "BREAKFAST") slot.breakfast = c;
        else if (c.mealKind === "LUNCH") slot.lunch = c;
        else slot.dinner = c;
        slotMap.set(day, slot);
      }

      row.getCell(1).value = nameOnly
        ? user.name
        : `${user.classNum ?? ""}-${user.number ?? ""} ${user.name}`;
      if (includeCurrent) {
        row.getCell(currentCol).value = user.currentClass ?? "";
        row.getCell(currentCol).alignment = { horizontal: "center" };
      }

      let count = 0;
      let personalCount = 0;
      let workCount = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const slot = slotMap.get(d);
        if (!slot) continue;
        count++;
        dailyTotal[d]++;
        let cellValue = "";
        if (isTeacher && slot.dinner) {
          if (slot.dinner.type === "WORK") {
            workCount++;
            dailyWork[d]++;
            cellValue = "근";
          } else {
            personalCount++;
            dailyPersonal[d]++;
            cellValue = "개";
          }
        } else if (!isTeacher && slot.dinner) {
          dailyPersonal[d]++;
          cellValue = "O";
        }
        if (slot.breakfast) {
          cellValue = cellValue ? `${cellValue}+조` : "조";
        }
        if (slot.lunch) {
          cellValue = cellValue ? `${cellValue}+중` : "중";
        }
        row.getCell(d + 1).value = cellValue;
      }

      // 합계
      if (isTeacher) {
        row.getCell(personalCol).value = personalCount;
        row.getCell(workCol).value = workCount;
      }
      row.getCell(totalCol).value = count;

      // 가운데 정렬
      for (let c = 2; c <= lastCol; c++) {
        row.getCell(c).alignment = { horizontal: "center" };
      }
    }

    // 하단: 일자별 합계 행
    if (isTeacher) {
      const personalRow = sheet.addRow([]);
      personalRow.getCell(1).value = "개인";
      for (let d = 1; d <= daysInMonth; d++) {
        personalRow.getCell(d + 1).value = dailyPersonal[d] || "";
      }
      personalRow.getCell(personalCol).value = dailyPersonal.reduce((s, v) => s + v, 0);
      personalRow.getCell(workCol).value = 0;
      personalRow.getCell(totalCol).value = dailyPersonal.reduce((s, v) => s + v, 0);
      personalRow.font = { bold: true };

      const workRow = sheet.addRow([]);
      workRow.getCell(1).value = "근무";
      for (let d = 1; d <= daysInMonth; d++) {
        workRow.getCell(d + 1).value = dailyWork[d] || "";
      }
      workRow.getCell(personalCol).value = 0;
      workRow.getCell(workCol).value = dailyWork.reduce((s, v) => s + v, 0);
      workRow.getCell(totalCol).value = dailyWork.reduce((s, v) => s + v, 0);
      workRow.font = { bold: true };

      const totalRow = sheet.addRow([]);
      totalRow.getCell(1).value = "합계";
      for (let d = 1; d <= daysInMonth; d++) {
        totalRow.getCell(d + 1).value = dailyTotal[d] || "";
      }
      totalRow.getCell(personalCol).value = dailyPersonal.reduce((s, v) => s + v, 0);
      totalRow.getCell(workCol).value = dailyWork.reduce((s, v) => s + v, 0);
      totalRow.getCell(totalCol).value = dailyTotal.reduce((s, v) => s + v, 0);
      totalRow.font = { bold: true };

      for (const r of [personalRow, workRow, totalRow]) {
        for (let c = 2; c <= lastCol; c++) {
          r.getCell(c).alignment = { horizontal: "center" };
        }
      }
    } else {
      const totalRow = sheet.addRow([]);
      totalRow.getCell(1).value = "합계";
      for (let d = 1; d <= daysInMonth; d++) {
        totalRow.getCell(d + 1).value = dailyTotal[d] || "";
      }
      totalRow.getCell(totalCol).value = dailyTotal.reduce((s, v) => s + v, 0);
      totalRow.font = { bold: true };
      for (let c = 2; c <= lastCol; c++) {
        totalRow.getCell(c).alignment = { horizontal: "center" };
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(`석식현황_${year}_${month}`)}.xlsx"`,
    },
  });
}

async function exportDaily(dateParam: string, includeCurrent: boolean): Promise<NextResponse> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    throw new DomainError("INVALID_INPUT", "잘못된 날짜 형식입니다.");
  }
  let targetDate: Date;
  try {
    targetDate = dateKeyToUtcDate(dateParam);
  } catch {
    throw new DomainError("INVALID_INPUT", "잘못된 날짜입니다.");
  }
  const academicYear = academicYearOfDate(dateParam);

  const checkIns = await prisma.checkIn.findMany({
    where: { date: targetDate },
    select: {
      userId: true,
      type: true,
      mealKind: true,
      source: true,
      checkedAt: true,
    },
  });

  const profiles = await getReportProfiles(
    prisma,
    checkIns.map((c) => c.userId),
    academicYear,
    includeCurrent,
  );

  type Row = {
    category: "1학년" | "2학년" | "3학년" | "교사 근무" | "교사 개인" | "확인 필요";
    grade: number | null;
    classNum: number | null;
    number: number | null;
    name: string;
    subject: string | null;
    currentClass: string | null;
    mealKind: "BREAKFAST" | "LUNCH" | "DINNER";
    checkedAt: Date;
    source: "QR" | "ADMIN_MANUAL" | "LOCAL_SYNC" | "FACE" | null;
  };

  const categoryOrder: Record<Row["category"], number> = {
    "1학년": 0, "2학년": 1, "3학년": 2, "교사 근무": 3, "교사 개인": 4, "확인 필요": 5,
  };

  const rows: Row[] = checkIns.map((c) => {
    const report = profiles.get(c.userId);
    const profile = report?.historical;
    // 분류는 월별과 같은 규칙 하나로만 한다. 어느 칸에도 못 넣는 사람은 "확인 필요"다.
    const bucket = reportBucketOf(report);
    const category: Row["category"] = bucket === "unknown"
      ? UNKNOWN_CATEGORY_LABEL
      : bucket === "teacher"
        ? (c.type === "WORK" ? "교사 근무" : "교사 개인")
        : (`${bucket}학년` as Row["category"]);
    return {
      category,
      grade: profile?.grade ?? null,
      classNum: profile?.classNum ?? null,
      number: profile?.number ?? null,
      name: displayNameOf(report) || MISSING_PROFILE_WARNING,
      subject: profile?.subject ?? null,
      currentClass: includeCurrent ? currentClassLabelOf(report) : null,
      mealKind: c.mealKind ?? "DINNER",
      checkedAt: c.checkedAt,
      source: c.source,
    };
  });

  rows.sort((a, b) => {
    if (a.category !== b.category) return categoryOrder[a.category] - categoryOrder[b.category];
    if (a.category.endsWith("학년")) {
      const ag = a.grade ?? 0, bg = b.grade ?? 0;
      if (ag !== bg) return ag - bg;
      const ac = a.classNum ?? 0, bc = b.classNum ?? 0;
      if (ac !== bc) return ac - bc;
      return (a.number ?? 0) - (b.number ?? 0);
    }
    return a.name.localeCompare(b.name, "ko");
  });

  const counts: Record<Row["category"], number> = {
    "1학년": 0, "2학년": 0, "3학년": 0, "교사 근무": 0, "교사 개인": 0, "확인 필요": 0,
  };
  for (const r of rows) counts[r.category]++;
  const total = rows.length;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet(dateParam);

  const headers = [
    "구분", "학년", "반", "번호", "이름", "교과", "식사", "체크인 시각", "출처",
    ...(includeCurrent ? ["현재 학급"] : []),
  ];
  const lastCol = headers.length;

  const dow = ["일", "월", "화", "수", "목", "금", "토"][targetDate.getDay()];
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `포산고등학교 석식 현황 — ${dateParam} (${dow})`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  sheet.mergeCells(2, 1, 2, lastCol);
  const summaryCell = sheet.getCell(2, 1);
  summaryCell.value =
    `합계: 1학년 ${counts["1학년"]} · 2학년 ${counts["2학년"]} · 3학년 ${counts["3학년"]}` +
    ` · 교사 근무 ${counts["교사 근무"]} · 교사 개인 ${counts["교사 개인"]}` +
    (counts["확인 필요"] > 0 ? ` · ${UNKNOWN_CATEGORY_LABEL} ${counts["확인 필요"]}` : "") +
    ` · 총 ${total}`;
  summaryCell.alignment = { horizontal: "center" };
  summaryCell.font = { italic: true };

  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };

  const widths = [10, 6, 6, 6, 12, 14, 8, 18, 8, ...(includeCurrent ? [12] : [])];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  for (const r of rows) {
    const isTeacherRow = r.category.startsWith("교사");
    // "확인 필요" 줄도 남아 있는 값(반·번호)은 그대로 보여 준다 — 사람을 찾아 고쳐야 한다.
    const row = sheet.addRow([
      r.category,
      isTeacherRow ? "" : r.grade ?? "",
      isTeacherRow ? "" : r.classNum ?? "",
      isTeacherRow ? "" : r.number ?? "",
      r.name,
      isTeacherRow ? (r.subject ?? "") : "",
      MEAL_LABEL[r.mealKind],
      formatDateTimeKST(r.checkedAt),
      sourceLabel(r.source),
      ...(includeCurrent ? [r.currentClass ?? ""] : []),
    ]);
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).alignment = { horizontal: c === 5 || c === 6 ? "left" : "center" };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(`석식현황_${dateParam}`)}.xlsx"`,
    },
  });
}
