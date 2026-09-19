import { z } from "zod";
import type { Profile } from "./contracts";
import { DomainError } from "./errors";

/**
 * 같은 주소의 표기 차이(앞뒤 공백·대소문자)만 흡수한다. Gmail의 점·별칭처럼
 * 제공자별 규칙을 추측하면 서로 다른 사람을 한 사람으로 묶을 수 있으므로 하지 않는다.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 담임 표기. 학년은 1~3, 반은 선행 0 없는 양수. 빈 문자열은 담임 없음이다. */
const HOMEROOM_PATTERN = /^[1-3]-[1-9][0-9]*$/;

const nameField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0 && value.length <= 50, "이름을 확인하세요.");

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const homeroomField = optionalText.refine(
  (value) => value === null || HOMEROOM_PATTERN.test(value),
  "담임 학급은 1-1 형식으로 입력하세요.",
);

const genderField = z.union([z.literal("MALE"), z.literal("FEMALE"), z.null(), z.undefined()])
  .transform((value) => value ?? null);

const positiveInt = z.number().int().positive();

export const studentProfileSchema = z
  .object({
    role: z.literal("STUDENT"),
    name: nameField,
    grade: z.number().int().min(1).max(3),
    classNum: positiveInt,
    number: positiveInt,
    gender: z.union([z.literal("MALE"), z.literal("FEMALE")]),
  })
  .transform(
    (value): Profile => ({
      ...value,
      subject: null,
      homeroom: null,
      position: null,
    }),
  );

export const teacherProfileSchema = z
  .object({
    role: z.literal("TEACHER"),
    name: nameField,
    gender: genderField,
    subject: optionalText,
    homeroom: homeroomField,
    position: optionalText,
  })
  .transform(
    (value): Profile => ({
      ...value,
      grade: null,
      classNum: null,
      number: null,
    }),
  );

/**
 * 역할로 갈라 검사하고, 역할과 무관한 칸은 null로 정규화한다. 관리자 UI·Excel·
 * 초안이 모두 이 함수를 지나야 저장되는 Profile 모양이 하나로 유지된다.
 */
export function parseProfile(input: unknown): Profile {
  const role = (input as { role?: unknown } | null)?.role;
  const schema =
    role === "STUDENT" ? studentProfileSchema : role === "TEACHER" ? teacherProfileSchema : null;

  if (!schema) {
    throw new DomainError("MISSING_PROFILE", "역할은 학생 또는 교사여야 합니다.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DomainError(
      "MISSING_PROFILE",
      first?.message && !first.message.startsWith("Invalid")
        ? first.message
        : "입력값을 확인하세요. 학생은 1~3학년과 양의 정수 반·번호, 이름과 성별이 필요합니다.",
    );
  }
  return parsed.data;
}

export type ProfileIssue = { field: string; message: string };

/** 이미 Profile 모양인 값이 저장 규칙까지 만족하는지. 조회가 "보완 필요"를 표시할 때 쓴다. */
export function profileIssues(profile: Profile): ProfileIssue[] {
  const schema = profile.role === "STUDENT" ? studentProfileSchema : teacherProfileSchema;
  const parsed = schema.safeParse(profile);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    field: String(issue.path[0] ?? ""),
    message: issue.message,
  }));
}

function readInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 조회 전용의 너그러운 해석. 초안에는 아직 비어 있거나 잘못된 행이 남아 있을 수
 * 있고, 그 한 행 때문에 명부 전체가 열리지 않으면 관리자가 고칠 방법이 없다.
 * 값은 Profile 모양으로만 맞춰 돌려주고 무엇이 잘못됐는지는 `issues`로 알린다.
 * 저장은 언제나 엄격한 `parseProfile`을 지난다.
 */
export function coerceProfile(input: unknown): { profile: Profile; issues: ProfileIssue[] } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const role = raw.role === "TEACHER" ? "TEACHER" : "STUDENT";
  const gender = raw.gender === "MALE" || raw.gender === "FEMALE" ? raw.gender : null;

  const profile: Profile =
    role === "STUDENT"
      ? {
          role,
          name: readText(raw.name) ?? "",
          grade: readInt(raw.grade),
          classNum: readInt(raw.classNum),
          number: readInt(raw.number),
          gender,
          subject: null,
          homeroom: null,
          position: null,
        }
      : {
          role,
          name: readText(raw.name) ?? "",
          grade: null,
          classNum: null,
          number: null,
          gender,
          subject: readText(raw.subject),
          homeroom: readText(raw.homeroom),
          position: readText(raw.position),
        };

  const issues = profileIssues(profile);
  if (raw.role !== "STUDENT" && raw.role !== "TEACHER") {
    issues.unshift({ field: "role", message: "역할은 학생 또는 교사여야 합니다." });
  }
  return { profile, issues };
}
