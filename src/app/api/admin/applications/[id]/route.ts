import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  if (!body.title || !body.type || !body.applyStart || !body.applyEnd) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }
  if (!["DINNER", "BREAKFAST", "OTHER"].includes(body.type)) {
    return NextResponse.json({ error: "잘못된 종류입니다." }, { status: 400 });
  }
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
