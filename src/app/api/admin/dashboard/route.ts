import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  const targetDate = new Date(dateParam);

  const checkIns = await prisma.checkIn.findMany({
    where: { date: targetDate },
    include: { user: { select: { name: true, role: true, grade: true, classNum: true, number: true } } },
    orderBy: { checkedAt: "asc" },
  });

  const studentCount = checkIns.filter((c) => c.type === "STUDENT").length;
  const teacherWorkCount = checkIns.filter((c) => c.type === "WORK").length;
  const teacherPersonalCount = checkIns.filter((c) => c.type === "PERSONAL").length;

  const records = checkIns.map((c) => ({
    userName: c.user.name, role: c.user.role, type: c.type,
    checkedAt: c.checkedAt.toISOString(),
    grade: c.user.grade, classNum: c.user.classNum, number: c.user.number,
  }));

  return NextResponse.json({ date: dateParam, studentCount, teacherWorkCount, teacherPersonalCount, records });
}
