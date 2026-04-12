import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export function useSystemSettings() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/system/settings",
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    settings: data ?? null,
    error,
    isLoading,
    mutate,
  };
}
