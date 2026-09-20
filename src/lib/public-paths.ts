const PUBLIC_EXACT = new Set(["/", "/check", "/facecheck", "/admin/login"]);

const PUBLIC_PREFIXES = [
  "/help",
  "/api/auth",
  "/api/checkin",
  "/api/facecheck",
  "/api/uploads",
  "/api/system/settings",
  "/api/sync",
  "/api/meals",
  "/_next",
  "/uploads",
];

/**
 * 경로 경계에서만 접두사를 인정한다. bare startsWith는 `/api/checkins`처럼 이름이
 * 겹치는 보호 경로까지 공개로 흘려보낸다.
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
