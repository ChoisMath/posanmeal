import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
      role: string;
      dbUserId: number;
      adminLevel: "NONE" | "SUBADMIN" | "ADMIN";
      /** 로그인 시점의 세션 세대. 이 값이 없는 세션은 무효화 이력을 담지 못한다. */
      sessionVersion?: number;
    };
  }

  interface User {
    role?: string;
    dbUserId?: number;
    dbRole?: string;
    dbAdminLevel?: "NONE" | "SUBADMIN" | "ADMIN";
    dbSessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    dbUserId?: number;
    adminLevel?: "NONE" | "SUBADMIN" | "ADMIN";
    sessionVersion?: number;
  }
}
