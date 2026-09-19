import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/academic-year/api";
import { requireActor, selfUserId } from "@/lib/academic-year/request-actor";
import { prisma } from "@/lib/prisma";
import { faceEnrollSchema } from "@/lib/schemas/face";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";
import { FACE_CONSENT_VERSION } from "@/lib/face-consent";
import { invalidateFaceCache } from "@/lib/face-embedding-cache";

export async function GET() {
  let userId: number;
  try {
    userId = selfUserId(await requireActor("SIGNED_IN"));
  } catch (error) {
    return errorResponse(error);
  }

  const profile = await prisma.faceProfile.findUnique({
    where: { userId },
    select: { consentAt: true, modelVersion: true, updatedAt: true },
  });

  if (!profile) return NextResponse.json({ registered: false });
  return NextResponse.json({
    registered: true,
    consentAt: profile.consentAt,
    modelVersion: profile.modelVersion,
    updatedAt: profile.updatedAt,
  });
}

export async function POST(request: Request) {
  let userId: number;
  try {
    userId = selfUserId(await requireActor("SIGNED_IN"));
  } catch (error) {
    return errorResponse(error);
  }

  const parsed = faceEnrollSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { embeddings, consentVersion } = parsed.data;
  if (consentVersion !== FACE_CONSENT_VERSION) {
    return NextResponse.json({ error: "동의문이 갱신되었습니다. 다시 동의해 주세요." }, { status: 400 });
  }
  const now = new Date();
  await prisma.faceProfile.upsert({
    where: { userId },
    create: {
      userId,
      embeddings,
      modelVersion: FACE_MODEL_VERSION,
      consentAt: now,
      consentVersion,
    },
    update: {
      embeddings,
      modelVersion: FACE_MODEL_VERSION,
      consentAt: now,
      consentVersion,
    },
  });
  invalidateFaceCache();

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  let userId: number;
  try {
    userId = selfUserId(await requireActor("SIGNED_IN"));
  } catch (error) {
    return errorResponse(error);
  }

  await prisma.faceProfile.deleteMany({ where: { userId } });
  invalidateFaceCache();
  return NextResponse.json({ ok: true });
}
