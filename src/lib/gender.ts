export type Gender = "MALE" | "FEMALE";
export type NormalizeResult = Gender | null | "INVALID";

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "남",
  FEMALE: "여",
};

export function genderLabel(g: Gender | null | undefined): string {
  return g ? GENDER_LABEL[g] : "—";
}

export function normalizeGender(raw: string | null | undefined): NormalizeResult {
  if (raw == null) return null;
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (["남", "M", "MALE", "BOY"].includes(v)) return "MALE";
  if (["여", "F", "FEMALE", "GIRL"].includes(v)) return "FEMALE";
  return "INVALID";
}
