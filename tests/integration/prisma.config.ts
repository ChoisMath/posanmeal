import { defineConfig } from "prisma/config";

// dotenv를 import하지 않는다: 이 URL은 항상 test-db.ts wrapper가
// ACADEMIC_TEST_DATABASE_URL 환경변수로 프로세스 내부에서 주입한다.
export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: {
    path: "../../prisma/migrations",
  },
  datasource: {
    url: process.env["ACADEMIC_TEST_DATABASE_URL"],
  },
});
