import path from "node:path";
import { defineConfig } from "vitest/config";

/** DB가 필요 없는 문서·안내 검증. 기본 include(`src/lib/__tests__`) 밖이라 따로 돌린다. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
