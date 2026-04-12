import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export function useAdminDashboard(date?: string) {
  const key = date
    ? `/api/admin/dashboard?date=${date}`
    : "/api/admin/dashboard";
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 30000,
  });
  return {
    dashboard: data ?? null,
    error,
    isLoading,
    mutate,
  };
}
