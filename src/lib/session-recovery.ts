import { signOut } from "next-auth/react";

export type RecoveryAction = "NONE" | "SIGN_OUT_HOME" | "SIGN_OUT_ADMIN";

/** 보호된 API가 401로 돌려주는 코드. 셋 다 "다시 로그인"이 유일한 복구 수단이다. */
const SIGNED_OUT_CODES = new Set(["STALE_SESSION", "ACCOUNT_INACTIVE", "UNAUTHENTICATED"]);

/** 로그인 자체가 없는 공개 키오스크. 세션 상태로 화면을 옮기지 않는다. */
const KIOSK_PREFIXES = ["/check", "/facecheck"];

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

export function sessionRecoveryAction(status: number, body: unknown, pathname: string): RecoveryAction {
  if (status !== 401) return "NONE";
  const code = errorCode(body);
  if (code === null || !SIGNED_OUT_CODES.has(code)) return "NONE";
  if (KIOSK_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return "NONE";
  }
  return pathname.startsWith("/admin") ? "SIGN_OUT_ADMIN" : "SIGN_OUT_HOME";
}

// 실패한 요청이 여러 개면 판정도 여러 번 나오므로, 첫 번째만 화면을 옮긴다.
let recovering = false;

export function recoverSession(status: number, body: unknown): void {
  if (recovering || typeof window === "undefined") return;

  const action = sessionRecoveryAction(status, body, window.location.pathname);
  if (action === "NONE") return;

  recovering = true;
  const target = action === "SIGN_OUT_ADMIN" ? "/admin/login" : "/";
  // signOut이 실패해도 한 번 플래그가 서므로, 실패하면 직접 옮겨 화면에 가둬 두지 않는다.
  void signOut({ callbackUrl: target }).catch(() => {
    window.location.href = target;
  });
}

/**
 * 로그인이 필요한 화면의 모든 fetch가 지나가는 자리. 응답은 그대로 돌려주고
 * 만료된 세션일 때만 로그인 화면으로 보낸다.
 */
export async function fetchWithSessionRecovery(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = await res.clone().json().catch(() => null);
    recoverSession(res.status, body);
  }
  return res;
}
