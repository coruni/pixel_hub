import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      // 中文与拉丁/数字保留，其余转连字符
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  );
}

export function randomTail(len = 4): string {
  return randomBytes(len).toString("hex");
}

/** 生成可用唯一 slug（冲突自动追加短随机串） */
export async function uniqueSlug(base: string): Promise<string> {
  const clean = slugify(base) || "item";
  for (let i = 0; i < 3; i++) {
    const candidate = i === 0 ? clean : `${clean}-${randomTail()}`;
    const hit = await prisma.resource.findUnique({ where: { slug: candidate } });
    if (!hit) return candidate;
  }
  return `${clean}-${randomTail(6)}`;
}
