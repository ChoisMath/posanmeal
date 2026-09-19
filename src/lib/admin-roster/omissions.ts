import type { ImportPreview } from "@/lib/academic-year/contracts";

export type OmittedPerson = { userId: number; name: string };

export type NameLookup = (userId: number) => string | undefined;

const UNKNOWN_NAME = "이름 확인 필요";

/**
 * 전체 대조에서 파일에 없던 사람. 미리보기는 id만 주므로 이름은 명부에서 찾는다.
 * 파일 안에 이미 행으로 들어온 사람(중복 매칭으로 걸린 행)은 같은 사람이 두 번
 * 보이지 않도록 누락 목록에서 뺀다.
 */
export function resolveOmissions(preview: ImportPreview, lookup: NameLookup): OmittedPerson[] {
  const inFile = new Set(
    preview.rows
      .map((row) => row.input.userId)
      .filter((userId): userId is number => typeof userId === "number"),
  );

  const seen = new Set<number>();
  const people: OmittedPerson[] = [];
  for (const userId of preview.missingUserIds) {
    if (inFile.has(userId) || seen.has(userId)) continue;
    seen.add(userId);
    people.push({ userId, name: lookup(userId) ?? UNKNOWN_NAME });
  }
  return people;
}
