import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const registrations = await prisma.mealRegistration.findMany({
    where: { applicationId: parseInt(id) },
    include: {
      selectedDates: { orderBy: { date: "asc" } },
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
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { userId } = await request.json();
  try {
    const applicationId = parseInt(id, 10);
    const app = await prisma.mealApplication.findUnique({
      where: { id: applicationId },
      include: { allowedDates: { orderBy: { date: "asc" } } },
    });
    if (!app) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.mealRegistration.create({
        data: {
          applicationId,
          userId,
          signature: "",
          addedBy: "ADMIN",
        },
      });
      if (app.type === "BREAKFAST" && app.allowedDates.length > 0) {
        await tx.mealRegistrationDate.createMany({
          data: app.allowedDates.map((d) => ({
            registrationId: created.id,
            date: d.date,
          })),
          skipDuplicates: true,
        });
      }
      return tx.mealRegistration.findUnique({
        where: { id: created.id },
        include: { selectedDates: { orderBy: { date: "asc" } } },
      });
    });
    return NextResponse.json({ registration }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "이미 등록되어 있습니다." }, { status: 409 });
    }
    throw err;
  }
}
