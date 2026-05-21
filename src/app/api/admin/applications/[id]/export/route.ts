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
        user: { select: { id: true, name: true, grade: true, classNum: true, number: true, gender: true } },
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

    // 통계 시트
    const stats = workbook.addWorksheet("통계");
    stats.mergeCells(1, 1, 1, 4);
    const statsTitle = stats.getCell(1, 1);
    statsTitle.value = `${application.title} 학년·성별 신청자 수`;
    statsTitle.font = { bold: true, size: 14 };
    statsTitle.alignment = { horizontal: "center" };

    const statsHeader = stats.getRow(3);
    ["학년", "남", "여", "합계"].forEach((h, i) => {
      const cell = statsHeader.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD580" } };
    });
    [10, 8, 8, 10].forEach((w, i) => { stats.getColumn(i + 1).width = w; });

    type GradeKey = 1 | 2 | 3;
    const counts: Record<GradeKey, { MALE: number; FEMALE: number; NONE: number }> = {
      1: { MALE: 0, FEMALE: 0, NONE: 0 },
      2: { MALE: 0, FEMALE: 0, NONE: 0 },
      3: { MALE: 0, FEMALE: 0, NONE: 0 },
    };
    let other = 0;
    for (const reg of registrations) {
      const g = reg.user.grade;
      if (g !== 1 && g !== 2 && g !== 3) { other++; continue; }
      const key: "MALE" | "FEMALE" | "NONE" = reg.user.gender ?? "NONE";
      counts[g as GradeKey][key]++;
    }

    let r = 4;
    let totalMale = 0, totalFemale = 0, totalNone = 0;
    for (const grade of [1, 2, 3] as GradeKey[]) {
      const row = stats.getRow(r++);
      row.getCell(1).value = `${grade}학년`;
      row.getCell(2).value = counts[grade].MALE;
      row.getCell(3).value = counts[grade].FEMALE;
      row.getCell(4).value = counts[grade].MALE + counts[grade].FEMALE + counts[grade].NONE;
      [2, 3, 4].forEach((c) => { row.getCell(c).alignment = { horizontal: "center" }; });
      totalMale += counts[grade].MALE;
      totalFemale += counts[grade].FEMALE;
      totalNone += counts[grade].NONE;
    }
    const totalRow = stats.getRow(r++);
    totalRow.getCell(1).value = "전체";
    totalRow.getCell(2).value = totalMale;
    totalRow.getCell(3).value = totalFemale;
    totalRow.getCell(4).value = totalMale + totalFemale + totalNone;
    [1, 2, 3, 4].forEach((c) => {
      const cell = totalRow.getCell(c);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE9B3" } };
      if (c >= 2) cell.alignment = { horizontal: "center" };
    });

    if (totalNone > 0) {
      const noteRow = stats.getRow(r + 1);
      stats.mergeCells(noteRow.number, 1, noteRow.number, 4);
      const note = noteRow.getCell(1);
      note.value = `* 성별 미입력 학생 ${totalNone}명은 합계에 포함되며 남/여 어느 쪽에도 집계되지 않습니다.`;
      note.font = { italic: true, color: { argb: "FF888888" } };
    }
    if (other > 0) {
      const noteRow2 = stats.getRow(r + 2);
      stats.mergeCells(noteRow2.number, 1, noteRow2.number, 4);
      const note2 = noteRow2.getCell(1);
      note2.value = `* 학년 미지정 ${other}명은 통계에서 제외되었습니다.`;
      note2.font = { italic: true, color: { argb: "FF888888" } };
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
