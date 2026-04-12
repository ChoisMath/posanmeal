import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("admin", 10);
  await prisma.admin.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
    },
  });
  console.log("Admin user seeded");

  await prisma.systemSetting.upsert({
    where: { key: "operationMode" },
    update: {},
    create: { key: "operationMode", value: "online" },
  });
  await prisma.systemSetting.upsert({
    where: { key: "qrGeneration" },
    update: {},
    create: { key: "qrGeneration", value: "1" },
  });
  console.log("System settings seeded");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
