import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Prevent directory traversal
  const safeName = path.basename(filename);
  const filepath = path.join(UPLOAD_DIR, safeName);

  try {
    const buffer = await readFile(filepath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = ext === ".webp" ? "image/webp" : ext === ".png" ? "image/png" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
