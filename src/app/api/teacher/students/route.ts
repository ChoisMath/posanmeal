import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const [gradeStr, classStr] = teacher.homeroom.split("-");
  const grade = parseInt(gradeStr);
  const classNum = parseInt(classStr);

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const students = await prisma.user.findMany({
    where: { role: "STUDENT", grade, classNum },
    include: {
      mealPeriod: true,
      checkIns: {
        where: { date: { gte: startDate, lte: endDate } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: { number: "asc" },
  });

  return NextResponse.json({ students, grade, classNum });
}
