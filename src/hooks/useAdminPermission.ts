"use client";
import { useSession } from "next-auth/react";

export function useAdminPermission() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const adminLevel = (session?.user?.adminLevel ?? "NONE") as
    | "NONE" | "SUBADMIN" | "ADMIN";

  const isEnvAdmin = role === "ADMIN";
  const isTeacherAdmin = role === "TEACHER" && adminLevel === "ADMIN";
  const isSubadmin = role === "TEACHER" && adminLevel === "SUBADMIN";

  return {
    canWrite: isEnvAdmin || isTeacherAdmin,
    canRead: isEnvAdmin || isTeacherAdmin || isSubadmin,
    isSubadmin,
    isTeacher: role === "TEACHER",
    isEnvAdmin,
    displayName: session?.user?.name ?? "",
    badgeLabel: isEnvAdmin
      ? "최고관리자"
      : isTeacherAdmin
      ? "관리자"
      : isSubadmin
      ? "서브관리자"
      : "",
    dbUserId: session?.user?.dbUserId ?? 0,
  };
}
