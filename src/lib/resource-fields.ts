import { z } from "zod";

/**
 * 发布（前端上传向导）与后台改稿共用的字段约束——单一事实来源，
 * 两边保持同一套 maxLength / 必填 / 外链校验，避免后台编辑表单与上传表单字段定义漂移。
 * 不删除任何字段：后台改稿仍允许修改文案/分类/标签/外链与可见性，与发布对齐。
 */

export const TITLE_MAX = 80;
export const SUMMARY_MAX = 160;
export const DESCRIPTION_MAX = 20000;
export const TAGS_MAX = 400;
export const MAX_TAGS = 12;

/** 外链/站内附件路径：允许空，或 http(s):// 或站内 /uploads/... 路径 */
export const urlLike = (v: string): boolean =>
  !v || /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v);

/** 标题/简介/正文/分类/标签/外链 的共用校验（不含 type，发布侧自行 extend） */
export const resourceTextFields = z.object({
  title: z.string().trim().min(3, "标题至少 3 个字").max(TITLE_MAX, "标题过长"),
  summary: z.string().trim().max(SUMMARY_MAX, "简介过长").optional().default(""),
  description: z.string().trim().min(10, "描述至少 10 个字").max(DESCRIPTION_MAX, "描述过长"),
  categoryId: z.string().min(1, "请选择分类"),
  tags: z.string().trim().max(TAGS_MAX, "标签过长").optional().default(""),
  externalUrl: z.string().trim().refine(urlLike, "下载地址需为 http(s):// 或站内附件路径"),
});

export type ResourceTextFields = z.infer<typeof resourceTextFields>;
