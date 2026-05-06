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

  it("serves uploaded photos through public assets instead of filesystem reads in the GET route", () => {
    const uploadRouteSource = readFileSync(
      join(root, "src/app/api/uploads/[filename]/route.ts"),
      "utf8",
    );
    const photoRouteSource = readFileSync(
      join(root, "src/app/api/users/me/photo/route.ts"),
      "utf8",
    );

    expect(uploadRouteSource).not.toContain("readFile");
    expect(uploadRouteSource).toContain("NextResponse.redirect");
    expect(uploadRouteSource).toContain('new URL(`/uploads/${safeName}`, request.url)');
    expect(photoRouteSource).toContain('const photoUrl = `/uploads/${filename}?t=${Date.now()}`;');
  });
});
