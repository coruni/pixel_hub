import { PrismaClient } from "@prisma/client";

// 开发环境避免热重载创建过多连接（HMR 下 global 缓存）
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// 默认不限制连接池：交由 Prisma/数据库自身管理连接数（你的实例上限为 60）。
// 仅当用户显式设置 PRISMA_CONNECTION_LIMIT 时才注入 connection_limit；URL 中已含该参数则尊重之。
function resolveUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const limit = process.env.PRISMA_CONNECTION_LIMIT;
  if (!limit) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connection_limit=${limit}`;
}

const url = resolveUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
