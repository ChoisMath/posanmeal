import type { Actor } from "./contracts";
import type { Db } from "./db";
import { getReportProfiles, listYearMemberIds } from "./report-profile";
import { activeYear } from "./roster-service";

export type TeacherScope = { year: number; grade: number; classNum: number };

/** "1-3" 같은 학년-반 표기만 담당 학급으로 인정한다. "부담임", "1-0" 등은 범위가 없다. */
const HOMEROOM_PATTERN = /^[1-3]-[1-9][0-9]*$/;

/**
 * 담임 권한의 유일한 근거. 요청이 보낸 연도·학년·반은 보지 않고 운영 연도의
 * 재직 교사 기록에서만 담당 학급을 읽는다. 여기서 `null`이면 어떤 학급도 볼 수 없다.
 *
 * READY에서는 `User.homeroom`을 절대 보지 않는다 — 명부가 소유한 값이 유일한 근거다.
 * PREPARING에서는 `getReportProfiles`의 단일 `User` 대체 규칙을 그대로 물려받아
 * 초기 이전 전에도 기존 담임 화면이 끊기지 않는다(Release A 연속성).
 */
export async function getTeacherScope(db: Db, actor: Actor): Promise<TeacherScope | null> {
  if (actor.kind !== "USER") return null;

  const year = await activeYear(db);
  const report = (await getReportProfiles(db, [actor.userId], year, false)).get(actor.userId);
  const profile = report?.historical;
  if (!profile || profile.role !== "TEACHER" || profile.memberState !== "EMPLOYED") return null;

  const account = await db.user.findUnique({
    where: { id: actor.userId },
    select: { accessState: true },
  });
  if (account?.accessState !== "ACTIVE") return null;

  const homeroom = profile.homeroom;
  if (!homeroom || !HOMEROOM_PATTERN.test(homeroom)) return null;

  const [grade, classNum] = homeroom.split("-").map((part) => Number.parseInt(part, 10));
  return { year, grade, classNum };
}

/** 담당 학급의 그 해 재학생. 진급·전출한 옛 학생은 포함하지 않는다. */
export async function listScopeStudentIds(db: Db, scope: TeacherScope): Promise<number[]> {
  return listYearMemberIds(db, scope.year, {
    role: "STUDENT",
    grade: scope.grade,
    classNum: scope.classNum,
    enrolledOnly: true,
  });
}
