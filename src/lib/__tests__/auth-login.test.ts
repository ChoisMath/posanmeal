import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig, User } from "next-auth";

const mocks = vi.hoisted(() => ({
  config: null as NextAuthConfig | null,
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: NextAuthConfig) => {
    mocks.config = config;
    return {};
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique, findMany: mocks.findMany, update: mocks.update } },
}));

import "@/auth";

type AccountRow = {
  id: number;
  email: string;
  emailKey: string | null;
  role: "STUDENT" | "TEACHER";
  adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
  sessionVersion: number;
  accessState: "ACTIVE" | "INACTIVE";
};

const REGISTERED: AccountRow = {
  id: 17,
  email: "Student.New@Example.test",
  emailKey: "student.new@example.test",
  role: "STUDENT",
  adminLevel: "NONE",
  sessionVersion: 4,
  accessState: "ACTIVE",
};

let accounts: AccountRow[];

async function googleSignIn(email: User["email"]) {
  const user: User = { id: "synthetic-google-id", email };
  const result = await mocks.config!.callbacks!.signIn!({
    user,
    account: { provider: "google", type: "oauth", providerAccountId: "synthetic-google-id" },
  });
  return { result, user };
}

beforeEach(() => {
  vi.clearAllMocks();
  accounts = [structuredClone(REGISTERED)];
  mocks.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
    accounts.find((row) => row.email === where.email) ?? null,
  );
  mocks.findMany.mockImplementation(async ({ where }: { where: { OR: { emailKey: string | null }[] } }) =>
    accounts.filter((row) => where.OR.some((condition) => condition.emailKey === row.emailKey)),
  );
});

describe("Google login identity", () => {
  it("accepts the registered mixed-case address without changing its stored spelling", async () => {
    const before = structuredClone(accounts);
    const { result, user } = await googleSignIn("student.new@example.test");
    expect(result).toBe(true);
    expect(user).toMatchObject({ dbUserId: 17, dbRole: "STUDENT", dbAdminLevel: "NONE", dbSessionVersion: 4 });
    expect(accounts).toEqual(before);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("normalizes callback whitespace and case using the same identity rule", async () => {
    expect((await googleSignIn("\tSTUDENT.NEW@Example.Test \n")).result).toBe(true);
  });

  it("accepts a unique PREPARING account whose normalization key has not been backfilled", async () => {
    accounts = [{ ...REGISTERED, email: "\tStudent.New@Example.test \n", emailKey: null }];
    expect((await googleSignIn("student.new@example.test")).result).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("ignores unrelated accounts that also have null normalization keys", async () => {
    accounts.push({ ...REGISTERED, id: 18, email: "other@example.test", emailKey: null });
    expect((await googleSignIn("student.new@example.test")).result).toBe(true);
  });

  it("denies duplicate unbackfilled identities even when one matches the original spelling", async () => {
    accounts = [
      { ...REGISTERED, emailKey: null },
      { ...REGISTERED, id: 18, email: "student.new@example.test", emailKey: null },
    ];
    const { result, user } = await googleSignIn("Student.New@Example.test");
    expect(result).toBe(false);
    expect(user.dbUserId).toBeUndefined();
  });

  it("denies a normalized-key match when an inactive legacy account has the same identity", async () => {
    accounts.push({ ...REGISTERED, id: 18, email: " STUDENT.NEW@EXAMPLE.TEST ", emailKey: null, accessState: "INACTIVE" });
    expect((await googleSignIn("Student.New@Example.test")).result).toBe(false);
  });

  it("denies a stale key that no longer matches the account email", async () => {
    accounts = [{ ...REGISTERED, email: "other@example.test" }];
    expect((await googleSignIn("student.new@example.test")).result).toBe(false);
  });

  it("denies an inactive account without attaching identity claims", async () => {
    accounts = [{ ...REGISTERED, accessState: "INACTIVE" }];
    const { result, user } = await googleSignIn("student.new@example.test");
    expect(result).toBe(false);
    expect(user.dbUserId).toBeUndefined();
  });

  it("does not collapse Gmail dots or plus aliases into an existing account", async () => {
    accounts = [{ ...REGISTERED, email: "student.name@gmail.com", emailKey: "student.name@gmail.com" }];
    expect((await googleSignIn("studentname@gmail.com")).result).toBe(false);
    expect((await googleSignIn("student.name+meal@gmail.com")).result).toBe(false);
  });

  it.each([null, undefined, "", " \t\n"])("denies an absent email (%j) before a database lookup", async (email) => {
    expect((await googleSignIn(email)).result).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("carries the stored teacher authority and session generation into the initial token", async () => {
    accounts = [{ ...REGISTERED, role: "TEACHER", adminLevel: "SUBADMIN", sessionVersion: 9 }];
    const { user } = await googleSignIn("student.new@example.test");
    const token = await mocks.config!.callbacks!.jwt!({
      token: {}, user,
      account: { provider: "google", type: "oauth", providerAccountId: "synthetic-google-id" },
    } as never);
    expect(token).toMatchObject({ dbUserId: 17, role: "TEACHER", adminLevel: "SUBADMIN", sessionVersion: 9 });
  });

  it("preserves an old session generation on a later JWT refresh", async () => {
    const token = { dbUserId: 17, role: "STUDENT", adminLevel: "NONE", sessionVersion: 2 };
    expect(await mocks.config!.callbacks!.jwt!({ token } as never)).toEqual(token);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("keeps credentials MAIN login independent of registered Google identities", async () => {
    const user = { id: "admin-1", name: "admin", role: "ADMIN" };
    const account = { provider: "admin-login", type: "credentials", providerAccountId: "admin-1" } as const;
    expect(await mocks.config!.callbacks!.signIn!({ user, account })).toBe(true);
    expect(await mocks.config!.callbacks!.jwt!({ token: {}, user, account } as never))
      .toMatchObject({ dbUserId: 0, role: "ADMIN", adminLevel: "ADMIN" });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
