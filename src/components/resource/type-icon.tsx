import {
  Film,
  Gamepad2,
  Image as ImageIcon,
  Music,
  Newspaper,
  type LucideIcon,
} from "lucide-react";

/**
 * 资源类型 → 图标 / 徽标配色：**唯一一张表**，资源卡角标与详情页「类型」行共用。
 * 新增类型只改这里，两个调用点自动跟上。
 */
export const TYPE_ICON: Record<string, LucideIcon> = {
  GAME: Gamepad2,
  ARTICLE: Newspaper,
  MUSIC: Music,
  VIDEO: Film,
  IMAGE: ImageIcon,
};

/**
 * 卡片封面左上角角标的图标配色。底色是**固定深色**遮罩（bg-stone-900/85，不随主题变化），
 * 所以这里固定取亮阶；详情页的类型图标在会跟随明暗的 surface 上，不能用这一组。
 */
export const TYPE_BADGE_TONE: Record<string, string> = {
  GAME: "text-emerald-300",
  ARTICLE: "text-sky-300",
  MUSIC: "text-brand-300",
  VIDEO: "text-red-300",
  IMAGE: "text-amber-300",
};

/**
 * 类型图标。纯装饰（aria-hidden），类型名由调用方以可见文字或 sr-only 文案给出，
 * 保证「类型」不只靠图标表达。
 */
export function TypeIcon({
  type,
  size = 11,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const Icon = TYPE_ICON[type] ?? ImageIcon;
  return <Icon size={size} className={className} aria-hidden />;
}
