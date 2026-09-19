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
