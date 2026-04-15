import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

// POST /api/admin/checkins/toggle
// body: { userId: number, date: "YYYY-MM-DD", action: "cycle" | "toggle" }
//  - action="cycle"  (교사): 없음 → WORK → PERSONAL → 삭제
//  - action="toggle" (학생): 없음 ↔ STUDENT
export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: number; date?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { userId, date, action } = body;

  if (
    typeof userId !== "number" ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    (action !== "cycle" && action !== "toggle")
  ) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const targetDate = new Date(`${date}T00:00:00.000Z`);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }

  if (action === "cycle" && user.role !== "TEACHER") {
    return NextResponse.json({ error: "교사에게만 적용됩니다." }, { status: 400 });
  }
  if (action === "toggle" && user.role !== "STUDENT") {
    return NextResponse.json({ error: "학생에게만 적용됩니다." }, { status: 400 });
  }

  const existing = await prisma.checkIn.findUnique({
    where: { userId_date: { userId, date: targetDate } },
    select: { id: true, type: true },
  });

  if (action === "cycle") {
    if (!existing) {
      await prisma.checkIn.create({
        data: { userId, date: targetDate, type: "WORK" },
      });
      return NextResponse.json({ success: true, state: "WORK" });
    }
    if (existing.type === "WORK") {
      await prisma.checkIn.update({
        where: { id: existing.id },
        data: { type: "PERSONAL" },
      });
      return NextResponse.json({ success: true, state: "PERSONAL" });
    }
    await prisma.checkIn.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true, state: "empty" });
  }

  if (!existing) {
    await prisma.checkIn.create({
      data: { userId, date: targetDate, type: "STUDENT" },
    });
    return NextResponse.json({ success: true, state: "STUDENT" });
  }
  await prisma.checkIn.delete({ where: { id: existing.id } });
  return NextResponse.json({ success: true, state: "empty" });
}
