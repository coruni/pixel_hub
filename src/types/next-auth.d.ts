import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "USER" | "MODERATOR" | "ADMIN";
      trusted: boolean;
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
  }
}
