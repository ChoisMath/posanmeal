import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCachedSettings, invalidateSettingsCache } from "@/lib/settings-cache";
import { canWriteAdmin } from "@/lib/permissions";

export async function GET() {
  const settings = await getCachedSettings();
  return NextResponse.json(
    {
      operationMode: settings.operationMode,
      qrGeneration: parseInt(settings.qrGeneration, 10),
      mealWindows: settings.mealWindows,
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
  if (!canWriteAdmin(session)) {
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

  if (body.mealWindows !== undefined) {
    const mealWindows = body.mealWindows as {
      breakfast?: { start?: string; end?: string };
      dinner?: { start?: string; end?: string };
    };
    const timePattern = /^\d{2}:\d{2}$/;
    const values = [
      mealWindows.breakfast?.start,
      mealWindows.breakfast?.end,
      mealWindows.dinner?.start,
      mealWindows.dinner?.end,
    ];
    if (values.some((value) => typeof value !== "string" || !timePattern.test(value))) {
      return NextResponse.json({ error: "Invalid meal window" }, { status: 400 });
    }
    const toMinutes = (value: string) => {
      const [hour, minute] = value.split(":").map(Number);
      return hour * 60 + minute;
    };
    const bfStart = mealWindows.breakfast!.start!;
    const bfEnd = mealWindows.breakfast!.end!;
    const dnStart = mealWindows.dinner!.start!;
    const dnEnd = mealWindows.dinner!.end!;
    if (toMinutes(bfStart) >= toMinutes(bfEnd) || toMinutes(dnStart) >= toMinutes(dnEnd)) {
      return NextResponse.json({ error: "Start time must be before end time" }, { status: 400 });
    }
    if (toMinutes(bfEnd) > toMinutes(dnStart) && toMinutes(bfStart) < toMinutes(dnEnd)) {
      return NextResponse.json({ error: "Meal windows must not overlap" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.systemSetting.upsert({
        where: { key: "breakfast_window_start" },
        update: { value: bfStart },
        create: { key: "breakfast_window_start", value: bfStart },
      }),
      prisma.systemSetting.upsert({
        where: { key: "breakfast_window_end" },
        update: { value: bfEnd },
        create: { key: "breakfast_window_end", value: bfEnd },
      }),
      prisma.systemSetting.upsert({
        where: { key: "dinner_window_start" },
        update: { value: dnStart },
        create: { key: "dinner_window_start", value: dnStart },
      }),
      prisma.systemSetting.upsert({
        where: { key: "dinner_window_end" },
        update: { value: dnEnd },
        create: { key: "dinner_window_end", value: dnEnd },
      }),
    ]);
  }

  invalidateSettingsCache();

  const settings = await getCachedSettings();
  return NextResponse.json({
    operationMode: settings.operationMode,
    qrGeneration: parseInt(settings.qrGeneration, 10),
    mealWindows: settings.mealWindows,
  });
}
