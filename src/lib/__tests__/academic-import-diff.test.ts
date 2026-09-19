import { describe, expect, it } from "vitest";
import { diffRosterImport, type DiffRosterImportInput } from "@/lib/academic-year/import-diff";
import type { Profile } from "@/lib/academic-year/contracts";

const student: Profile = { role: "STUDENT", name: "합성학생", grade: 2, classNum: 3, number: 4,
  gender: "MALE", subject: null, homeroom: null, position: null };
const teacher: Profile = { role: "TEACHER", name: "합성교사", grade: null, classNum: null, number: null,
  gender: null, subject: "수학", homeroom: null, position: null };

function inputFor(state: "ACTIVE" | "DRAFT", original: Profile, imported: Profile, token: boolean): DiffRosterImportInput {
  const email = "synthetic@example.test";
  return {
    year: 2026, state, scope: "PARTIAL", accounts: new Map(), userVersions: new Map([[17, 0]]),
    roster: [{ entryId: "entry-17", userId: 17, email, emailKey: email, profile: original,
      baseUserVersion: 0, included: true, version: 0, needsReview: false, memberState: "ENROLLED",
      adminLevel: "NONE", accessState: "ACTIVE", incomplete: false, issues: [] }],
    manifest: token ? { schemaVersion: 1, fileId: "synthetic-file", year: 2026, version: 0,
      rows: { "row-17": { entryId: "entry-17", userId: 17, email, version: 0 } } } : null,
    parsed: { fileId: "synthetic-file", year: 2026, templateOnly: !token, coveredRoles: [imported.role], issues: [],
      rows: [{ sheet: imported.role === "STUDENT" ? "학생" : "교사", row: 2, email, profile: imported,
        ...(token ? { rowToken: "row-17" } : {}) }] },
  };
}

describe("existing roster identity in Excel imports", () => {
  for (const state of ["ACTIVE", "DRAFT"] as const) {
    for (const token of [true, false]) {
      it.each([[student, teacher], [teacher, student]])(`blocks a role switch in ${state} with token=${token}`, (original, imported) => {
        const result = diffRosterImport(inputFor(state, original, imported, token));
        expect(result.canCommit).toBe(false);
        expect(result.rows[0]).toMatchObject({ kind: "REVIEW", before: original,
          issues: [expect.objectContaining({ code: "ROLE_MISMATCH" })] });
        expect(result.checks).toHaveLength(0);
      });
    }
  }

  it.each([student, teacher])("keeps a same-role name correction eligible for commit", (original) => {
    const result = diffRosterImport(inputFor("ACTIVE", original, { ...original, name: "정정이름" }, true));
    expect(result.canCommit).toBe(true);
    expect(result.rows[0]).toMatchObject({ kind: "CHANGED", input: { userId: 17, profile: { role: original.role } } });
  });
});
