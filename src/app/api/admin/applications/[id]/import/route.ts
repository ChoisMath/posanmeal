import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";
import { resolveRegistrationSelections, writeRegistration } from "@/lib/meal-plan-server";
import type { MealKind } from "@/lib/meal-plan";

const MEAL_KINDS_ORDER: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];

function isOMarked(raw: unknown): boolean {
  const v = String(raw ?? "").trim();
  return v === "O" || v === "o" || v === "ㅇ";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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

  // 공고 식사 설정 + 전체 학생 목록 병렬 조회
  const [appMealsConfig, allStudents] = await Promise.all([
    prisma.mealApplicationMeal.findMany({ where: { applicationId } }),
    prisma.user.findMany({
      where: { role: "STUDENT" },
      select: { id: true, grade: true, classNum: true, number: true, name: true },
    }),
  ]);

  // method가 NONE이 아닌 식사 종류 집합
  const availableKinds = new Set<MealKind>(
    appMealsConfig
      .filter((m) => m.method !== "NONE")
      .map((m) => m.mealKind as MealKind),
  );

  // 학년-반-번호 → userId 맵
  const studentMap = new Map<string, { id: number; grade: number }>();
  for (const s of allStudents) {
    if (s.grade != null && s.classNum != null && s.number != null) {
      studentMap.set(`${s.grade}-${s.classNum}-${s.number}`, { id: s.id, grade: s.grade });
    }
  }

  // Excel 파싱: 3행부터
  // 1행: 헤더, 2행: 안내문, 3행~: 학생 데이터
  // A=학년 B=반 C=번호 D=이름 E=조식 F=중식 G=석식

  type RowEntry = {
    userId: number;
    grade: number;
    markedKinds: MealKind[];
  };

  const toProcess: RowEntry[] = [];
  let skippedNotFound = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;

    const grade = row.getCell(1).value;
    const classNum = row.getCell(2).value;
    const number = row.getCell(3).value;

    // 열 E(5)=조식, F(6)=중식, G(7)=석식
    const markedKinds = MEAL_KINDS_ORDER.filter((kind, ki) => {
      if (!availableKinds.has(kind)) return false;
      return isOMarked(row.getCell(5 + ki).value);
    });

    // 하나도 O 없으면 건너뜀 (기존 신청 변경 안 함)
    if (markedKinds.length === 0) return;

    const key = `${grade}-${classNum}-${number}`;
    const found = studentMap.get(key);
    if (!found) {
      skippedNotFound++;
      return;
    }

    toProcess.push({ userId: found.id, grade: found.grade, markedKinds });
  });

  let added = 0;
  let updated = 0;
  let skippedInvalid = 0;

  for (const entry of toProcess) {
    const meals = entry.markedKinds.map((kind) => ({
      mealKind: kind,
      applied: true as const,
      exempt: false as const,
    }));

    const resolved = await resolveRegistrationSelections(applicationId, entry.grade, meals);
    if (!resolved.ok) {
      skippedInvalid++;
      continue;
    }

    try {
      const result = await prisma.$transaction((tx) =>
        writeRegistration(tx, applicationId, entry.userId, "(관리자 일괄등록)", resolved.resolved, "ADMIN"),
      );
      if (result.created) {
        added++;
      } else {
        updated++;
      }
    } catch {
      skippedInvalid++;
    }
  }

  return NextResponse.json({
    added,
    updated,
    skippedNotFound,
    skippedInvalid,
    total: toProcess.length + skippedNotFound,
  });
}
