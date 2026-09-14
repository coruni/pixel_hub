import { redirect } from "next/navigation";

/**
 * 草稿箱已并入账户设置 · 发布分组（草稿开关与草稿列表同屏）。
 * 这里保留一条重定向：旧书签、历史外链和已登录用户手里的老链接都不会 404。
 */
export default function DraftsPage() {
  redirect("/settings?tab=publish#drafts");
}
