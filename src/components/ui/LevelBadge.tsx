import { Award, Crown, Palette, PenLine, Sparkles, Sprout, type LucideIcon } from "lucide-react";
import { levelBadgeClass } from "@/lib/points-config";

/**
 * 等级图标与颜色一律**不落库**（配置里只存 name/min）：
 * Tailwind 只扫描源码字面量类名、图标也只能静态引入 —— 把类名或图标名塞进数据库
 * 等于让它们编译不出来。档位超过色板长度时循环取用（与 levelBadgeClass 同一策略）。
 */
const LEVEL_ICONS: LucideIcon[] = [Sprout, PenLine, Palette, Award, Sparkles, Crown];

/**
 * 贡献分等级徽章。纯粹展示，无交互。
 *
 * 颜色只取 brand / neutral / amber / red 四个色阶 —— 这四支在 `html.dark` 下都有重定义；
 * **emerald 没有暗色覆盖**（浅底浅字在暗色下会糊掉），所以刻意不用（存量「免审发布」徽章那个问题是另一件事）。
 * 文字名即无障碍名称，图标 `aria-hidden`。
 */
export default function LevelBadge({
  level,
  name,
  size = "sm",
  className = "",
}: {
  level: number;
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = LEVEL_ICONS[Math.abs(level) % LEVEL_ICONS.length] ?? Sprout;
  const box = size === "md" ? "gap-1 px-2 py-0.5 text-[11px]" : "gap-1 px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-none border font-medium ${box} ${levelBadgeClass(level)} ${className}`}
      title={`贡献分等级 · ${name}`}
    >
      <Icon size={size === "md" ? 12 : 10} aria-hidden />
      {name}
    </span>
  );
}
