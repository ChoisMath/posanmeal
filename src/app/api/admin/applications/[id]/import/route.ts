import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const applicationId = parseInt(id);

  const application = await prisma.mealApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: "시트를 찾을 수 없습니다." }, { status: 400 });
  }

  // 기존 등록된 학생 ID Set + 전체 학생 목록 병렬 조회
  const [existingRegs, allStudents] = await Promise.all([
    prisma.mealRegistration.findMany({
      where: { applicationId, status: "APPROVED" },
      select: { userId: true },
    }),
    prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, grade: true, classNum: true, number: true, name: true },
    }),
  ]);
  const existingUserIds = new Set(existingRegs.map((r) => r.userId));

  // 학년-반-번호 → userId 맵
  const studentMap = new Map<string, number>();
  for (const s of allStudents) {
    if (s.grade != null && s.classNum != null && s.number != null) {
      studentMap.set(`${s.grade}-${s.classNum}-${s.number}`, s.id);
    }
  }

  // Excel 파싱: 4행부터, 신청 컬럼(E)이 "O"인 행만 처리
  const toRegister: number[] = [];
  let skippedExisting = 0;
  let skippedNotFound = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return; // 1: 제목, 2: 빈줄, 3: 헤더

    const grade = row.getCell(1).value;
    const classNum = row.getCell(2).value;
    const number = row.getCell(3).value;
    const applyMark = String(row.getCell(5).value || "").trim().toUpperCase();

    if (applyMark !== "O") return;

    const key = `${grade}-${classNum}-${number}`;
    const userId = studentMap.get(key);

    if (!userId) {
      skippedNotFound++;
      return;
    }

    if (existingUserIds.has(userId)) {
      skippedExisting++;
      return;
    }

    toRegister.push(userId);
  });

  // 일괄 등록
  let added = 0;
  if (toRegister.length > 0) {
    const result = await prisma.mealRegistration.createMany({
      data: toRegister.map((userId) => ({
        applicationId,
        userId,
        signature: "",
        addedBy: "ADMIN",
      })),
      skipDuplicates: true,
    });
    added = result.count;
  }

  return NextResponse.json({
    added,
    skippedExisting,
    skippedNotFound,
    total: toRegister.length + skippedExisting + skippedNotFound,
  });
}
