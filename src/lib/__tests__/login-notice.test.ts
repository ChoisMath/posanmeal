import { describe, expect, it } from "vitest";
import { loginNoticeFor } from "@/lib/login-notice";

describe("loginNoticeFor", () => {
  it("explains an AccessDenied sign-in as an unregistered Google account", () => {
    expect(loginNoticeFor("AccessDenied")).toEqual({
      title: "등록되지 않은 Google 계정입니다.",
      detail: "학교에 등록한 Google 계정을 선택해 다시 로그인해 주세요.",
    });
  });

  it("gives a generic retry message for other Auth.js errors", () => {
    expect(loginNoticeFor("Configuration")?.title).toBe("로그인에 실패했습니다.");
    expect(loginNoticeFor("OAuthCallbackError")?.title).toBe("로그인에 실패했습니다.");
  });

  it("returns nothing without an error parameter", () => {
    expect(loginNoticeFor(undefined)).toBeNull();
    expect(loginNoticeFor("")).toBeNull();
  });

  it("uses the first value when the parameter repeats", () => {
    expect(loginNoticeFor(["AccessDenied", "Configuration"])?.title).toBe("등록되지 않은 Google 계정입니다.");
  });
});
