import fs from "node:fs";
import path from "node:path";

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function createMigrationReport(reportDir: string) {
  const publicDir = fs.realpathSync(path.resolve(__dirname, "../../public"));
  const requested = path.resolve(reportDir);
  if (inside(publicDir, requested)) throw new Error("공개 디렉터리에는 이전 보고서를 저장할 수 없습니다");
  fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  const destination = fs.realpathSync(requested);
  if (inside(publicDir, destination)) throw new Error("공개 디렉터리에는 이전 보고서를 저장할 수 없습니다");
  const directory = fs.mkdtempSync(path.join(destination, "academic-"));
  fs.chmodSync(directory, 0o700);

  return {
    directory,
    write(name: "before.json" | "after.json" | "result.json" | "survey-confirmations.json", value: unknown): void {
      const fd = fs.openSync(path.join(directory, name), "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(value, null, 2));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}
