import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/admin/checkins?year=2026&month=3&category=teacher|1|2|3
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());
  const category = searchParams.get("category") || "teacher";

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const isTeacher = category === "teacher";
  const grade = isTeacher ? undefined : parseInt(category);

  const users = await prisma.user.findMany({
    where: isTeacher
      ? { role: "TEACHER" }
      : { role: "STUDENT", grade },
    select: {
      id: true,
      name: true,
      number: true,
      grade: true,
      classNum: true,
      subject: true,
      homeroom: true,
      mealPeriod: { select: { startDate: true, endDate: true } },
      checkIns: {
        where: { date: { gte: startDate, lte: endDate } },
        select: { id: true, date: true, checkedAt: true, type: true },
        orderBy: { date: "asc" },
      },
    },
    orderBy: isTeacher
      ? { name: "asc" }
      : [{ classNum: "asc" }, { number: "asc" }],
  });

  return NextResponse.json({ users, year, month, category });
}

// PATCH /api/admin/checkins — 체크인 타입 수정 (교사 근무↔개인)
export async function PATCH(request: Request) {
  const { id, type } = await request.json();

  if (!id || !["WORK", "PERSONAL"].includes(type)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const checkIn = await prisma.checkIn.findUnique({
    where: { id },
    select: { id: true, type: true, user: { select: { role: true } } },
  });

  if (!checkIn) {
    return NextResponse.json({ error: "체크인 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  if (checkIn.user.role !== "TEACHER") {
    return NextResponse.json({ error: "교사의 체크인만 수정할 수 있습니다." }, { status: 400 });
  }

  const updated = await prisma.checkIn.update({
    where: { id },
    data: { type },
  });

  return NextResponse.json({ success: true, checkIn: updated });
}
