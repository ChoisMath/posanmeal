import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDateTimeKST } from "@/lib/timezone";
import { sourceLabel } from "@/lib/checkin-source";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");

  if (dateParam) {
    return exportDaily(dateParam);
  }

  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const daysInMonth = endDate.getDate();

  // 4개 카테고리 데이터를 병렬 쿼리
  const [teachers, grade1, grade2, grade3] = await Promise.all([
    prisma.user.findMany({
      where: { role: "TEACHER" },
      select: {
        name: true, subject: true,
        checkIns: {
          where: { date: { gte: startDate, lte: endDate } },
          select: { date: true, type: true },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    ...([1, 2, 3] as const).map((grade) =>
      prisma.user.findMany({
        where: { role: "STUDENT", grade },
        select: {
          name: true, number: true, classNum: true,
          checkIns: {
            where: { date: { gte: startDate, lte: endDate } },
            select: { date: true },
            orderBy: { date: "asc" },
          },
        },
        orderBy: [{ classNum: "asc" }, { number: "asc" }],
      })
    ),
  ]);

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();

  const categories = [
    { title: `포산고등학교 ${month}월 교사`, label: "이름", users: teachers, isTeacher: true },
    { title: `포산고등학교 ${month}월 1학년`, label: "반-번호 이름", users: grade1, isTeacher: false },
    { title: `포산고등학교 ${month}월 2학년`, label: "반-번호 이름", users: grade2, isTeacher: false },
    { title: `포산고등학교 ${month}월 3학년`, label: "반-번호 이름", users: grade3, isTeacher: false },
  ];

  const sheetNames = ["교사", "1학년", "2학년", "3학년"];

  for (let si = 0; si < categories.length; si++) {
    const { title, label, users, isTeacher } = categories[si];
    const sheet = workbook.addWorksheet(sheetNames[si]);

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

    // 행4~: 데이터
    for (const user of users) {
      const row = sheet.addRow([]);
      const checkedDaysMap = new Map(
        user.checkIns.map((c: { date: Date; type?: string }) => [new Date(c.date).getDate(), c])
      );

      // A열: 이름
      if (isTeacher) {
        row.getCell(1).value = (user as { name: string }).name;
      } else {
        const s = user as { classNum: number; number: number; name: string };
        row.getCell(1).value = `${s.classNum}-${s.number} ${s.name}`;
      }

      // 날짜열
      let count = 0;
      let personalCount = 0;
      let workCount = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const checkIn = checkedDaysMap.get(d);
        if (checkIn) {
          count++;
          dailyTotal[d]++;
          if (isTeacher) {
            const type = (checkIn as { type?: string }).type;
            if (type === "WORK") {
              workCount++;
              dailyWork[d]++;
              row.getCell(d + 1).value = "근";
            } else {
              personalCount++;
              dailyPersonal[d]++;
              row.getCell(d + 1).value = "개";
            }
          } else {
            dailyPersonal[d]++;
            row.getCell(d + 1).value = "O";
          }
        }
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

async function exportDaily(dateParam: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "잘못된 날짜 형식입니다." }, { status: 400 });
  }
  const targetDate = new Date(dateParam);
  if (Number.isNaN(targetDate.getTime())) {
    return NextResponse.json({ error: "잘못된 날짜입니다." }, { status: 400 });
  }

  const checkIns = await prisma.checkIn.findMany({
    where: { date: targetDate },
    select: {
      type: true,
      source: true,
      checkedAt: true,
      user: {
        select: {
          name: true,
          role: true,
          grade: true,
          classNum: true,
          number: true,
          subject: true,
        },
      },
    },
  });

  type Row = {
    category: "1학년" | "2학년" | "3학년" | "교사 근무" | "교사 개인";
    grade: number | null;
    classNum: number | null;
    number: number | null;
    name: string;
    subject: string | null;
    checkedAt: Date;
    source: "QR" | "ADMIN_MANUAL" | "LOCAL_SYNC" | null;
  };

  const categoryOrder: Record<Row["category"], number> = {
    "1학년": 0, "2학년": 1, "3학년": 2, "교사 근무": 3, "교사 개인": 4,
  };

  const rows: Row[] = checkIns.map((c) => {
    let category: Row["category"];
    if (c.user.role === "STUDENT") {
      category = (c.user.grade === 1 ? "1학년" : c.user.grade === 2 ? "2학년" : "3학년");
    } else {
      category = c.type === "WORK" ? "교사 근무" : "교사 개인";
    }
    return {
      category,
      grade: c.user.grade,
      classNum: c.user.classNum,
      number: c.user.number,
      name: c.user.name,
      subject: c.user.subject,
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
    "1학년": 0, "2학년": 0, "3학년": 0, "교사 근무": 0, "교사 개인": 0,
  };
  for (const r of rows) counts[r.category]++;
  const total = rows.length;

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet(dateParam);

  const headers = ["구분", "학년", "반", "번호", "이름", "교과", "체크인 시각", "출처"];
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
    ` · 교사 근무 ${counts["교사 근무"]} · 교사 개인 ${counts["교사 개인"]} · 총 ${total}`;
  summaryCell.alignment = { horizontal: "center" };
  summaryCell.font = { italic: true };

  const headerRow = sheet.getRow(4);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };

  const widths = [10, 6, 6, 6, 12, 14, 18, 8];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  for (const r of rows) {
    const isStudent = r.category.endsWith("학년");
    const row = sheet.addRow([
      r.category,
      isStudent ? r.grade : "",
      isStudent ? r.classNum : "",
      isStudent ? r.number : "",
      r.name,
      isStudent ? "" : (r.subject ?? ""),
      formatDateTimeKST(r.checkedAt),
      sourceLabel(r.source),
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
