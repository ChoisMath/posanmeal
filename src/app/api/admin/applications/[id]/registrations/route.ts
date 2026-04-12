import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const registrations = await prisma.mealRegistration.findMany({
    where: { applicationId: parseInt(id) },
    include: {
      user: {
        select: { id: true, name: true, grade: true, classNum: true, number: true },
      },
    },
    orderBy: [
      { user: { grade: "asc" } },
      { user: { classNum: "asc" } },
      { user: { number: "asc" } },
    ],
  });
  return NextResponse.json({ registrations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await request.json();
  try {
    const registration = await prisma.mealRegistration.create({
      data: {
        applicationId: parseInt(id),
        userId,
        signature: "",
        addedBy: "ADMIN",
      },
    });
    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 등록되어 있습니다." }, { status: 409 });
    }
    throw err;
  }
}
