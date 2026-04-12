import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export function useAdminUsers() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/users",
    fetcher,
    { revalidateOnFocus: false }
  );
  return {
    users: data?.users ?? [],
    error,
    isLoading,
    mutate,
  };
}
