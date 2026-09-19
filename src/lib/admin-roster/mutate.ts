import type { MutationReceipt } from "@/lib/academic-year/contracts";
import { errorTextOf } from "@/lib/fetcher";
import { fetchWithSessionRecovery } from "@/lib/session-recovery";

export type MutationFailure = {
  ok: false;
  status: number;
  code: string | null;
  message: string;
  /** 409는 최신 상태를 다시 읽어야 한다는 신호다. 화면은 절대 덮어쓰지 않는다. */
  conflict: boolean;
};

export type MutationSuccess<T> = { ok: true; data: T };

export type MutationResult<T> = MutationSuccess<T> | MutationFailure;

const CONFLICT_CODES = new Set(["VERSION_CONFLICT", "IDENTITY_CONFLICT", "REQUEST_REUSED"]);

export const CONFLICT_HINT =
  "다른 관리자가 먼저 바꿨습니다. 최신 내용을 다시 불러왔으니 확인하고 다시 시도하세요.";

function codeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<MutationResult<T>> {
  let res: Response;
  try {
    res = await fetchWithSessionRecovery(url, init);
  } catch {
    return {
      ok: false,
      status: 0,
      code: null,
      message: "네트워크 오류입니다. 연결을 확인하고 다시 시도하세요.",
      conflict: false,
    };
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = codeOf(body);
    const conflict = res.status === 409 || (code !== null && CONFLICT_CODES.has(code));
    return {
      ok: false,
      status: res.status,
      code,
      message: conflict ? CONFLICT_HINT : errorTextOf(body, fallbackMessage),
      conflict,
    };
  }

  return { ok: true, data: body as T };
}

export async function sendMutation(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  fallbackMessage: string,
): Promise<MutationResult<{ receipt: MutationReceipt }>> {
  return requestJson<{ receipt: MutationReceipt }>(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    fallbackMessage,
  );
}
