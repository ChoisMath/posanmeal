import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export function useAdminApps() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/applications",
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    apps: data?.applications ?? [],
    error,
    isLoading,
    mutate,
  };
}
