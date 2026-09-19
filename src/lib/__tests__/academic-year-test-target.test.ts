import { expect, it } from "vitest";
import { parseAcademicTestTarget } from "@/lib/academic-year/test-target";

it.each([
  "postgresql://u:p@railway.example:5432/posanmeal",
  "postgresql://u:p@127.0.0.1:5432/posanmeal",
  "postgresql://academic_year_test:local-only@127.0.0.1:55439/production",
  "",
])("rejects a non-test target without printing its URL", (raw) => {
  expect(() => parseAcademicTestTarget(raw)).toThrow("전용 테스트 DB 설정을 확인하세요");
});

it("accepts the fixed academic-year test target", () => {
  const url = parseAcademicTestTarget(
    "postgresql://academic_year_test:local-only@127.0.0.1:55439/posanmeal_academic_year_test",
  );
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.port).toBe("55439");
});
