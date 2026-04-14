import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role") as "STUDENT" | "TEACHER" | null;
  const where = role ? { role } : {};
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true,
      grade: true, classNum: true, number: true,
      subject: true, homeroom: true, position: true,
      adminLevel: true,
    },
    orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      email: body.email, name: body.name, role: body.role,
      grade: body.grade || null, classNum: body.classNum || null, number: body.number || null,
      subject: body.subject || null, homeroom: body.homeroom || null, position: body.position || null,
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // adminLevel 변경 요청 검증
  if (body.adminLevel !== undefined) {
    const allowed = ["NONE", "SUBADMIN", "ADMIN"] as const;
    if (!allowed.includes(body.adminLevel)) {
      return NextResponse.json(
        { error: "Bad Request", reason: "유효하지 않은 권한 값입니다." },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: body.id },
      select: { id: true, role: true, adminLevel: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "Bad Request", reason: "대상 사용자를 찾을 수 없습니다." },
        { status: 400 }
      );
    }

    if (target.role === "STUDENT" && body.adminLevel !== "NONE") {
      return NextResponse.json(
        { error: "Bad Request", reason: "학생에게는 관리자 권한을 부여할 수 없습니다." },
        { status: 400 }
      );
    }

    const callerDbUserId = session?.user?.dbUserId ?? 0;
    if (
      callerDbUserId !== 0 &&
      callerDbUserId === target.id &&
      target.adminLevel === "ADMIN" &&
      body.adminLevel !== "ADMIN"
    ) {
      return NextResponse.json(
        { error: "Bad Request", reason: "본인의 관리자 권한은 직접 변경할 수 없습니다." },
        { status: 400 }
      );
    }
  }

  const user = await prisma.user.update({
    where: { id: body.id },
    data: {
      email: body.email, name: body.name,
      grade: body.grade, classNum: body.classNum, number: body.number,
      subject: body.subject, homeroom: body.homeroom, position: body.position,
      ...(body.adminLevel !== undefined ? { adminLevel: body.adminLevel } : {}),
    },
  });
  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "0");
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
