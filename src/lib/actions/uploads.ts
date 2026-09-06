"use server";

// 上传限制后台配置：保存 / 恢复默认。读写 SiteSetting["uploadLimits"]（乐观锁 doc），
// 仿 actions/site.ts 骨架。强制点（上传路由/action）直接消费 getUploadLimits()，无需经此。
import { revalidatePath } from "next/cache";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { DEFAULT_UPLOAD_LIMITS, MB_RANGE, clampInt, normalizeExts } from "@/lib/upload-config";
import { readUploadLimitsDoc, writeUploadLimitsDoc } from "@/lib/upload-limits";
import type { ActionResult } from "@/lib/hooks";

const CONFLICT: ActionResult = { ok: false, error: "配置已被其他人修改，请刷新页面后重试" };

function uploadsRevalidate() {
  revalidatePath("/admin/uploads");
  revalidatePath("/admin");
}

export type SaveUploadLimitsInput = {
  /** 附件单文件上限（MB） */
  attachmentMaxMb?: number;
  /** 附件允许后缀：原始文本（逗号/空格/换行分隔，服务端 normalizeExts 权威校验） */
  attachmentExts?: string;
  /** 图集/原图单张（MB，含后台直传） */
  galleryImageMaxMb?: number;
  /** 评论附图单张（MB） */
  commentImageMaxMb?: number;
  /** 头像（MB） */
  avatarMaxMb?: number;
};

export async function saveUploadLimitsAction(input: SaveUploadLimitsInput): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const doc = await readUploadLimitsDoc();
  const l = doc.limits;

  // 数值：range 内整数钳制（缺失保持现值）
  if (typeof input.attachmentMaxMb === "number")
    l.attachmentMaxMb = clampInt(
      input.attachmentMaxMb,
      MB_RANGE.attachment.min,
      MB_RANGE.attachment.max,
      l.attachmentMaxMb,
    );
  if (typeof input.galleryImageMaxMb === "number")
    l.galleryImageMaxMb = clampInt(
      input.galleryImageMaxMb,
      MB_RANGE.image.min,
      MB_RANGE.image.max,
      l.galleryImageMaxMb,
    );
  if (typeof input.commentImageMaxMb === "number")
    l.commentImageMaxMb = clampInt(
      input.commentImageMaxMb,
      MB_RANGE.image.min,
      MB_RANGE.image.max,
      l.commentImageMaxMb,
    );
  if (typeof input.avatarMaxMb === "number")
    l.avatarMaxMb = clampInt(
      input.avatarMaxMb,
      MB_RANGE.image.min,
      MB_RANGE.image.max,
      l.avatarMaxMb,
    );

  // 后缀：整单替换，非法/被拒即拒绝不改库
  if (typeof input.attachmentExts === "string") {
    const r = normalizeExts(input.attachmentExts);
    if (!r.ok) return { ok: false, error: r.error };
    l.attachmentExts = r.list;
  }

  if (!(await writeUploadLimitsDoc(doc))) return CONFLICT;
  await audit(admin.id, "EDIT_UPLOAD_LIMITS", "UPLOAD_LIMITS", undefined, JSON.stringify(input));
  uploadsRevalidate();
  return { ok: true };
}

export async function resetUploadLimitsAction(): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const doc = await readUploadLimitsDoc();
  doc.limits = {
    ...DEFAULT_UPLOAD_LIMITS,
    attachmentExts: [...DEFAULT_UPLOAD_LIMITS.attachmentExts],
  };
  if (!(await writeUploadLimitsDoc(doc))) return CONFLICT;
  await audit(admin.id, "RESET_UPLOAD_LIMITS", "UPLOAD_LIMITS");
  uploadsRevalidate();
  return { ok: true };
}
