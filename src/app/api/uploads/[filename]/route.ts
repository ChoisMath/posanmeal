import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads");
const SAFE_UPLOAD_NAME = /^[A-Za-z0-9._-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safeName = path.basename(filename);

  if (safeName !== filename || !SAFE_UPLOAD_NAME.test(safeName)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  try {
    const data = await readFile(path.join(UPLOAD_DIR, safeName));
    const contentType =
      CONTENT_TYPES[path.extname(safeName).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    // 볼륨에 없으면 구 정적 경로로 폴백 (구 photoUrl 호환)
    return NextResponse.redirect(new URL(`/uploads/${safeName}`, request.url));
  }
}
