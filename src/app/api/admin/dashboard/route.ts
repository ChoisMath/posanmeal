import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date") || todayKST();
  const targetDate = new Date(dateParam);

  // Parallel: groupBy for counts + findMany for records
  const [counts, records] = await Promise.all([
    prisma.checkIn.groupBy({
      by: ["type"],
      where: { date: targetDate },
      _count: { id: true },
    }),
    prisma.checkIn.findMany({
      where: { date: targetDate },
      select: {
        id: true,
        type: true,
        source: true,
        checkedAt: true,
        user: { select: { name: true, role: true, grade: true, classNum: true, number: true } },
      },
      orderBy: { checkedAt: "asc" },
    }),
  ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.type, c._count.id]));

  return NextResponse.json({
    date: dateParam,
    studentCount: countMap.STUDENT || 0,
    teacherWorkCount: countMap.WORK || 0,
    teacherPersonalCount: countMap.PERSONAL || 0,
    records: records.map((c) => ({
      id: c.id,
      userName: c.user.name,
      role: c.user.role,
      type: c.type,
      source: c.source,
      checkedAt: c.checkedAt.toISOString(),
      grade: c.user.grade,
      classNum: c.user.classNum,
      number: c.user.number,
    })),
  });
}
