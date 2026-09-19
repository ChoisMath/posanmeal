import { NextResponse } from "next/server";
import { routeResponse } from "@/lib/academic-year/api";
import { requireActor } from "@/lib/academic-year/request-actor";

const RETIRED_MESSAGE =
  "Google Sheet 가져오기는 학년도별 Excel로 대체됨. 사용자 관리 탭의 [Excel 올리기]를 사용하세요.";

/**
 * 옛 Sheet 가져오기는 학년도 명부를 우회해 User를 직접 덮어썼다. 경로는 남기되
 * 아무것도 쓰지 않는다 — 북마크나 옛 탭이 조용히 명부를 흔드는 일을 막는다.
 * 인증을 먼저 요구해 이 경로의 존재 자체가 밖으로 드러나지 않게 한다.
 */
export async function POST() {
  return routeResponse(async () => {
    await requireActor("WRITE_ADMIN");
    return NextResponse.json(
      { error: { code: "GONE", message: RETIRED_MESSAGE } },
      { status: 410 },
    );
  });
}
