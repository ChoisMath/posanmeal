import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { routeResponse } from "@/lib/academic-year/api";
import { withCompatUserWrite } from "@/lib/academic-year/compat-write";
import { requireActor } from "@/lib/academic-year/request-actor";

export async function GET(request: Request) {
  return routeResponse(async () => {
    await requireActor("READ_ADMIN");

    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role") as "STUDENT" | "TEACHER" | null;
    const where = role ? { role } : {};
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true,
        grade: true, classNum: true, number: true,
        subject: true, homeroom: true, position: true,
        adminLevel: true,
        gender: true,
      },
      orderBy: [{ grade: "asc" }, { classNum: "asc" }, { number: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ users });
  });
}

export async function POST(request: Request) {
  return routeResponse(async () => {
    await requireActor("WRITE_ADMIN");

    const body = await request.json();

    if (body.role !== "STUDENT" && body.role !== "TEACHER") {
      return NextResponse.json(
        { error: "Bad Request", reason: "유효하지 않은 역할 값입니다." },
        { status: 400 }
      );
    }

    // gender 값 형식 검증
    if (
      body.gender !== undefined &&
      body.gender !== null &&
      body.gender !== "MALE" &&
      body.gender !== "FEMALE"
    ) {
      return NextResponse.json(
        { error: "Bad Request", reason: "유효하지 않은 성별 값입니다." },
        { status: 400 }
      );
    }

    // 학생은 성별 필수
    if (body.role === "STUDENT" && body.gender !== "MALE" && body.gender !== "FEMALE") {
      return NextResponse.json(
        { error: "Bad Request", reason: "학생은 성별을 선택해야 합니다." },
        { status: 400 }
      );
    }

    const user = await withCompatUserWrite(prisma, async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email, name: body.name, role: body.role,
          grade: body.grade || null, classNum: body.classNum || null, number: body.number || null,
          subject: body.subject || null, homeroom: body.homeroom || null, position: body.position || null,
          gender: body.gender ?? null,
        },
      });
      return { value: created, userIds: [created.id] };
    });

    return NextResponse.json({ user }, { status: 201 });
  });
}

export async function PUT(request: Request) {
  return routeResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const body = await request.json();

    // adminLevel 변경 요청 검증
    if (body.adminLevel !== undefined) {
      const allowed = ["NONE", "SUBADMIN", "ADMIN"] as const;
      if (!allowed.includes(body.adminLevel)) {
        return NextResponse.json(
          { error: "Bad Request", reason: "유효하지 않은 권한 값입니다." },
          { status: 400 }
        );
      }

      const target = await prisma.user.findUnique({
        where: { id: body.id },
        select: { id: true, role: true, adminLevel: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Bad Request", reason: "대상 사용자를 찾을 수 없습니다." },
          { status: 400 }
        );
      }

      if (target.role === "STUDENT" && body.adminLevel !== "NONE") {
        return NextResponse.json(
          { error: "Bad Request", reason: "학생에게는 관리자 권한을 부여할 수 없습니다." },
          { status: 400 }
        );
      }

      const callerDbUserId = actor.userId ?? 0;
      if (
        callerDbUserId !== 0 &&
        callerDbUserId === target.id &&
        target.adminLevel === "ADMIN" &&
        body.adminLevel !== "ADMIN"
      ) {
        return NextResponse.json(
          { error: "Bad Request", reason: "본인의 관리자 권한은 직접 변경할 수 없습니다." },
          { status: 400 }
        );
      }
    }

    // gender 값 형식 검증 (undefined = 변경 안 함)
    if (
      body.gender !== undefined &&
      body.gender !== null &&
      body.gender !== "MALE" &&
      body.gender !== "FEMALE"
    ) {
      return NextResponse.json(
        { error: "Bad Request", reason: "유효하지 않은 성별 값입니다." },
        { status: 400 }
      );
    }

    // 학생은 gender를 null로 되돌릴 수 없음
    if (body.gender === null) {
      const t = await prisma.user.findUnique({
        where: { id: body.id },
        select: { role: true },
      });
      if (t?.role === "STUDENT") {
        return NextResponse.json(
          { error: "Bad Request", reason: "학생의 성별은 비울 수 없습니다." },
          { status: 400 }
        );
      }
    }

    const user = await withCompatUserWrite(prisma, async (tx) => {
      const updated = await tx.user.update({
        where: { id: body.id },
        data: {
          email: body.email, name: body.name,
          grade: body.grade, classNum: body.classNum, number: body.number,
          subject: body.subject, homeroom: body.homeroom, position: body.position,
          ...(body.adminLevel !== undefined ? { adminLevel: body.adminLevel } : {}),
          ...(body.gender !== undefined ? { gender: body.gender } : {}),
        },
      });
      return { value: updated, userIds: [updated.id] };
    });

    return NextResponse.json({ user });
  });
}

/**
 * 물리 삭제는 Cascade로 신청·체크인 이력까지 지우므로 닫는다. 이용을 끊어야 하면
 * `PUT /api/admin/users/[id]/access`로 INACTIVE 처리한다.
 */
export async function DELETE(request: Request) {
  return routeResponse(async () => {
    await requireActor("WRITE_ADMIN");

    const { searchParams } = new URL(request.url);
    if (!searchParams.get("id")) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "Conflict",
        reason: "사용자는 삭제할 수 없습니다. 이용 중단으로 처리하세요.",
      },
      { status: 409 }
    );
  });
}
