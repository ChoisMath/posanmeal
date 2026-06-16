import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId || session.user.role !== "TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    select: { homeroom: true },
  });
  if (!teacher?.homeroom) {
    return NextResponse.json({ error: "담임 교사가 아닙니다." }, { status: 403 });
  }

  const applications = await prisma.mealApplication.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      startYear: true,
      startMonth: true,
      monthCount: true,
      applyStartAt: true,
      applyEndAt: true,
      meals: { select: { mealKind: true, method: true } },
    },
  });

  return NextResponse.json({ applications });
}
