import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const applications = await prisma.mealApplication.findMany({
    include: {
      _count: {
        select: {
          registrations: { where: { status: "APPROVED" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const appsWithCounts = await Promise.all(
    applications.map(async (app) => {
      const cancelledCount = await prisma.mealRegistration.count({
        where: { applicationId: app.id, status: "CANCELLED" },
      });
      return { ...app, cancelledCount };
    })
  );

  return NextResponse.json({ applications: appsWithCounts });
}

export async function POST(request: Request) {
  const body = await request.json();
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
