import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [settings, users, mealPeriods] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.user.findMany({
      select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
    }),
    prisma.mealPeriod.findMany({
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  return NextResponse.json({
    operationMode: settingsMap.operationMode || "online",
    qrGeneration: parseInt(settingsMap.qrGeneration || "1", 10),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      grade: u.grade,
      classNum: u.classNum,
      number: u.number,
    })),
    mealPeriods: mealPeriods.map((mp) => ({
      userId: mp.userId,
      startDate: mp.startDate.toISOString().slice(0, 10),
      endDate: mp.endDate.toISOString().slice(0, 10),
    })),
    serverTime: new Date().toISOString(),
  });
}
