import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kstDateKey, addDaysToDateKey } from "@/lib/academic-year/calendar";
import { issueKioskDownload, SNAPSHOT_COVERAGE_DAYS } from "@/lib/academic-year/kiosk-snapshot";
import { syncErrorResponse } from "@/lib/academic-year/sync-guard";
import { rosterMode } from "@/lib/academic-year/registration-context";
import { requireActor } from "@/lib/academic-year/request-actor";
import { purgeExpiredRosterCopies } from "@/lib/academic-year/retention";
import type { MealKind } from "@/lib/meal-kind";
import { DEFAULT_FACE_MATCH_MARGIN, DEFAULT_FACE_MATCH_THRESHOLD, FACE_MODEL_VERSION } from "@/lib/face-constants";

export async function GET(request: Request) {
  return syncErrorResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");
    const mode = await rosterMode(prisma);

    const now = new Date();
    const todayStr = kstDateKey(now);
    const includeFaces = new URL(request.url).searchParams.get("faces") === "1";
    const ready = mode === "READY" ? await issueKioskDownload(prisma, actor, now, { includeFaces }) : null;
    const download = ready
      ? {
          ...ready,
          eligibleEntries: ready.snapshot.eligible.map(({ userId, date, mealKind }) => ({
            userId, date, mealKind: mealKind as MealKind,
          })),
        }
      : await readLegacyDownload(todayStr, includeFaces);
    const { users, settings, eligibleEntries, faceProfiles, snapshot } = download;
    const settingsMap = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    const eligibleUserIds = eligibleEntries
      .filter((entry) => entry.mealKind === "DINNER" && entry.date === todayStr)
      .map((entry) => entry.userId);

    const response = NextResponse.json({
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
      ...(snapshot ? { snapshot } : {}),
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

    // 보존 정리는 이 요청의 목적이 아니다. 실패해도 동기화를 막지 않는다.
    try {
      await purgeExpiredRosterCopies(prisma, new Date());
    } catch (error) {
      console.error("[sync] 보존 사본 정리를 끝내지 못했습니다", error);
    }

    return response;
  });
}

async function readLegacyDownload(today: string, includeFaces: boolean) {
  // 준비 중인 명부는 검증된 증거로 저장하지 않되 기존 태블릿 응답은 유지한다.
  const through = addDaysToDateKey(today, SNAPSHOT_COVERAGE_DAYS);
  const [settings, users, mealDateEntries, faceProfiles] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.user.findMany({
      where: { accessState: "ACTIVE" },
      select: { id: true, name: true, role: true, grade: true, classNum: true, number: true },
    }),
    prisma.mealRegistrationMealDate.findMany({
      where: { date: { gte: new Date(today), lte: new Date(through) }, registration: { status: "APPROVED" } },
      select: { mealKind: true, date: true, registration: { select: { userId: true } } },
    }),
    includeFaces
      ? prisma.faceProfile.findMany({
          where: { modelVersion: FACE_MODEL_VERSION, user: { accessState: "ACTIVE" } },
          select: { userId: true, embeddings: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    settings, users, faceProfiles, snapshot: null,
    eligibleEntries: mealDateEntries.map((entry) => ({
      userId: entry.registration.userId,
      date: entry.date.toISOString().slice(0, 10),
      mealKind: entry.mealKind,
    })),
  };
}

function parseFloatOr(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
