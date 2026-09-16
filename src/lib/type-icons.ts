// 内容类型 → 角标图标/配色（资源卡、详情页横幅等共用；新增类型只改这一张表）。
// 配色按深色封面/横幅底设计，放在深色背景上对比度足够。
import { Film, Gamepad2, Image as ImageIcon, Music, Newspaper, type LucideIcon } from "lucide-react";

export const TYPE_BADGE: Record<string, { Icon: LucideIcon; cls: string }> = {
  GAME: { Icon: Gamepad2, cls: "text-emerald-300" },
  ARTICLE: { Icon: Newspaper, cls: "text-sky-300" },
  MUSIC: { Icon: Music, cls: "text-brand-300" },
  VIDEO: { Icon: Film, cls: "text-red-300" },
  IMAGE: { Icon: ImageIcon, cls: "text-amber-300" },
};

/** 取类型角标（未知类型回退图片图标），避免调用方各自处理兜底 */
export function typeBadge(type: string) {
  return TYPE_BADGE[type] ?? TYPE_BADGE.IMAGE;
}
