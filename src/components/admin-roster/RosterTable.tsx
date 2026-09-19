"use client";

import { Button } from "@/components/ui/button";
import { EditableSelectCell, EditableTextCell, type SaveResult } from "@/components/EditableCell";
import type { LegacyAdminUser, RosterViewRow } from "@/hooks/useAcademicRoster";

export type RosterField =
  | "name"
  | "grade"
  | "classNum"
  | "number"
  | "gender"
  | "subject"
  | "homeroom"
  | "position";

export type RosterTableProps = {
  rows: RosterViewRow[];
  role: "STUDENT" | "TEACHER";
  accounts: Map<number, LegacyAdminUser>;
  canWrite: boolean;
  isMain: boolean;
  /** 지난 학년도는 보존된 기록만 고친다. 계정 조작은 열지 않는다. */
  recordOnly: boolean;
  onSaveField: (row: RosterViewRow, field: RosterField, next: string) => Promise<SaveResult>;
  onEditEmail: (row: RosterViewRow) => void;
  onEditAccess: (row: RosterViewRow) => void;
  onEditPermissions: (row: RosterViewRow) => void;
};

const HEAD = "p-2 text-left bg-muted whitespace-nowrap sticky top-0 z-[2]";
const HEAD_FIRST = "p-2 text-left bg-muted whitespace-nowrap sticky top-0 left-0 z-[4]";
const CELL_FIRST = "p-1 align-middle whitespace-nowrap sticky left-0 z-[3] bg-card";

function positiveInteger(label: string) {
  return (value: string): string | null => {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) && Number.parseInt(trimmed, 10) >= 1
      ? null
      : `${label}은(는) 1 이상 정수여야 합니다.`;
  };
}

function RowStatus({ row }: { row: RosterViewRow }) {
  const notes: string[] = [];
  if (row.incomplete) {
    notes.push(...row.issues.map((issue) => `${issue.field}: ${issue.message}`));
  }
  if (row.needsReview && !row.incomplete) notes.push("확인 필요");
  if (row.accessState === "INACTIVE") notes.push("이용 중단");
  if (!row.included) notes.push("명부 제외");

  if (notes.length === 0) return <span className="text-muted-foreground">—</span>;

  const text = notes.join(" · ");
  return (
    <span
      title={text}
      className="inline-block whitespace-nowrap text-amber-700"
    >
      {text}
    </span>
  );
}

export function RosterTable({
  rows,
  role,
  accounts,
  canWrite,
  isMain,
  recordOnly,
  onSaveField,
  onEditEmail,
  onEditAccess,
  onEditPermissions,
}: RosterTableProps) {
  const student = role === "STUDENT";

  return (
    <div className="h-full border rounded-lg overflow-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr>
            <th className={HEAD_FIRST}>이름</th>
            {student ? (
              <>
                <th className={HEAD}>학년</th>
                <th className={HEAD}>반</th>
                <th className={HEAD}>번호</th>
                <th className={HEAD}>성별</th>
              </>
            ) : (
              <>
                <th className={HEAD}>교과명</th>
                <th className={HEAD}>담임</th>
                <th className={HEAD}>직책</th>
                <th className={HEAD}>성별</th>
                <th className={HEAD}>권한</th>
              </>
            )}
            <th className={HEAD}>이메일</th>
            <th className={HEAD}>상태</th>
            <th className={HEAD}>관리</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const account = row.userId === null ? undefined : accounts.get(row.userId);
            // 계정이 아직 없는 초안 후보는 고칠 대상 행이 없다. Excel 반영이나 전환으로만 채워진다.
            const editable = canWrite && row.userId !== null;
            const accountReady = editable && !recordOnly && account !== undefined;

            return (
              <tr key={row.entryId || `user-${row.userId}`} className="border-t">
                <td className={CELL_FIRST}>
                  <EditableTextCell
                    value={row.profile.name}
                    ariaLabel={`${row.profile.name} 이름`}
                    disabled={!editable}
                    validate={(v) => (v.trim() === "" ? "이름은 비울 수 없습니다." : null)}
                    onSave={(next) => onSaveField(row, "name", next)}
                  />
                </td>
                {student ? (
                  <>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.grade?.toString() ?? ""}
                        inputType="number"
                        ariaLabel={`${row.profile.name} 학년`}
                        disabled={!editable}
                        validate={positiveInteger("학년")}
                        onSave={(next) => onSaveField(row, "grade", next)}
                      />
                    </td>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.classNum?.toString() ?? ""}
                        inputType="number"
                        ariaLabel={`${row.profile.name} 반`}
                        disabled={!editable}
                        validate={positiveInteger("반")}
                        onSave={(next) => onSaveField(row, "classNum", next)}
                      />
                    </td>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.number?.toString() ?? ""}
                        inputType="number"
                        ariaLabel={`${row.profile.name} 번호`}
                        disabled={!editable}
                        validate={positiveInteger("번호")}
                        onSave={(next) => onSaveField(row, "number", next)}
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.subject ?? ""}
                        ariaLabel={`${row.profile.name} 교과명`}
                        placeholder="교과명 없음"
                        disabled={!editable}
                        onSave={(next) => onSaveField(row, "subject", next)}
                      />
                    </td>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.homeroom ?? ""}
                        ariaLabel={`${row.profile.name} 담임`}
                        placeholder="비담임"
                        disabled={!editable}
                        onSave={(next) => onSaveField(row, "homeroom", next)}
                      />
                    </td>
                    <td className="p-1 align-middle">
                      <EditableTextCell
                        value={row.profile.position ?? ""}
                        ariaLabel={`${row.profile.name} 직책`}
                        placeholder="직책 없음"
                        disabled={!editable}
                        onSave={(next) => onSaveField(row, "position", next)}
                      />
                    </td>
                  </>
                )}
                <td className="p-1 align-middle">
                  <EditableSelectCell
                    value={row.profile.gender ?? ""}
                    ariaLabel={`${row.profile.name} 성별`}
                    disabled={!editable}
                    emptyLabel="—"
                    options={[
                      { value: "MALE", label: "남" },
                      { value: "FEMALE", label: "여" },
                    ]}
                    onSave={(next) => onSaveField(row, "gender", next)}
                  />
                </td>
                {!student && (
                  <td className="p-2 align-middle">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 whitespace-nowrap"
                      disabled={!isMain || !accountReady}
                      onClick={() => onEditPermissions(row)}
                    >
                      {account?.adminLevel === "ADMIN"
                        ? "관리자"
                        : account?.adminLevel === "SUBADMIN"
                          ? "서브관리자"
                          : "일반"}
                    </Button>
                  </td>
                )}
                <td className="p-2 align-middle">
                  <span
                    title={row.email}
                    className="inline-block whitespace-nowrap align-middle"
                  >
                    {row.email}
                  </span>
                </td>
                <td className="p-2 align-middle">
                  <RowStatus row={row} />
                </td>
                <td className="p-2 align-middle">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 whitespace-nowrap"
                      disabled={!accountReady}
                      onClick={() => onEditEmail(row)}
                    >
                      이메일 변경
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 whitespace-nowrap"
                      disabled={!accountReady || (account?.accessState === "INACTIVE" && !isMain)}
                      onClick={() => onEditAccess(row)}
                    >
                      {account?.accessState === "INACTIVE" ? "이용 재개" : "이용 중단"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground break-keep">표시할 명부가 없습니다.</p>
      )}
    </div>
  );
}
