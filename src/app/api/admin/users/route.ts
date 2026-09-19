import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { domainErrorStatus, payloadHash, routeResponse } from "@/lib/academic-year/api";
import type { Profile } from "@/lib/academic-year/contracts";
import { isDomainError } from "@/lib/academic-year/errors";
import { parseProfile } from "@/lib/academic-year/profile-schema";
import { requireActor } from "@/lib/academic-year/request-actor";
import {
  activeYear,
  listRosterView,
  upsertRosterProfile,
  userIdsWithoutRecord,
} from "@/lib/academic-year/roster-service";

/**
 * 이 경로는 아직 버전을 보내지 않는 관리자 화면이 쓰는 옛 계약이다. 새 학년도
 * API와 달리 PREPARING 중에도 열려 있어야 하므로 `requireAcademicReady`를 걸지
 * 않는다. 실패 응답은 화면이 읽는 `reason` 모양을 유지한다.
 */
function legacyError(reason: string, status = 400): NextResponse {
  return NextResponse.json({ error: status === 409 ? "Conflict" : "Bad Request", reason }, { status });
}

async function legacyResponse(run: () => Promise<NextResponse>): Promise<NextResponse> {
  return routeResponse(async () => {
    try {
      return await run();
    } catch (error) {
      if (!isDomainError(error)) throw error;
      return legacyError(error.message, domainErrorStatus(error.code));
    }
  });
}

async function targetYear(request: Request): Promise<number> {
  const raw = new URL(request.url).searchParams.get("academicYear");
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : activeYear(prisma);
}

export async function GET(request: Request) {
  return legacyResponse(async () => {
    await requireActor("READ_ADMIN");

    const role = new URL(request.url).searchParams.get("role");
    const year = await targetYear(request);
    const rows = await listRosterView(
      prisma,
      year,
      role === "STUDENT" || role === "TEACHER" ? role : undefined,
    );

    const users = rows.map((row) => ({
      id: row.userId,
      email: row.email,
      name: row.profile.name,
      role: row.profile.role,
      grade: row.profile.grade,
      classNum: row.profile.classNum,
      number: row.profile.number,
      subject: row.profile.subject,
      homeroom: row.profile.homeroom,
      position: row.profile.position,
      gender: row.profile.gender,
      adminLevel: row.adminLevel,
      accessState: row.accessState,
      version: row.version,
      needsReview: row.needsReview,
    }));

    return NextResponse.json({
      users,
      academicYear: year,
      missingProfileUserIds: await userIdsWithoutRecord(prisma, year),
    });
  });
}

export async function POST(request: Request) {
  return legacyResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const body = await request.json();
    if (body.role !== "STUDENT" && body.role !== "TEACHER") {
      return legacyError("유효하지 않은 역할 값입니다.");
    }
    const genderIssue = checkGender(body.gender, body.role, true);
    if (genderIssue) return legacyError(genderIssue);

    const year = await targetYear(request);
    const profile = parseProfile({
      role: body.role,
      name: body.name,
      grade: body.grade,
      classNum: body.classNum,
      number: body.number,
      gender: body.gender ?? null,
      subject: body.subject,
      homeroom: body.homeroom,
      position: body.position,
    });
    const email = String(body.email ?? "").trim();

    const control = await prisma.rosterControl.findUniqueOrThrow({ where: { id: 1 } });
    await upsertRosterProfile(prisma, {
      actor,
      requestId: randomUUID(),
      expectedRowVersion: 0,
      expectedVersion: control.version,
      kind: "ROSTER_ROW",
      payloadHash: payloadHash({ year, email, profile }),
      year,
      email,
      profile,
    });

    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    return NextResponse.json({ user }, { status: 201 });
  });
}

