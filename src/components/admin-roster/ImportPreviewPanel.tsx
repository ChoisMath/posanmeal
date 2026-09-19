"use client";

import { Button } from "@/components/ui/button";
import type { ImportPreview, RowChange } from "@/lib/academic-year/contracts";
import {
  ROW_KIND_LABEL,
  ROW_KIND_ORDER,
  clearedFields,
  countByKind,
  countByRole,
  rowIssueText,
} from "@/lib/admin-roster/labels";
import type { OmittedPerson } from "@/lib/admin-roster/omissions";

export type ImportPreviewPanelProps = {
  preview: ImportPreview;
  confirmedTokens: string[];
  omissions: OmittedPerson[];
  omissionsConfirmed: boolean;
  resolving: boolean;
  onToggleNew: (token: string) => void;
  onConfirmAllNew: () => void;
  onResolve: (token: string, resolution: "USE_FILE" | "KEEP_SERVER") => void;
  onToggleOmissions: (next: boolean) => void;
};

const CARD = "rounded-xl border p-2";

function profileSummary(row: RowChange, source: "file" | "server"): string {
  const profile = source === "file" ? row.input.profile : row.server;
  if (!profile) return "—";
  const parts =
    profile.role === "STUDENT"
      ? [profile.name, profile.grade, profile.classNum, profile.number, profile.gender]
      : [profile.name, profile.subject, profile.homeroom, profile.position];
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
}

export function ImportPreviewPanel({
  preview,
  confirmedTokens,
  omissions,
  omissionsConfirmed,
  resolving,
  onToggleNew,
  onConfirmAllNew,
  onResolve,
  onToggleOmissions,
}: ImportPreviewPanelProps) {
  const kinds = countByKind(preview);
  const roles = countByRole(preview);
  const confirmed = new Set(confirmedTokens);
  const newRows = preview.rows.filter((row) => row.kind === "NEW");
  const conflicts = preview.rows.filter((row) => row.kind === "CONFLICT");
  const issueRows = preview.rows.filter((row) => row.issues.length > 0);
  const clearing = preview.rows
    .map((row) => ({ row, fields: clearedFields(row) }))
    .filter((entry) => entry.fields.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {ROW_KIND_ORDER.map((kind) => (
          <span key={kind} className={`${CARD} whitespace-nowrap`}>
            {ROW_KIND_LABEL[kind]} {kinds[kind]}
          </span>
        ))}
        <span className={`${CARD} whitespace-nowrap`}>학생 {roles.STUDENT}</span>
        <span className={`${CARD} whitespace-nowrap`}>교사 {roles.TEACHER}</span>
      </div>

      {preview.fileIssues && preview.fileIssues.length > 0 && (
        <section className={CARD}>
          <h4 className="font-semibold whitespace-nowrap mb-1">파일에서 읽지 못한 부분</h4>
          <ul className="text-sm text-amber-700 flex flex-col gap-1">
            {preview.fileIssues.map((issue, index) => (
              <li key={`${issue.sheet}-${issue.row}-${index}`} className="break-keep">
                {issue.sheet} 시트 {issue.row}행 {issue.column} — {rowIssueText(issue.code, issue.message)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {issueRows.length > 0 && (
        <section className={CARD}>
          <h4 className="font-semibold whitespace-nowrap mb-1">고쳐야 할 행</h4>
          <ul className="text-sm text-amber-700 flex flex-col gap-1">
            {issueRows.flatMap((row) =>
              row.issues.map((issue, index) => (
                <li key={`${row.token}-${index}`} className="break-keep">
                  {issue.sheet} 시트 {issue.row}행 {issue.column} — {rowIssueText(issue.code, issue.message)}
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      {clearing.length > 0 && (
        <section className={CARD}>
          <h4 className="font-semibold whitespace-nowrap mb-1">값이 비워지는 항목</h4>
          <ul className="text-sm flex flex-col gap-1">
            {clearing.map(({ row, fields }) => (
              <li key={row.token} className="break-keep">
                {row.input.profile.name} — {fields.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {newRows.length > 0 && (
        <section className={CARD}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold whitespace-nowrap">새로 들어오는 사람</h4>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 whitespace-nowrap"
              onClick={onConfirmAllNew}
            >
              모두 확인
            </Button>
          </div>
          <ul className="text-sm flex flex-col gap-1">
            {newRows.map((row) => (
              <li key={row.token}>
                <label className="flex items-start gap-2 break-keep">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0"
                    checked={confirmed.has(row.token)}
                    onChange={() => onToggleNew(row.token)}
                  />
                  <span>
                    {profileSummary(row, "file")} · {row.input.email}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conflicts.length > 0 && (
        <section className={CARD}>
          <h4 className="font-semibold whitespace-nowrap mb-1">내보낸 뒤 서버에서 바뀐 행</h4>
          <p className="text-sm text-muted-foreground break-keep mb-2">
            이전에 명부에서 뺀 사람을 [서버 값 유지]로 두면 계속 제외 상태로 남습니다.
          </p>
          <div className="flex flex-col gap-2">
            {conflicts.map((row) => (
              <div key={row.token} className="rounded-lg border p-2 text-sm">
                <p className="whitespace-nowrap overflow-hidden text-ellipsis" title={row.input.email}>
                  {row.input.email}
                </p>
                <p className="break-keep">파일 값: {profileSummary(row, "file")}</p>
                <p className="break-keep">서버 값: {profileSummary(row, "server")}</p>
                <div className="flex gap-2 mt-1">
                  <Button
                    size="sm"
                    variant={row.resolution === "USE_FILE" ? "default" : "outline"}
                    className="min-h-11 whitespace-nowrap"
                    disabled={resolving}
                    onClick={() => onResolve(row.token, "USE_FILE")}
                  >
                    파일 값 사용
                  </Button>
                  <Button
                    size="sm"
                    variant={row.resolution === "KEEP_SERVER" ? "default" : "outline"}
                    className="min-h-11 whitespace-nowrap"
                    disabled={resolving}
                    onClick={() => onResolve(row.token, "KEEP_SERVER")}
                  >
                    서버 값 유지
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {preview.scope === "FULL" && omissions.length > 0 && (
        <section className={CARD}>
          <h4 className="font-semibold whitespace-nowrap mb-1">파일에 없는 사람 {omissions.length}명</h4>
          <p className="text-sm text-muted-foreground break-keep mb-2">
            확인하지 않으면 파일에 있는 행만 반영하고, 아래 사람들은 보고만 합니다.
          </p>
          <ul className="text-sm flex flex-col gap-1 mb-2">
            {omissions.map((person) => (
              <li key={person.userId} className="whitespace-nowrap">
                {person.name}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm break-keep">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0"
              checked={omissionsConfirmed}
              onChange={(event) => onToggleOmissions(event.target.checked)}
            />
            <span>위 사람들이 파일에서 빠진 것이 맞습니다. 전체 대조 결과를 그대로 반영합니다.</span>
          </label>
        </section>
      )}
    </div>
  );
}
