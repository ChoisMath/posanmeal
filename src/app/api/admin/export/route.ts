import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
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

    // 행1: 제목 (병합)
    const lastCol = daysInMonth + 2; // A + days + 합계
    sheet.mergeCells(1, 1, 1, lastCol);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center" };

    // 행2: 빈 행

    // 행3: 헤더
    const headerRow = sheet.getRow(3);
    headerRow.getCell(1).value = label;
    for (let d = 1; d <= daysInMonth; d++) {
      headerRow.getCell(d + 1).value = d;
    }
    headerRow.getCell(lastCol).value = "합계";
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: "center" };
    headerRow.getCell(1).alignment = { horizontal: "left" };

    // 열 너비
    sheet.getColumn(1).width = isTeacher ? 12 : 16;
    for (let d = 1; d <= daysInMonth; d++) {
      sheet.getColumn(d + 1).width = 4;
    }
    sheet.getColumn(lastCol).width = 6;

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
      for (let d = 1; d <= daysInMonth; d++) {
        const checkIn = checkedDaysMap.get(d);
        if (checkIn) {
          count++;
          if (isTeacher) {
            const type = (checkIn as { type?: string }).type;
            row.getCell(d + 1).value = type === "WORK" ? "근" : "개";
          } else {
            row.getCell(d + 1).value = "O";
          }
        }
      }

      // 합계열
      row.getCell(lastCol).value = count;

      // 가운데 정렬 (날짜/합계)
      for (let c = 2; c <= lastCol; c++) {
        row.getCell(c).alignment = { horizontal: "center" };
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
