import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

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

    // 신청자 목록 (별도 쿼리, orderBy 단순화)
    const registrations = await prisma.mealRegistration.findMany({
      where: { applicationId: appId, status: "APPROVED" },
      include: {
        user: { select: { id: true, name: true, grade: true, classNum: true, number: true } },
      },
    });

    // JS에서 정렬
    registrations.sort((a, b) =>
      (a.user.grade ?? 0) - (b.user.grade ?? 0) ||
      (a.user.classNum ?? 0) - (b.user.classNum ?? 0) ||
      (a.user.number ?? 0) - (b.user.number ?? 0)
    );

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();

    if (isTemplate) {
      const allStudents = await prisma.user.findMany({
        where: { role: "STUDENT" },
        select: { id: true, name: true, grade: true, classNum: true, number: true },
        orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }],
      });

      const registeredIds = new Set(registrations.map((r) => r.user.id));

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

    // 신청명단 다운로드
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
    [6, 6, 6, 12, 20].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    let row = 4;
    for (const reg of registrations) {
      const r = sheet.getRow(row++);
      r.getCell(1).value = reg.user.grade;
      r.getCell(2).value = reg.user.classNum;
      r.getCell(3).value = reg.user.number;
      r.getCell(4).value = reg.user.name;
      r.getCell(5).value = reg.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(application.title)}_list.xlsx"`,
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
