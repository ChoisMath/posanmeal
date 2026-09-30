import { describe, expect, it } from "vitest";
import { sessionRecoveryAction } from "@/lib/session-recovery";

const staleBody = { error: { code: "STALE_SESSION", message: "로그인 정보가 만료되었습니다." } };

describe("sessionRecoveryAction", () => {
  it("sends a signed-in page back to the landing page", () => {
    expect(sessionRecoveryAction(401, staleBody, "/student")).toBe("SIGN_OUT_HOME");
    expect(sessionRecoveryAction(401, staleBody, "/teacher")).toBe("SIGN_OUT_HOME");
  });

  it("sends an admin page to the admin login", () => {
    expect(sessionRecoveryAction(401, staleBody, "/admin")).toBe("SIGN_OUT_ADMIN");
    expect(sessionRecoveryAction(401, staleBody, "/admin/login")).toBe("SIGN_OUT_ADMIN");
  });

  it("covers every code the guarded APIs answer 401 with", () => {
    for (const code of ["STALE_SESSION", "ACCOUNT_INACTIVE", "UNAUTHENTICATED"]) {
      expect(sessionRecoveryAction(401, { error: { code } }, "/student")).toBe("SIGN_OUT_HOME");
    }
  });

  it("treats a 403 ACCOUNT_INACTIVE as signed out, since accessState is checked before sessionVersion", () => {
    const inactive = { error: { code: "ACCOUNT_INACTIVE", message: "이용이 중지된 계정입니다." } };
    expect(sessionRecoveryAction(403, inactive, "/student")).toBe("SIGN_OUT_HOME");
    expect(sessionRecoveryAction(403, inactive, "/teacher")).toBe("SIGN_OUT_HOME");
    expect(sessionRecoveryAction(403, inactive, "/admin")).toBe("SIGN_OUT_ADMIN");
    expect(sessionRecoveryAction(403, inactive, "/check")).toBe("NONE");
  });

  it("keeps other 403 codes on the page", () => {
    expect(sessionRecoveryAction(403, { error: { code: "STALE_SESSION" } }, "/student")).toBe("NONE");
    expect(sessionRecoveryAction(403, { error: { code: "UNAUTHENTICATED" } }, "/student")).toBe("NONE");
  });

  it("leaves the public kiosk pages alone", () => {
    expect(sessionRecoveryAction(401, staleBody, "/check")).toBe("NONE");
    expect(sessionRecoveryAction(401, staleBody, "/facecheck")).toBe("NONE");
  });

  it("ignores other statuses, other codes and unreadable bodies", () => {
    expect(sessionRecoveryAction(403, { error: { code: "FORBIDDEN" } }, "/student")).toBe("NONE");
    expect(sessionRecoveryAction(500, staleBody, "/student")).toBe("NONE");
    expect(sessionRecoveryAction(401, { error: "Forbidden" }, "/student")).toBe("NONE");
    expect(sessionRecoveryAction(401, null, "/student")).toBe("NONE");
    expect(sessionRecoveryAction(401, undefined, "/student")).toBe("NONE");
  });
});
