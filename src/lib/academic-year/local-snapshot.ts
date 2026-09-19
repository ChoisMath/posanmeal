/**
 * 키오스크(브라우저)에서 쓰는 명부 근거 판정. 서버 모듈을 절대 import하지 않는다 —
 * `kiosk-snapshot.ts`의 타입과 모양은 같지만 그쪽은 Prisma를 끌고 온다.
 */

export type SnapshotUser = {
  userId: number;
  role: "STUDENT" | "TEACHER";
  accessState: "ACTIVE";
  accessEventId: number;
};

export type SnapshotEligible = {
  userId: number;
  applicationId: number;
  registrationId: number;
  date: string;
  mealKind: string;
};

export type SnapshotProfile = {
  userId: number;
  year: number;
  role: "STUDENT" | "TEACHER";
  name: string;
  grade: number | null;
  classNum: number | null;
  number: number | null;
  memberState: "ENROLLED" | "EMPLOYED" | "GRADUATED" | "TRANSFERRED" | "RETIRED";
};

export type SnapshotEvidence = {
  id: string;
  version: number;
  lastEligibilityEventId: number;
  activeYear: number;
  issuedAt: string;
  freshUntil: string;
  coversUntil: string;
  users: SnapshotUser[];
  eligible: SnapshotEligible[];
  profiles: SnapshotProfile[];
};

export type SnapshotFreshness = "FRESH" | "STALE";

export type LocalSnapshotErrorCode = "NO_SNAPSHOT" | "YEAR_MISMATCH" | "BEYOND_COVERAGE" | "USER_NOT_IN_SNAPSHOT";

export class LocalSnapshotError extends Error {
  readonly code: LocalSnapshotErrorCode;
  constructor(code: LocalSnapshotErrorCode, message: string) {
    super(message);
    this.name = "LocalSnapshotError";
    this.code = code;
  }
}

/**
 * 기기의 명부 상태. `snapshotMode`는 마지막으로 성공한 다운로드가 근거를 실어 왔는지다.
 * 서버가 PREPARING이면 근거를 주지 않으므로 false로 남고, 그때는 유효기간 판정을 하지 않는다.
 */
export type LocalSnapshotState = {
  snapshotMode: boolean;
  snapshot: SnapshotEvidence | null;
  serverActiveYear: number | null;
};

export const LEGACY_SNAPSHOT_STATE: LocalSnapshotState = {
  snapshotMode: false,
  snapshot: null,
  serverActiveYear: null,
};

export type LocalSnapshotInput = {
  now: Date;
  userId: number;
  dateKey: string;
  serverActiveYear: number | null;
};

/** 근거 기반 판정을 적용할 기기인가. 아니면 배포 이전과 똑같이 동작해야 한다. */
export function isSnapshotMode(state: LocalSnapshotState): boolean {
  return state.snapshotMode;
}

export function checkLocalSnapshot(
  snapshot: SnapshotEvidence | null,
  input: LocalSnapshotInput,
): SnapshotFreshness {
  if (!snapshot) {
    throw new LocalSnapshotError("NO_SNAPSHOT", "명부 근거가 없습니다. 동기화가 필요합니다");
  }
  if (input.serverActiveYear !== null && input.serverActiveYear !== snapshot.activeYear) {
    throw new LocalSnapshotError("YEAR_MISMATCH", "학년도 전환 후 동기화가 필요합니다");
  }
  if (input.dateKey > snapshot.coversUntil) {
    throw new LocalSnapshotError("BEYOND_COVERAGE", "내려받은 명부의 사용 기간이 지났습니다. 동기화가 필요합니다");
  }
  if (!snapshot.users.some((user) => user.userId === input.userId)) {
    throw new LocalSnapshotError("USER_NOT_IN_SNAPSHOT", "명단에 없는 사용자입니다. 동기화가 필요합니다");
  }
  return input.now.getTime() >= Date.parse(snapshot.freshUntil) ? "STALE" : "FRESH";
}

/**
 * 체크인 직전 한 자리 판정. 근거 모드가 아니면 null(판정 없음)이고, 근거 모드면
 * FRESH/STALE을 돌려주거나 저장을 막기 위해 던진다.
 */
export function guardLocalCheckIn(
  state: LocalSnapshotState,
  input: { now: Date; userId: number; dateKey: string },
): SnapshotFreshness | null {
  if (!isSnapshotMode(state)) return null;
  return checkLocalSnapshot(state.snapshot, { ...input, serverActiveYear: state.serverActiveYear });
}
