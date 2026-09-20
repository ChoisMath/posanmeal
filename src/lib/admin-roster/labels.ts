import type { ImportPreview, Profile, RowChange, YearState } from "@/lib/academic-year/contracts";

export function canAddRosterUser(
  canWrite: boolean,
  notReady: boolean,
  selectedYear: number | null,
  activeYear: number | null,
): boolean {
  return canWrite && (notReady || (selectedYear !== null && selectedYear === activeYear));
}

export const YEAR_STATE_LABEL: Record<YearState, string> = {
  ACTIVE: "운영 중",
  DRAFT: "준비 중",
  ARCHIVED: "지난 학년도",
};

export const ROW_KIND_LABEL: Record<RowChange["kind"], string> = {
  NEW: "신규",
  SAME: "동일",
  CHANGED: "변경",
  REVIEW: "확인 필요",
  CONFLICT: "충돌",
};

export const ROW_KIND_ORDER: RowChange["kind"][] = [
  "NEW",
  "CHANGED",
  "REVIEW",
  "CONFLICT",
  "SAME",
];

export type DeactivateReason = { value: string; label: string };

/**
 * 서버(`account-service`)가 받는 사유만 보여 준다. 학생에게 '퇴직'을, 교사에게
 * '졸업'을 내밀면 누르는 순간 422로 떨어진다.
 */
export function deactivateReasons(role: Profile["role"]): DeactivateReason[] {
  return role === "STUDENT"
    ? [
        { value: "GRADUATED", label: "졸업" },
        { value: "TRANSFERRED", label: "전출" },
      ]
    : [
        { value: "TRANSFERRED", label: "전출" },
        { value: "RETIRED", label: "퇴직" },
      ];
}

export const ADMIN_LEVEL_LABEL: Record<"NONE" | "SUBADMIN" | "ADMIN", string> = {
  NONE: "일반",
  SUBADMIN: "서브관리자",
  ADMIN: "관리자",
};

const ROW_ISSUE_TEXT: Record<string, string> = {
  REQUIRED: "필수 값이 비어 있습니다.",
  MISSING_PROFILE: "필수 값이 비어 있습니다.",
  INVALID_EMAIL: "이메일 형식이 올바르지 않습니다.",
  INVALID_NUMBER: "1 이상의 정수여야 합니다.",
  INVALID_GENDER: "성별은 남 또는 여여야 합니다.",
  INVALID_ROLE: "역할 값을 확인하세요.",
  DUPLICATE_EMAIL: "같은 파일 안에 이메일이 두 번 있습니다.",
  DUPLICATE_ROSTER_MATCH: "이미 명부에 있는 사람과 겹칩니다.",
  ROLE_MISMATCH: "이미 등록된 역할과 다릅니다.",
  UNKNOWN_COLUMN: "양식에 없는 열입니다.",
};

/**
 * 코드에 우리말이 있으면 그 문장을, 없으면 서버가 준 메시지를 그대로 쓴다.
 * 모르는 코드라고 빈칸을 보여 주면 관리자가 무엇을 고쳐야 할지 알 수 없다.
 */
export function rowIssueText(code: string, serverMessage: string): string {
  return ROW_ISSUE_TEXT[code] ?? (serverMessage.trim() || code);
}

export function countByKind(preview: ImportPreview): Record<RowChange["kind"], number> {
  const counts: Record<RowChange["kind"], number> = {
    NEW: 0,
    SAME: 0,
    CHANGED: 0,
    REVIEW: 0,
    CONFLICT: 0,
  };
  for (const row of preview.rows) counts[row.kind] += 1;
  return counts;
}

export function countByRole(preview: ImportPreview): { STUDENT: number; TEACHER: number } {
  const counts = { STUDENT: 0, TEACHER: 0 };
  for (const row of preview.rows) counts[row.input.profile.role] += 1;
  return counts;
}

const PROFILE_FIELD_LABEL: Record<string, string> = {
  name: "이름",
  grade: "학년",
  classNum: "반",
  number: "번호",
  gender: "성별",
  subject: "교과명",
  homeroom: "담임",
  position: "직책",
};

/** 파일이 빈칸이라 저장된 값을 지우게 되는 열. 관리자가 모르고 지우는 일을 막는다. */
export function clearedFields(row: RowChange): string[] {
  if (row.before === null) return [];
  const before = row.before as Record<string, unknown>;
  const next = row.input.profile as unknown as Record<string, unknown>;

  return Object.keys(PROFILE_FIELD_LABEL)
    .filter((field) => {
      const had = before[field] !== null && before[field] !== undefined && before[field] !== "";
      const cleared = next[field] === null || next[field] === undefined || next[field] === "";
      return had && cleared;
    })
    .map((field) => PROFILE_FIELD_LABEL[field]);
}

export function filterRosterByGrade<T extends { profile: { grade: number | null } }>(rows: T[], grade: number | null): T[] {
  return grade === null ? rows : rows.filter((row) => row.profile.grade === grade);
}
