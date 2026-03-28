import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId: session.user.dbUserId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ checkIns });
}
