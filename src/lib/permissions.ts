import type { Session } from "next-auth";

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
