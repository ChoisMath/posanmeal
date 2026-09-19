import { fetchWithSessionRecovery } from "./session-recovery";

export const fetcher = async (url: string) => {
  const res = await fetchWithSessionRecovery(url);
  if (!res.ok) {
    const error = new Error("API 요청 실패") as Error & { status?: number; info?: unknown };
    error.status = res.status;
    try {
      error.info = await res.json();
    } catch {}
    throw error;
  }
  return res.json();
};

/**
 * 응답 본문에서 사람이 읽을 메시지만 꺼낸다. 예전 경로는 `{error:"..."}`,
 * 학년도 경로는 `{error:{code,message}}`로 답하므로 화면은 둘을 구분하지 않는다.
 */
export function errorTextOf(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}
