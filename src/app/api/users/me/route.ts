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
    select: {
      id: true, email: true, name: true, role: true,
      grade: true, classNum: true, number: true,
      subject: true, homeroom: true, position: true,
      photoUrl: true,
      registrations: {
        where: { status: "APPROVED" },
        select: {
          id: true,
          createdAt: true,
          application: {
            select: { id: true, title: true, type: true, mealStart: true, mealEnd: true },
          },
        },
        orderBy: { createdAt: "desc" as const },
      },
    },
  });

  return NextResponse.json({ user });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // 단일 쿼리로 role 확인 + 업데이트 (findUnique 제거)
  const updated = await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: {
      name: body.name,
      subject: body.subject,
      homeroom: body.homeroom,
      position: body.position,
    },
  }).catch(() => null);

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (updated.role !== "TEACHER") {
    return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });
  }

  return NextResponse.json({ user: updated });
}
