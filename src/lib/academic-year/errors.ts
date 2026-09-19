import type { DomainErrorCode } from "./contracts";

/** 어느 줄이 문제인지만 알린다. 이름·이메일·학번 같은 원본 값은 담지 않는다. */
export type DomainErrorIssue = { row: number; code: string };

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly issues?: DomainErrorIssue[];

  constructor(code: DomainErrorCode, message?: string, issues?: DomainErrorIssue[]) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
    if (issues && issues.length > 0) this.issues = issues;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
