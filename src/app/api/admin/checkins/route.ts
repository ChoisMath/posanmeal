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
        select: { date: true, checkedAt: true, type: true },
        orderBy: { date: "asc" },
      },
    },
    orderBy: isTeacher
      ? { name: "asc" }
      : [{ classNum: "asc" }, { number: "asc" }],
  });

  return NextResponse.json({ users, year, month, category });
}
