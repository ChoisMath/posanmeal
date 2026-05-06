import { NextResponse } from "next/server";
import path from "node:path";

const SAFE_UPLOAD_NAME = /^[A-Za-z0-9._-]+$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safeName = path.basename(filename);

  if (safeName !== filename || !SAFE_UPLOAD_NAME.test(safeName)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  return NextResponse.redirect(new URL(`/uploads/${safeName}`, request.url));
}
