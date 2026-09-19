import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** 서버 전용. 트랜잭션 안/밖 어디서나 같은 쿼리를 쓰기 위한 클라이언트 타입. */
export type Db = PrismaClient | Prisma.TransactionClient;

export type Tx = Prisma.TransactionClient;
