import type { Profile } from "@/lib/academic-year/contracts";

export type ProfileField = "name" | "grade" | "classNum" | "number" | "gender" | "subject" | "homeroom" | "position";

export function rosterProfileWith(profile: Profile, field: ProfileField, next: string): Profile {
  const updated = { ...profile };
  if (field === "grade" || field === "classNum" || field === "number") {
    updated[field] = Number.parseInt(next.trim(), 10);
  } else if (field === "gender") {
    updated.gender = next === "" ? null : (next as Profile["gender"]);
  } else if (field === "name") {
    updated.name = next.trim();
  } else {
    updated[field] = next.trim() === "" ? null : next.trim();
  }
  return updated;
}
