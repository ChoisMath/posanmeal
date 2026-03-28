import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
    include: { mealPeriod: true },
  });

  return NextResponse.json({ user });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.role === "TEACHER") {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: body.name ?? user.name,
        subject: body.subject ?? user.subject,
        homeroom: body.homeroom ?? user.homeroom,
        position: body.position ?? user.position,
      },
    });
    return NextResponse.json({ user: updated });
  }

  return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });
}
