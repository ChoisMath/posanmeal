import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads";
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || "5")) * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `파일 크기는 ${process.env.MAX_FILE_SIZE_MB || 5}MB 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const resized = await sharp(buffer)
    .resize(300, 300, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${session.user.dbUserId}.webp`;
  const filepath = path.join(UPLOAD_DIR, filename);
  await writeFile(filepath, resized);

  const photoUrl = `/uploads/${filename}?t=${Date.now()}`;
  await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: { photoUrl },
  });

  return NextResponse.json({ photoUrl });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.dbUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.dbUserId },
  });

  if (user?.photoUrl) {
    const filename = `${session.user.dbUserId}.webp`;
    const filepath = path.join(UPLOAD_DIR, filename);
    try { await unlink(filepath); } catch {}
  }

  await prisma.user.update({
    where: { id: session.user.dbUserId },
    data: { photoUrl: null },
  });

  return NextResponse.json({ success: true });
}
