import { NextResponse } from "next/server";
import { verifyQRToken } from "@/lib/qr-token";
import { prisma } from "@/lib/prisma";
import { todayKST } from "@/lib/timezone";

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: "토큰이 없습니다." },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = verifyQRToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: "QR이 만료되었습니다. 새로고침 해주세요." },
        { status: 400 }
      );
    }

    const today = todayKST();
    const todayDate = new Date(today);

    if (payload.role === "STUDENT") {
      const mealPeriod = await prisma.mealPeriod.findUnique({
        where: { userId: payload.userId },
      });

      if (!mealPeriod) {
        return NextResponse.json(
          { success: false, error: "석식 신청 기간이 없습니다." },
          { status: 400 }
        );
      }

      if (todayDate < mealPeriod.startDate || todayDate > mealPeriod.endDate) {
        return NextResponse.json(
          { success: false, error: "석식 신청 기간이 아닙니다." },
          { status: 400 }
        );
      }
    }

    const existing = await prisma.checkIn.findUnique({
      where: {
        userId_date: {
          userId: payload.userId,
          date: todayDate,
        },
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        role: true,
        grade: true,
        classNum: true,
        number: true,
        photoUrl: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (existing) {
      return NextResponse.json({
        success: false,
        duplicate: true,
        user,
        error: "이미 Checkin 되었습니다. 확인해 주세요.",
      });
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: payload.userId,
        date: todayDate,
        type: payload.type,
      },
    });

    return NextResponse.json({
      success: true,
      user,
      type: payload.type,
      checkedAt: checkIn.checkedAt,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
