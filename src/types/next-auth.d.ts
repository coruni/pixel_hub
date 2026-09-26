import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "USER" | "MODERATOR" | "ADMIN";
      trusted: boolean;
      /** 配色偏好（库里的枚举形态）。SYSTEM = 跟随系统/浏览器 */
      colorMode: "SYSTEM" | "LIGHT" | "DARK";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username: string;
    role: string;
    trusted: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    role?: "USER" | "MODERATOR" | "ADMIN";
    trusted?: boolean;
    colorMode?: "SYSTEM" | "LIGHT" | "DARK";
  }
}
