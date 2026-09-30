export interface LoginNotice {
  title: string;
  detail: string;
}

/** Auth.js가 `pages.error`(홈)로 돌려보낼 때 붙이는 `?error=` 값을 사용자 안내로 바꾼다. */
export function loginNoticeFor(error: string | string[] | undefined): LoginNotice | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  if (code === "AccessDenied") {
    return {
      title: "등록되지 않은 Google 계정입니다.",
      detail: "학교에 등록한 Google 계정을 선택해 다시 로그인해 주세요.",
    };
  }
  return {
    title: "로그인에 실패했습니다.",
    detail: "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의하세요.",
  };
}
