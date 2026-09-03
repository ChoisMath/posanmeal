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
      faceMatch: settings.faceMatch,
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

  if (body.faceMatchThreshold !== undefined) {
    if (typeof body.faceMatchThreshold !== "number" || body.faceMatchThreshold <= 0 || body.faceMatchThreshold > 1) {
      return NextResponse.json({ error: "안면인식 임계값이 올바르지 않습니다." }, { status: 400 });
    }
    await prisma.systemSetting.upsert({
      where: { key: "face_match_threshold" },
      update: { value: String(body.faceMatchThreshold) },
      create: { key: "face_match_threshold", value: String(body.faceMatchThreshold) },
    });
  }

  if (body.faceMatchMargin !== undefined) {
    if (typeof body.faceMatchMargin !== "number" || body.faceMatchMargin < 0 || body.faceMatchMargin > 0.5) {
      return NextResponse.json({ error: "안면인식 임계값이 올바르지 않습니다." }, { status: 400 });
    }
    await prisma.systemSetting.upsert({
      where: { key: "face_match_margin" },
      update: { value: String(body.faceMatchMargin) },
      create: { key: "face_match_margin", value: String(body.faceMatchMargin) },
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
    const incoming = body.mealWindows as {
      breakfast?: { start?: string; end?: string };
      lunch?: { start?: string; end?: string };
      dinner?: { start?: string; end?: string };
    };

    // 부분 업데이트 지원: 누락된 윈도우는 현재 DB 값으로 채움
    const current = await getCachedSettings();
    const merged = {
      breakfast: {
        start: incoming.breakfast?.start ?? current.mealWindows.breakfast.start,
        end: incoming.breakfast?.end ?? current.mealWindows.breakfast.end,
      },
      lunch: {
        start: incoming.lunch?.start ?? current.mealWindows.lunch.start,
        end: incoming.lunch?.end ?? current.mealWindows.lunch.end,
      },
      dinner: {
        start: incoming.dinner?.start ?? current.mealWindows.dinner.start,
        end: incoming.dinner?.end ?? current.mealWindows.dinner.end,
      },
    };

    const timePattern = /^\d{2}:\d{2}$/;
    const allValues = [
      merged.breakfast.start,
      merged.breakfast.end,
      merged.lunch.start,
      merged.lunch.end,
      merged.dinner.start,
      merged.dinner.end,
    ];
    if (allValues.some((v) => typeof v !== "string" || !timePattern.test(v))) {
      return NextResponse.json({ error: "Invalid meal window" }, { status: 400 });
    }

    const toMinutes = (v: string) => {
      const [h, m] = v.split(":").map(Number);
      return h * 60 + m;
    };
    const bfS = toMinutes(merged.breakfast.start);
    const bfE = toMinutes(merged.breakfast.end);
    const luS = toMinutes(merged.lunch.start);
    const luE = toMinutes(merged.lunch.end);
    const dnS = toMinutes(merged.dinner.start);
    const dnE = toMinutes(merged.dinner.end);

    if (bfS >= bfE || luS >= luE || dnS >= dnE) {
      return NextResponse.json({ error: "Start time must be before end time" }, { status: 400 });
    }
    // 3쌍 겹침 검사: 조-중, 조-석, 중-석
    const overlaps = (aS: number, aE: number, bS: number, bE: number) => aE > bS && aS < bE;
    if (overlaps(bfS, bfE, luS, luE) || overlaps(bfS, bfE, dnS, dnE) || overlaps(luS, luE, dnS, dnE)) {
      return NextResponse.json({ error: "Meal windows must not overlap" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.systemSetting.upsert({
        where: { key: "breakfast_window_start" },
        update: { value: merged.breakfast.start },
        create: { key: "breakfast_window_start", value: merged.breakfast.start },
      }),
      prisma.systemSetting.upsert({
        where: { key: "breakfast_window_end" },
        update: { value: merged.breakfast.end },
        create: { key: "breakfast_window_end", value: merged.breakfast.end },
      }),
      prisma.systemSetting.upsert({
        where: { key: "lunch_window_start" },
        update: { value: merged.lunch.start },
        create: { key: "lunch_window_start", value: merged.lunch.start },
      }),
      prisma.systemSetting.upsert({
        where: { key: "lunch_window_end" },
        update: { value: merged.lunch.end },
        create: { key: "lunch_window_end", value: merged.lunch.end },
      }),
      prisma.systemSetting.upsert({
        where: { key: "dinner_window_start" },
        update: { value: merged.dinner.start },
        create: { key: "dinner_window_start", value: merged.dinner.start },
      }),
      prisma.systemSetting.upsert({
        where: { key: "dinner_window_end" },
        update: { value: merged.dinner.end },
        create: { key: "dinner_window_end", value: merged.dinner.end },
      }),
    ]);
  }

  invalidateSettingsCache();

  const settings = await getCachedSettings();
  return NextResponse.json({
    operationMode: settings.operationMode,
    qrGeneration: parseInt(settings.qrGeneration, 10),
    mealWindows: settings.mealWindows,
    faceMatch: settings.faceMatch,
  });
}
