"use server";

// 内容页（社区规则/用户协议/隐私协议）后台保存：仅管理员；SiteSetting(key="doc:<page>") 直存 Markdown。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { DOC_PAGES, isDocKey } from "@/lib/doc-config";

export type DocSaveResult = { ok: boolean; error?: string };

const MAX_DOC_MD = 100_000;

function revalidateDocPages(): void {
  revalidatePath("/rules");
  revalidatePath("/terms");
  revalidatePath("/privacy");
  revalidatePath("/admin/docs");
}

export async function saveDocAction(page: unknown, raw: unknown): Promise<DocSaveResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!isDocKey(page)) return { ok: false, error: "未知的内容页" };
  const md = String(raw ?? "").trim();
  if (!md) return { ok: false, error: "内容不能为空（如需回退内置默认请使用「恢复默认」）" };
  if (md.length > MAX_DOC_MD) return { ok: false, error: "内容过长，请精简后保存" };

  const key = DOC_PAGES[page].key;
  // 内容页低频单人编辑，last-write-wins（version 自增留痕，不做乐观锁）
  const existing = await prisma.siteSetting.findUnique({ where: { key }, select: { key: true } });
  if (existing) {
    await prisma.siteSetting.update({
      where: { key },
      data: { value: md, version: { increment: 1 } },
    });
  } else {
    await prisma.siteSetting.create({ data: { key, value: md, version: 1 } });
  }
  await audit(admin.id, "EDIT_DOC_PAGE", "SITE_SETTING", key);
  revalidateDocPages();
  return { ok: true };
}

export async function resetDocAction(page: unknown): Promise<DocSaveResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!isDocKey(page)) return { ok: false, error: "未知的内容页" };

  // 删除自定义行 = 回退内置默认（读取层对空/缺失自动回退）
  await prisma.siteSetting.deleteMany({ where: { key: DOC_PAGES[page].key } });
  await audit(admin.id, "EDIT_DOC_PAGE", "SITE_SETTING", DOC_PAGES[page].key);
  revalidateDocPages();
  return { ok: true };
}
