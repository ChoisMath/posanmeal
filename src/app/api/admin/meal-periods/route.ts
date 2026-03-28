import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  const body = await request.json();
  const mealPeriod = await prisma.mealPeriod.upsert({
    where: { userId: body.userId },
    update: { startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
    create: { userId: body.userId, startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
  });
  return NextResponse.json({ mealPeriod });
}
