import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMonthlyMealColumns, getDateDayKey } from "@/lib/meal-columns";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  checkInFindFirst: vi.fn(),
  checkInFindUnique: vi.fn(),
  checkInCreate: vi.fn(),
  checkInUpdate: vi.fn(),
  checkInDelete: vi.fn(),
  mealApplicationDateFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ canWriteAdmin: () => true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: mocks.userFindMany,
      findUnique: mocks.userFindUnique,
    },
    checkIn: {
      findFirst: mocks.checkInFindFirst,
      findUnique: mocks.checkInFindUnique,
      create: mocks.checkInCreate,
      update: mocks.checkInUpdate,
      delete: mocks.checkInDelete,
    },
    mealApplicationDate: {
      findMany: mocks.mealApplicationDateFindMany,
    },
  },
}));

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("CheckIn mealKind split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { dbUserId: 1, adminLevel: "ADMIN" } });
  });

  it("makes CheckIn mealKind required and unique per user/date/mealKind", () => {
    const schema = readProjectFile("prisma/schema.prisma");

    expect(schema).toMatch(/mealKind\s+MealKind\s*\n/);
    expect(schema).toMatch(/@@unique\(\[userId,\s*date,\s*mealKind\]\)/);
    expect(schema).not.toMatch(/@@unique\(\[userId,\s*date\]\)/);
  });

  it("has a migration that replaces the old user/date unique constraint", () => {
    const migration = readProjectFile(
      "prisma/migrations/20260502120000_make_checkin_mealkind_required/migration.sql",
    );

    expect(migration).toContain('ALTER COLUMN "mealKind" SET NOT NULL');
    expect(migration).toContain('DROP CONSTRAINT "CheckIn_userId_date_key"');
    expect(migration).toContain(
      'ADD CONSTRAINT "CheckIn_userId_date_mealKind_key" UNIQUE ("userId", "date", "mealKind")',
    );
  });

  it("builds separate breakfast and dinner columns for breakfast service dates", () => {
    const columns = buildMonthlyMealColumns(2026, 5, ["2026-05-30"]);

    expect(columns.filter((column) => column.date === "2026-05-29")).toEqual([
      expect.objectContaining({ date: "2026-05-29", day: 29, mealKind: "DINNER" }),
    ]);
    expect(columns.filter((column) => column.date === "2026-05-30")).toEqual([
      expect.objectContaining({ key: "2026-05-30:BREAKFAST", day: 30, mealKind: "BREAKFAST" }),
      expect.objectContaining({ key: "2026-05-30:DINNER", day: 30, mealKind: "DINNER" }),
    ]);
  });

  it("derives day keys from YYYY-MM-DD strings without timezone shifts", () => {
    expect(getDateDayKey("2026-05-30T00:00:00.000Z")).toBe("2026-05-30");
    expect(getDateDayKey(new Date("2026-05-30T00:00:00.000Z"))).toBe("2026-05-30");
  });

  it("returns meal columns for admin monthly check-in rows", async () => {
    const { GET } = await import("@/app/api/admin/checkins/route");
    mocks.userFindMany.mockResolvedValue([]);
    mocks.mealApplicationDateFindMany.mockResolvedValue([{ date: new Date("2026-05-30T00:00:00.000Z") }]);

    const response = await GET(new Request("http://localhost/api/admin/checkins?year=2026&month=5&category=teacher"));
    const body = await response.json();

    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          checkIns: expect.objectContaining({
            where: expect.objectContaining({
              date: expect.any(Object),
            }),
          }),
        }),
      }),
    );
    expect(body.mealColumns.filter((column: { date: string }) => column.date === "2026-05-30")).toEqual([
      expect.objectContaining({ mealKind: "BREAKFAST" }),
      expect.objectContaining({ mealKind: "DINNER" }),
    ]);
  });

  it("looks up admin toggle rows by user/date/mealKind", async () => {
    const { POST } = await import("@/app/api/admin/checkins/toggle/route");
    mocks.userFindUnique.mockResolvedValue({ id: 7, role: "TEACHER" });
    mocks.checkInFindFirst.mockResolvedValue(null);
    mocks.checkInFindUnique.mockResolvedValue(null);
    mocks.checkInCreate.mockResolvedValue({ id: 10 });

    await POST(
      new Request("http://localhost/api/admin/checkins/toggle", {
        method: "POST",
        body: JSON.stringify({ userId: 7, date: "2026-05-30", action: "cycle" }),
      }),
    );

    expect(mocks.checkInFindUnique).toHaveBeenCalledWith({
      where: {
        userId_date_mealKind: {
          userId: 7,
          date: new Date("2026-05-30T00:00:00.000Z"),
          mealKind: "DINNER",
        },
      },
      select: { id: true, type: true },
    });
  });

  it("does not derive admin grid day numbers via Date.getDate", () => {
    const source = readProjectFile("src/components/AdminMealTable.tsx");

    expect(source).not.toContain("new Date(c.date).getDate()");
    expect(source).toContain("getDateDayKey");
  });
});
