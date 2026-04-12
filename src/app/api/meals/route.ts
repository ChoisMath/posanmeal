import { NextRequest, NextResponse } from "next/server";
import { fetchMeals } from "@/lib/neis-meal";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let date = searchParams.get("date");

  if (!date) {
    // 오늘 날짜 (KST)
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    date = kst.toISOString().slice(0, 10).replace(/-/g, "");
  }

  if (!/^\d{8}$/.test(date)) {
    return NextResponse.json(
      {
        success: false,
        error: "잘못된 날짜 형식입니다. YYYYMMDD 형식이어야 합니다.",
      },
      { status: 400 }
    );
  }

  const result = await fetchMeals(date);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
