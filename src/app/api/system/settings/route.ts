import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCachedSettings, invalidateSettingsCache } from "@/lib/settings-cache";

export async function GET() {
  const settings = await getCachedSettings();
  return NextResponse.json(
    {
      operationMode: settings.operationMode,
      qrGeneration: parseInt(settings.qrGeneration, 10),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
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
    await prisma.$executeRaw`
      INSERT INTO "SystemSetting" (key, value, "updatedAt")
      VALUES ('qrGeneration', '2', NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = (CAST("SystemSetting".value AS INTEGER) + 1)::TEXT,
          "updatedAt" = NOW()
    `;
  }

  invalidateSettingsCache();

  const settings = await getCachedSettings();
  return NextResponse.json({
    operationMode: settings.operationMode,
    qrGeneration: parseInt(settings.qrGeneration, 10),
  });
}
