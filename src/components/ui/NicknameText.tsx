import { nameColorBrightClass, nameColorClass } from "@/lib/decorations";

/**
 * 昵称所在底色的口径。
 * - light：跟随明暗主题的页面底（surface / 卡片正文）→ 用 --nick-* 主题色
 * - dark：**不随主题变化**的固定深底（资源卡底部黑条、hero 大图遮罩）→ 用 --nick-*-bright 亮阶
 *
 * 为什么由调用方声明，而不是组件自己判断：两套亮阶区间互斥（浅底要求相对亮度 ≤0.17，
 * 黑底要求 ≥0.21），同一组色值不可能两边都达标；而「这处底是深是浅」只有渲染点知道。
 * 传错不会报错，只会静默变成对比度不足 —— 新增昵称渲染点前先确认底色。
 */
export type NicknameTone = "light" | "dark";

export type NicknameTextProps = {
  /** 展示名；为空回退 username */
  name?: string | null;
  username: string;
  /** 用户选的昵称色 key（User.nameColor）；null / 未知 = 站点默认前景色 */
  color?: string | null;
  /**
   * 昵称特效色总开关（后台 incentive.decoration.nicknameEnabled）。默认 true，与 lib/decorations.ts 同口径。
   *
   * 服务端渲染点**优先用 <Nickname>**（自动读配置，不必手传）；只有「本组件已经读到开关、还要顺手转交
   * 给别的子组件」时（如详情页 AuthorIdentity 同时要喂 UserHoverCard）才在这里直接传，别重复读配置。
   * **客户端组件必须显式传** —— 它读不到服务端配置。
   */
  enabled?: boolean;
  /** 所在底色，默认 light */
  tone?: NicknameTone;
  /** 未启用 / 未选色时的前景类名，按所在位置传（如 text-neutral-800） */
  fallbackClassName?: string;
  /**
   * 额外类名。**只放排版类**（truncate / 字号 / 字重 / hover）；
   * 颜色由本组件决定，写在这里也会被盖掉（颜色类固定排在最后）。
   */
  className?: string;
};

/**
 * 昵称渲染原子 —— 全站昵称色的唯一出口。它只做三件事：选色阶、兜底默认色、name 为空时回退 username。
 *
 * 本文件不带 "use client"，也不引任何 server 依赖，因此服务端与客户端组件都能用
 * （被客户端组件引用时随之一并进客户端包）。服务端渲染点优先用 <Nickname>，见同目录 Nickname.tsx。
 */
export default function NicknameText({
  name,
  username,
  color,
  enabled = true,
  tone = "light",
  fallbackClassName,
  className,
}: NicknameTextProps) {
  const tint =
    tone === "dark" ? nameColorBrightClass(color, enabled) : nameColorClass(color, enabled);
  // 颜色类固定排最后：调用方即使误在 className 里写了 text-* 颜色，也不会盖掉特效色
  const cls = [className, tint ?? fallbackClassName].filter(Boolean).join(" ");
  return <span className={cls || undefined}>{name ?? username}</span>;
}
