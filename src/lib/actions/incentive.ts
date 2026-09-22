"use server";

// 创作者激励后台配置：保存 / 恢复默认。读写 SiteSetting["incentive"]（乐观锁 doc），
// 仿 actions/uploads.ts 骨架。计分热路径直接消费 getIncentive()，无需经此。
//
// 【重要】本页保存是**整份替换**（WYSIWYG）：表单永远提交完整配置文档，
// 缺失字段组回落代码内默认（见 points-config.safeIncentive）。不要改成分字段增量写。
import { revalidatePath } from "next/cache";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { DEFAULT_INCENTIVE_CONFIG, safeIncentive } from "@/lib/points-config";
import { readIncentiveDoc, writeIncentiveDoc } from "@/lib/incentive";
import type { ActionResult } from "@/lib/hooks";

const CONFLICT: ActionResult = { ok: false, error: "配置已被其他人修改，请刷新页面后重试" };

/** 配置影响面：后台自身 + 前台所有展示等级/贡献分/榜单的入口 */
function incentiveRevalidate() {
  revalidatePath("/admin/incentive");
  revalidatePath("/admin");
  revalidatePath("/creators");
  revalidatePath("/creators/me");
  revalidatePath("/");
}

/** 保存整份激励配置。`raw` 由后台表单提交，服务端以 zod schema 为唯一权威校验 */
export async function saveIncentiveAction(raw: unknown): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const parsed = safeIncentive(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const doc = await readIncentiveDoc();
  doc.config = parsed.data;
  if (!(await writeIncentiveDoc(doc))) return CONFLICT;
  await audit(admin.id, "EDIT_INCENTIVE", "INCENTIVE", undefined, "保存创作者激励配置");
  incentiveRevalidate();
  return { ok: true };
}

/** 恢复全量默认值（含分成比例回到代码内默认）。存量贡献分/流水不受影响 */
export async function resetIncentiveAction(): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const doc = await readIncentiveDoc();
  doc.config = structuredClone(DEFAULT_INCENTIVE_CONFIG);
  if (!(await writeIncentiveDoc(doc))) return CONFLICT;
  await audit(admin.id, "RESET_INCENTIVE", "INCENTIVE");
  incentiveRevalidate();
  return { ok: true };
}
