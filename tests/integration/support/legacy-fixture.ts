import type { PrismaClient } from "@/generated/prisma/client";

export interface LegacyFixtureIds {
  studentId: number;
  teacherId: number;
  applicationId: number;
  registrationId: number;
  checkInId: number;
}

const CONFIRMED_DATES = ["2026-09-18", "2026-09-19"] as const;
const CHECK_IN_DATE = "2026-09-18";

/**
 * Task 1 이후 모든 Task가 공유하는 합성 기준 데이터.
 * 실제 학생 개인정보를 사용하지 않는다.
 */
export async function seedLegacyFixture(db: PrismaClient): Promise<LegacyFixtureIds> {
  const student = await db.user.create({
    data: {
      email: "student-test@example.posan.kr",
      name: "학생테스트",
      role: "STUDENT",
      grade: 1,
      classNum: 1,
      number: 1,
      gender: "MALE",
    },
  });

  const teacher = await db.user.create({
    data: {
      email: "teacher-test@example.posan.kr",
      name: "교사테스트",
      role: "TEACHER",
      homeroom: "1-1",
      adminLevel: "ADMIN",
    },
  });

  const application = await db.mealApplication.create({
    data: {
      title: "2026년 9월 석식 신청",
      status: "OPEN",
      applyStartAt: new Date("2026-09-01T00:00:00.000Z"),
      applyEndAt: new Date("2026-09-30T23:59:59.000Z"),
      startYear: 2026,
      startMonth: 9,
      monthCount: 1,
      meals: {
        create: [{ mealKind: "DINNER", price: 4000, exemptionSelectable: false, method: "DATE" }],
      },
      mealDates: {
        create: CONFIRMED_DATES.map((date) => ({
          mealKind: "DINNER" as const,
          grade: 1,
          date: new Date(`${date}T00:00:00.000Z`),
        })),
      },
    },
  });

  const registration = await db.mealRegistration.create({
    data: {
      applicationId: application.id,
      userId: student.id,
      signature: "학생테스트-서명",
      status: "APPROVED",
      meals: {
        create: [{ mealKind: "DINNER", applied: true, exempt: false }],
      },
      mealDates: {
        create: CONFIRMED_DATES.map((date) => ({
          mealKind: "DINNER" as const,
          date: new Date(`${date}T00:00:00.000Z`),
        })),
      },
    },
  });

  const studentCheckIn = await db.checkIn.create({
    data: {
      userId: student.id,
      date: new Date(`${CHECK_IN_DATE}T00:00:00.000Z`),
      mealKind: "DINNER",
      type: "STUDENT",
      source: "QR",
    },
  });

  await db.checkIn.create({
    data: {
      userId: teacher.id,
      date: new Date(`${CHECK_IN_DATE}T00:00:00.000Z`),
      mealKind: "DINNER",
      type: "WORK",
      source: "ADMIN_MANUAL",
    },
  });

  await db.faceProfile.create({
    data: {
      userId: student.id,
      embeddings: Array.from({ length: 8 }, (_, i) => Number((i * 0.01).toFixed(4))),
      modelVersion: "insightface-mobilenet-emore-test",
      consentAt: new Date("2026-09-01T00:00:00.000Z"),
      consentVersion: "v1",
    },
  });

  await db.faceProfile.create({
    data: {
      userId: teacher.id,
      embeddings: Array.from({ length: 8 }, (_, i) => Number((0.5 + i * 0.01).toFixed(4))),
      modelVersion: "insightface-mobilenet-emore-test",
      consentAt: new Date("2026-09-01T00:00:00.000Z"),
      consentVersion: "v1",
    },
  });

  await db.user.update({
    where: { id: student.id },
    data: { photoUrl: `/api/uploads/${student.id}.webp?t=1758153600000` },
  });

  await db.systemSetting.create({
    data: { key: "faceMatchThreshold", value: "0.55" },
  });

  return {
    studentId: student.id,
    teacherId: teacher.id,
    applicationId: application.id,
    registrationId: registration.id,
    checkInId: studentCheckIn.id,
  };
}
