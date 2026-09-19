export type YearState = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ImportScope = "PARTIAL" | "FULL";
export type MemberState = "ENROLLED" | "EMPLOYED" | "GRADUATED" | "TRANSFERRED" | "RETIRED";

export type Actor =
  | { kind: "MAIN"; userId: null; sessionVersion: null }
  | { kind: "USER"; userId: number; sessionVersion: number };

export type Profile = {
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  gender: "MALE" | "FEMALE" | null;
  subject: string | null;
  homeroom: string | null;
  position: string | null;
};

export type AcademicProfile = Profile & {
  year: number;
  userId: number;
  memberState: MemberState;
  version: number;
  needsReview: boolean;
};

export type RosterRow = {
  entryId: string;
  userId: number | null;
  email: string;
  emailKey: string;
  profile: Profile;
  baseUserVersion: number | null;
  included: boolean;
};

export type RowIssue = { sheet: "학생" | "교사"; row: number; column: string; code: string; message: string };

export type RowChange = {
  kind: "NEW" | "SAME" | "CHANGED" | "REVIEW" | "CONFLICT";
  token: string;
  input: RosterRow;
  before: Profile | null;
  issues: RowIssue[];
  // CONFLICT: 내보낸 뒤 서버 값이 바뀐 행. server는 현재 서버 값, resolution은 관리자가 고른 뒤 채워진다.
  server?: Profile;
  resolution?: "USE_FILE" | "KEEP_SERVER";
};

export type ImportPreview = {
  id: string;
  year: number;
  controlVersion: number;
  yearVersion: number;
  scope: ImportScope;
  rows: RowChange[];
  missingUserIds: number[];
  coveredRoles: Array<"STUDENT" | "TEACHER">;
  canCommit: boolean;
  /** 어떤 행에도 붙일 수 없는 파일 수준 이슈(값을 읽지 못한 셀 등). 있으면 확정하지 않는다. */
  fileIssues?: RowIssue[];
};

export type MutationReceipt = { requestId: string; version: number; changed: number };

/** 사용자 행 단위 변경(셀 편집·이메일·이용 상태·권한). expectedRowVersion은 대상 행의 버전이다. */
export type RowMutationInput = {
  actor: Actor;
  requestId: string;
  userId: number;
  expectedRowVersion: number;
  kind: string;
  payloadHash: string;
};

export type MutationSummary = { changed: number; ids: Array<number | string> };

export type MutationInput = {
  actor: Actor;
  requestId: string;
  expectedVersion: number;
  kind: string;
  payloadHash: string;
};

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ACCOUNT_INACTIVE"
  | "STALE_SESSION"
  | "NOT_READY"
  | "VERSION_CONFLICT"
  | "REQUEST_REUSED"
  | "INVALID_FILE"
  | "IDENTITY_CONFLICT"
  | "REVIEW_REQUIRED"
  | "YEAR_MISMATCH"
  | "MISSING_PROFILE"
  /** 요청 본문·입력값 자체가 규칙에 맞지 않는다. 대상이 없다는 뜻의 MISSING_PROFILE과 구분한다. */
  | "INVALID_INPUT"
  /** 지정한 대상 자체가 없다. 값을 더 채우면 되는 MISSING_PROFILE과 달리 보완할 수 없다. */
  | "NOT_FOUND";
