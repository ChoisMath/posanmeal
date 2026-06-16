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

  it("streams uploaded photos from UPLOAD_DIR (Railway Volume) with a static fallback", () => {
    const uploadRouteSource = readFileSync(
      join(root, "src/app/api/uploads/[filename]/route.ts"),
      "utf8",
    );
    const photoRouteSource = readFileSync(
      join(root, "src/app/api/users/me/photo/route.ts"),
      "utf8",
    );

    // GET 라우트는 Node 런타임에서 UPLOAD_DIR(볼륨)의 파일을 스트리밍하고,
    // /uploads/ redirect 는 구 photoUrl 호환 폴백으로만 유지한다.
    expect(uploadRouteSource).toContain('export const runtime = "nodejs"');
    expect(uploadRouteSource).toContain("readFile");
    expect(uploadRouteSource).toContain("process.env.UPLOAD_DIR");
    expect(uploadRouteSource).toContain('new URL(`/uploads/${safeName}`, request.url)');
    // 신규 업로드는 볼륨에 쓰고 API 라우트 경유로 주소를 발급한다.
    expect(photoRouteSource).toContain("process.env.UPLOAD_DIR");
    expect(photoRouteSource).toContain('const photoUrl = `/api/uploads/${filename}?t=${Date.now()}`;');
  });
});
