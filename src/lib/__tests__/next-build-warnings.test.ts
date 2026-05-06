import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Next build warning guardrails", () => {
  it("uses proxy.ts instead of the deprecated middleware.ts convention", () => {
    expect(existsSync(join(root, "src/middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "src/proxy.ts"))).toBe(true);

    const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
    expect(proxySource).not.toContain("export const runtime");
    expect(proxySource).toContain("matcher");
  });
});
