import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";

export async function GET(request: Request) {
  return routeResponse(async () => {
    const userId = selfUserId(await requireActor("SIGNED_IN"));

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const checkIns = await prisma.checkIn.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        date: true,
        checkedAt: true,
        type: true,
        mealKind: true,
      },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({ checkIns });
  });
}
