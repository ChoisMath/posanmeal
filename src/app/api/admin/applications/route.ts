import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [applications, cancelledCounts] = await Promise.all([
    prisma.mealApplication.findMany({
      include: {
        _count: {
          select: {
            registrations: { where: { status: "APPROVED" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mealRegistration.groupBy({
      by: ["applicationId"],
      where: { status: "CANCELLED" },
      _count: true,
    }),
  ]);

  const cancelledMap = new Map(
    cancelledCounts.map((c) => [c.applicationId, c._count])
  );

  const appsWithCounts = applications.map((app) => ({
    ...app,
    cancelledCount: cancelledMap.get(app.id) || 0,
  }));

  return NextResponse.json({ applications: appsWithCounts });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  if (!body.title || !body.type || !body.applyStart || !body.applyEnd) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }
  if (!["DINNER", "BREAKFAST", "OTHER"].includes(body.type)) {
    return NextResponse.json({ error: "잘못된 종류입니다." }, { status: 400 });
  }
  const application = await prisma.mealApplication.create({
    data: {
      title: body.title,
      description: body.description || null,
      type: body.type,
      applyStart: new Date(body.applyStart),
      applyEnd: new Date(body.applyEnd),
      mealStart: body.mealStart ? new Date(body.mealStart) : null,
      mealEnd: body.mealEnd ? new Date(body.mealEnd) : null,
    },
  });
  return NextResponse.json({ application }, { status: 201 });
}
