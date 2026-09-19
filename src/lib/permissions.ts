import type { Session } from "next-auth";

// 토큰에 담긴 값만 보는 UI 표시·화면 이동용 판정이다. 서버 쓰기 허용의 근거로
// 쓰지 말 것 — 그 자리는 academic-year/access.ts의 assertActor가 맡는다.

export type EffectiveLevel = "NONE" | "SUBADMIN" | "ADMIN";

export function getEffectiveAdminLevel(
  session: Session | null
): EffectiveLevel {
  if (!session?.user) return "NONE";
  if (session.user.role === "ADMIN") return "ADMIN";
  return (session.user.adminLevel ?? "NONE") as EffectiveLevel;
}

export function canWriteAdmin(session: Session | null): boolean {
  return getEffectiveAdminLevel(session) === "ADMIN";
}

export function canReadAdmin(session: Session | null): boolean {
  const lvl = getEffectiveAdminLevel(session);
  return lvl === "ADMIN" || lvl === "SUBADMIN";
}