export async function PUT(request: Request) {
  return legacyResponse(async () => {
    const actor = await requireActor("WRITE_ADMIN");

    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return legacyError("대상 사용자를 찾을 수 없습니다.");
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return legacyError("대상 사용자를 찾을 수 없습니다.");
    }

    if (body.adminLevel !== undefined) {
      const issue = checkAdminLevel(body.adminLevel, target, actor.userId ?? 0);
      if (issue) return legacyError(issue);
      await prisma.user.update({ where: { id }, data: { adminLevel: body.adminLevel } });
    }

    const genderIssue = checkGender(body.gender, target.role, false);
    if (genderIssue) return legacyError(genderIssue);

    if (touchesProfile(body)) {
      const year = await targetYear(request);
      const base = await baseProfile(id, year, target);
      const profile = parseProfile(mergeProfile(base, body));
      const email = String(body.email ?? target.email).trim();

      await upsertRosterProfile(prisma, {
        actor,
        requestId: randomUUID(),
        expectedRowVersion: await rowVersionFor(id, year, body.expectedRowVersion),
        expectedVersion: 0,
        kind: "ROSTER_ROW",
        payloadHash: payloadHash({ year, userId: id, email, profile }),
        year,
        userId: id,
        email,
        profile,
      });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
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

    return legacyError("사용자는 삭제할 수 없습니다. 이용 중단으로 처리하세요.", 409);
  });
}

const PROFILE_KEYS = [
  "email",
  "name",
  "grade",
  "classNum",
  "number",
  "subject",
  "homeroom",
  "position",
  "gender",
] as const;

function touchesProfile(body: Record<string, unknown>): boolean {
  return PROFILE_KEYS.some((key) => body[key] !== undefined);
}

type UserRow = {
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
};

/**
 * 부분 수정을 저장된 값 위에 얹는다. 그 학년도 기록이 아직 없으면(초기 이전 전)
 * `User` 행이 유일한 출발점이라 그것을 쓴다 — 새 학년도 API는 이 폴백을 쓰지 않는다.
 */
async function baseProfile(userId: number, year: number, user: UserRow): Promise<Profile> {
  const record = await prisma.userAcademicRecord.findUnique({
    where: { year_userId: { year, userId } },
    select: {
      role: true,
      name: true,
      grade: true,
      classNum: true,
      number: true,
      gender: true,
      subject: true,
      homeroom: true,
      position: true,
    },
  });
  return record ?? user;
}

function mergeProfile(base: Profile, body: Record<string, unknown>): Profile {
  const pick = <K extends keyof Profile>(key: K): Profile[K] =>
    body[key] === undefined ? base[key] : (body[key] as Profile[K]);

  return {
    role: base.role,
    name: pick("name"),
    grade: pick("grade"),
    classNum: pick("classNum"),
    number: pick("number"),
    gender: pick("gender"),
    subject: pick("subject"),
    homeroom: pick("homeroom"),
    position: pick("position"),
  };
}

/** 아직 버전을 보내지 않는 옛 화면은 마지막 쓰기가 이긴다. 새 명부 화면은 항상 보낸다. */
async function rowVersionFor(
  userId: number,
  year: number,
  supplied: unknown,
): Promise<number> {
  if (typeof supplied === "number" && Number.isInteger(supplied)) return supplied;
  const record = await prisma.userAcademicRecord.findUnique({
    where: { year_userId: { year, userId } },
    select: { version: true },
  });
  return record?.version ?? 0;
}

function checkGender(
  gender: unknown,
  role: "STUDENT" | "TEACHER",
  required: boolean,
): string | null {
  if (gender !== undefined && gender !== null && gender !== "MALE" && gender !== "FEMALE") {
    return "유효하지 않은 성별 값입니다.";
  }
  if (role !== "STUDENT") return null;
  if (required && gender !== "MALE" && gender !== "FEMALE") {
    return "학생은 성별을 선택해야 합니다.";
  }
  if (!required && gender === null) {
    return "학생의 성별은 비울 수 없습니다.";
  }
  return null;
}

function checkAdminLevel(
  level: unknown,
  target: { id: number; role: string; adminLevel: string },
  callerUserId: number,
): string | null {
  if (level !== "NONE" && level !== "SUBADMIN" && level !== "ADMIN") {
    return "유효하지 않은 권한 값입니다.";
  }
  if (target.role === "STUDENT" && level !== "NONE") {
    return "학생에게는 관리자 권한을 부여할 수 없습니다.";
  }
  if (callerUserId !== 0 && callerUserId === target.id && target.adminLevel === "ADMIN" && level !== "ADMIN") {
    return "본인의 관리자 권한은 직접 변경할 수 없습니다.";
  }
  return null;
}
