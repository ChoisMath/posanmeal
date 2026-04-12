import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
  photoUrl: string | null;
  registrations?: Array<{
    id: number;
    createdAt: string;
    application: { id: number; title: string; type: string; mealStart: string | null; mealEnd: string | null };
  }>;
}

export function useUser() {
  const { data, error, isLoading, mutate } = useSWR("/api/users/me", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
  return {
    user: (data?.user ?? null) as UserProfile | null,
    error,
    isLoading,
    mutate,
  };
}
