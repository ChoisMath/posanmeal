export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error("API 요청 실패");
    (error as any).status = res.status;
    try {
      (error as any).info = await res.json();
    } catch {}
    throw error;
  }
  return res.json();
};
