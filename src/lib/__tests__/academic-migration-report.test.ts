import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigrationReport } from "../../../scripts/academic-year/report";

describe("protected migration evidence", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "academic-report-")); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it("creates private evidence and refuses to overwrite the original fingerprint", () => {
    const report = createMigrationReport(path.join(directory, "reports"));
    report.write("before.json", { tables: { User: { count: "1", sha256: "original" } } });
    const before = path.join(report.directory, "before.json");

    expect(fs.statSync(report.directory).mode & 0o777).toBe(0o700);
    expect(fs.statSync(before).mode & 0o777).toBe(0o600);
    expect(() => report.write("before.json", { changed: true })).toThrow();
    expect(JSON.parse(fs.readFileSync(before, "utf8"))).toEqual({ tables: { User: { count: "1", sha256: "original" } } });
  });

  it("keeps the before evidence if a later report cannot be written", () => {
    const report = createMigrationReport(directory);
    report.write("before.json", { original: true });
    fs.mkdirSync(path.join(report.directory, "result.json"));

    expect(() => report.write("result.json", { completed: true })).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(report.directory, "before.json"), "utf8")))
      .toEqual({ original: true });
  });

  it("rejects the app public directory and a symlink to it", () => {
    const publicDir = path.resolve(__dirname, "../../../public");
    const link = path.join(directory, "public-link");
    fs.symlinkSync(publicDir, link, "dir");

    expect(() => createMigrationReport(publicDir)).toThrow("공개 디렉터리");
    expect(() => createMigrationReport(link)).toThrow("공개 디렉터리");
    expect(fs.readdirSync(directory)).toEqual(["public-link"]);
  });
});
