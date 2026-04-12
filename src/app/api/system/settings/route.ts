import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const settings = await prisma.systemSetting.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return NextResponse.json({
    operationMode: result.operationMode || "online",
    qrGeneration: parseInt(result.qrGeneration || "1", 10),
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (body.operationMode !== undefined) {
    if (body.operationMode !== "online" && body.operationMode !== "local") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    await prisma.systemSetting.upsert({
      where: { key: "operationMode" },
      update: { value: body.operationMode },
      create: { key: "operationMode", value: body.operationMode },
    });
  }

  if (body.refreshQR) {
    const current = await prisma.systemSetting.findUnique({
      where: { key: "qrGeneration" },
    });
    const next = (parseInt(current?.value || "1", 10) + 1).toString();
    await prisma.systemSetting.upsert({
      where: { key: "qrGeneration" },
      update: { value: next },
      create: { key: "qrGeneration", value: next },
    });
  }

  const settings = await prisma.systemSetting.findMany();
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }
  return NextResponse.json({
    operationMode: result.operationMode || "online",
    qrGeneration: parseInt(result.qrGeneration || "1", 10),
  });
}
