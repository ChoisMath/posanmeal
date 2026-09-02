import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { faceEnrollSchema } from "@/lib/schemas/face";
import { FACE_MODEL_VERSION } from "@/lib/face-constants";
import { invalidateFaceCache } from "@/lib/face-embedding-cache";

export async function GET() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.faceProfile.findUnique({
    where: { userId: session.user.dbUserId },
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
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = faceEnrollSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { embeddings, consentVersion } = parsed.data;
  const now = new Date();
  await prisma.faceProfile.upsert({
    where: { userId: session.user.dbUserId },
    create: {
      userId: session.user.dbUserId,
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
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.faceProfile.deleteMany({ where: { userId: session.user.dbUserId } });
  invalidateFaceCache();
  return NextResponse.json({ ok: true });
}
