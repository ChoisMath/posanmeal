import type { AcademicProfile, MemberState } from "./contracts";
import type { Db } from "./db";

/**
 * 그 학년도에 기록이 있는 사람만 돌려준다. 기록이 없으면 항목을 만들지 않는다 —
 * 현재 `User` 값으로 메우면 지난 학년도 화면이 올해 학년·반을 조용히 보여 주게
 * 되고, 그 자리는 "학년도 정보 확인 필요"로 남아야 한다.
 */
export async function getAcademicProfiles(
  db: Db,
  userIds: number[],
  year: number,
): Promise<Map<number, AcademicProfile>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();

  const records = await db.userAcademicRecord.findMany({
    where: { year, userId: { in: ids } },
    select: {
      year: true,
      userId: true,
      role: true,
      name: true,
      grade: true,
      classNum: true,
      number: true,
      gender: true,
      subject: true,
      homeroom: true,
      position: true,
      memberState: true,
      version: true,
      needsReview: true,
    },
  });

  return new Map(
    records.map((record) => [
      record.userId,
      { ...record, memberState: record.memberState as MemberState },
    ]),
  );
}
