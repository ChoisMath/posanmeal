import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const application = await prisma.mealApplication.update({
    where: { id: parseInt(id) },
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
  return NextResponse.json({ application });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.mealApplication.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ success: true });
}
