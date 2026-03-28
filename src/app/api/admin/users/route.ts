import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role") as "STUDENT" | "TEACHER" | null;
  const where = role ? { role } : {};
  const users = await prisma.user.findMany({
    where,
    include: { mealPeriod: true },
    orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      email: body.email, name: body.name, role: body.role,
      grade: body.grade || null, classNum: body.classNum || null, number: body.number || null,
      subject: body.subject || null, homeroom: body.homeroom || null, position: body.position || null,
    },
  });

  if (body.role === "STUDENT" && body.startDate && body.endDate) {
    await prisma.mealPeriod.create({
      data: { userId: user.id, startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
    });
  }
  return NextResponse.json({ user }, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const user = await prisma.user.update({
    where: { id: body.id },
    data: { email: body.email, name: body.name, grade: body.grade, classNum: body.classNum, number: body.number, subject: body.subject, homeroom: body.homeroom, position: body.position },
  });
  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "0");
  if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
