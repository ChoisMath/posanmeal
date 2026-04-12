import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date(todayKST());

  const applications = await prisma.mealApplication.findMany({
    where: {
      status: "OPEN",
      applyStart: { lte: today },
      applyEnd: { gte: today },
    },
    include: {
      registrations: {
        where: { userId: session.user.dbUserId },
        select: { id: true, status: true, createdAt: true },
      },
    },
    orderBy: { applyEnd: "asc" },
  });

  return NextResponse.json({ applications });
}
