import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const application = await prisma.mealApplication.findUnique({
    where: { id: parseInt(id) },
    include: {
      registrations: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { name: true, grade: true, classNum: true, number: true } },
        },
        orderBy: [
          { user: { grade: "asc" } },
          { user: { classNum: "asc" } },
          { user: { number: "asc" } },
        ],
      },
    },
  });

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet("신청명단");

  sheet.mergeCells(1, 1, 1, 5);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${application.title} 신청명단`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  const headerRow = sheet.getRow(3);
  ["학년", "반", "번호", "이름", "신청일시"].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
  });

  [6, 6, 6, 12, 20].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  let row = 4;
  for (const reg of application.registrations) {
    const dataRow = sheet.getRow(row++);
    dataRow.getCell(1).value = reg.user.grade;
    dataRow.getCell(2).value = reg.user.classNum;
    dataRow.getCell(3).value = reg.user.number;
    dataRow.getCell(4).value = reg.user.name;
    dataRow.getCell(5).value = reg.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_신청명단.xlsx"`,
    },
  });
}
