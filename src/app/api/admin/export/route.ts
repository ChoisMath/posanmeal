import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const checkIns = await prisma.checkIn.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    include: { user: { select: { name: true, role: true, grade: true, classNum: true, number: true, subject: true } } },
    orderBy: [{ date: "asc" }, { checkedAt: "asc" }],
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${year}년 ${month}월 석식 현황`);

  sheet.columns = [
    { header: "날짜", key: "date", width: 12 },
    { header: "이름", key: "name", width: 15 },
    { header: "구분", key: "role", width: 10 },
    { header: "학년-반-번호", key: "classInfo", width: 15 },
    { header: "유형", key: "type", width: 10 },
    { header: "체크인 시각", key: "checkedAt", width: 15 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const c of checkIns) {
    const typeLabel = c.type === "STUDENT" ? "학생" : c.type === "WORK" ? "근무" : "개인";
    const roleLabel = c.user.role === "STUDENT" ? "학생" : "교사";
    const classInfo = c.user.role === "STUDENT" ? `${c.user.grade}-${c.user.classNum}-${c.user.number}` : c.user.subject || "-";

    sheet.addRow({
      date: c.date.toISOString().slice(0, 10),
      name: c.user.name,
      role: roleLabel,
      classInfo,
      type: typeLabel,
      checkedAt: c.checkedAt.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="meal_${year}_${month}.xlsx"`,
    },
  });
}
