import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const application = await prisma.mealApplication.update({
    where: { id: parseInt(id) },
    data: { status: "CLOSED" },
  });
  return NextResponse.json({ application });
}
