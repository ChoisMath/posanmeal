import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";
import { canWriteAdmin } from "@/lib/permissions";
import type { MealKind } from "@/lib/meal-kind";
import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD, FACE_MODEL_VERSION } from "@/lib/face-constants";

export async function GET(request: Request) {
  const session = await auth();
  if (!canWriteAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date(todayKST());
  const through = new Date(today);
  through.setDate(through.getDate() + 13);

  const includeFaces = new URL(request.url).searchParams.get("faces") === "1";

  const [settings, users, mealDateEntries, faceProfiles] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.user.findMany({
      select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
    }),
    prisma.mealRegistrationMealDate.findMany({
      where: {
        date: { gte: today, lte: through },
        registration: { status: "APPROVED" },
      },
      select: {
        mealKind: true,
        date: true,
        registration: { select: { userId: true } },
      },
    }),
    includeFaces
      ? prisma.faceProfile.findMany({ where: { modelVersion: FACE_MODEL_VERSION }, select: { userId: true, embeddings: true } })
      : Promise.resolve(null),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const eligibleEntries: Array<{ userId: number; date: string; mealKind: MealKind }> =
    mealDateEntries.map((r) => ({
      userId: r.registration.userId,
      date: r.date.toISOString().slice(0, 10),
      mealKind: r.mealKind,
    }));

  // Legacy field: today's DINNER entries, for older tablet clients that relied on eligibleUserIds
  const todayStr = todayKST();
  const eligibleUserIds = mealDateEntries
    .filter((r) => r.mealKind === "DINNER" && r.date.toISOString().slice(0, 10) === todayStr)
    .map((r) => r.registration.userId);

  return NextResponse.json({
    operationMode: settingsMap.operationMode || "online",
    qrGeneration: parseInt(settingsMap.qrGeneration || "1", 10),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      grade: u.grade,
      classNum: u.classNum,
      number: u.number,
    })),
    eligibleUserIds,
    eligibleEntries,
    mealWindows: {
      breakfast: {
        start: settingsMap.breakfast_window_start || "04:00",
        end: settingsMap.breakfast_window_end || "10:00",
      },
      lunch: {
        start: settingsMap.lunch_window_start || "10:30",
        end: settingsMap.lunch_window_end || "14:00",
      },
      dinner: {
        start: settingsMap.dinner_window_start || "15:00",
        end: settingsMap.dinner_window_end || "21:00",
      },
    },
    serverTime: new Date().toISOString(),
    ...(includeFaces && faceProfiles
      ? {
          faceProfiles: faceProfiles.map((p) => ({ userId: p.userId, embeddings: p.embeddings as number[][] })),
          faceMatch: {
            threshold: parseFloatOr(settingsMap.face_match_threshold, DEFAULT_FACE_MATCH_THRESHOLD),
            margin: parseFloatOr(settingsMap.face_match_margin, DEFAULT_FACE_MATCH_MARGIN),
          },
        }
      : {}),
  });
}

function parseFloatOr(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
