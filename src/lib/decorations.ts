// 昵称特效色目录 —— 纯数据层（不依赖 server，前后端与 seed 共用）。
//
// 【为什么清单和门槛硬编码在这里，而不是进后台配置】
//   ① 色值必须落成 Tailwind **字面量**类名（只扫源码），清单天生是源码级资产；
//   ② 「哪一档解锁哪个色」是设计决策，写在色值旁边才改得动、看得懂。
//   后台只留功能开关（见 points-config.ts 的 incentive.decoration），不重复定义清单。
//
// 【口径】装饰一律走**贡献分等级门槛**、**不扣分**。贡献分是荣誉层（只增不减），
//   扣它等于掉级，会连带把已达标的其他装饰一起打回锁定。

/** 昵称特效色。颜色是「游戏属性色」，亮暗各一套值由 globals.css 的 --nick-* 承载 */
export type NameColor = {
  key: string;
  name: string;
  /** 解锁等级序号（0 起，0 = 不限） */
  minLevel: number;
  /** 文字色类名（跟随明暗主题，用于页面浅底）。必须是完整字面量，Tailwind 才扫得到 */
  className: string;
  /** 深底专用亮色类名：资源卡底部黑条、hero 大图上的署名。这两类底不随主题变化 */
  brightClassName: string;
};

/**
 * 8 款昵称特效色，按等级从低到高。
 * 门槛分配刻意做成阶梯：低等级给两个基础色，越往上越稀有的色才开放。
 */
export const NAME_COLORS: readonly NameColor[] = [
  {
    key: "flame",
    name: "烈焰",
    minLevel: 1,
    className: "text-nick-flame",
    brightClassName: "text-nick-flame-bright",
  },
  {
    key: "frost",
    name: "冰霜",
    minLevel: 1,
    className: "text-nick-frost",
    brightClassName: "text-nick-frost-bright",
  },
  {
    key: "venom",
    name: "剧毒",
    minLevel: 2,
    className: "text-nick-venom",
    brightClassName: "text-nick-venom-bright",
  },
  {
    key: "thunder",
    name: "雷电",
    minLevel: 2,
    className: "text-nick-thunder",
    brightClassName: "text-nick-thunder-bright",
  },
  {
    key: "abyss",
    name: "深渊",
    minLevel: 3,
    className: "text-nick-abyss",
    brightClassName: "text-nick-abyss-bright",
  },
  {
    key: "shadow",
    name: "暗影",
    minLevel: 3,
    className: "text-nick-shadow",
    brightClassName: "text-nick-shadow-bright",
  },
  {
    key: "radiance",
    name: "圣光",
    minLevel: 4,
    className: "text-nick-radiance",
    brightClassName: "text-nick-radiance-bright",
  },
  {
    key: "blood",
    name: "血月",
    minLevel: 5,
    className: "text-nick-blood",
    brightClassName: "text-nick-blood-bright",
  },
];

/**
 * 装饰解锁判定。与 upload-config.ts 的 profileBgUnlocked() 同构、同纪律：
 * **门槛 0 = 不限**；激励总开关关掉时等级不存在，门槛随之失效（否则会给全员上锁且无提升途径）。
 * 设置页表单与 Server Action 必须共用这一个函数。
 */
export function decorationUnlocked(level: number, minLevel: number, enabled = true): boolean {
  if (!enabled) return true;
  return minLevel <= 0 || level >= minLevel;
}

/** key → 昵称色定义。未知/空 key 返回 null（= 用站点默认前景色） */
export function nameColorOf(key: string | null | undefined): NameColor | null {
  if (!key) return null;
  return NAME_COLORS.find((c) => c.key === key) ?? null;
}

/**
 * 昵称色类名（**渲染用**）。只看「有没有值 + 功能开关」，不做等级实时判定。
 *
 * 为什么不像背景那样实时判等级：昵称出现在资源卡、评论、详情页、悬浮卡等几十个渲染点，
 * 逐点回查作者等级既贵又散；而门槛在**设置时**已经把过一次关（见 lib/actions/decorations.ts），
 * 且贡献分只增不减、装饰本身也不扣分，正常使用下不存在「掉了级还留着色」的场景。
 * 功能总开关仍在这里生效 —— 管理员一键关闭时，存量配色立即停止渲染。
 *
 * **渲染处别直接调本函数**，走 components/ui/NicknameText：由它按底色选这一支还是亮阶那一支。
 */
export function nameColorClass(key: string | null | undefined, enabled = true): string | null {
  if (!enabled) return null;
  return nameColorOf(key)?.className ?? null;
}

/**
 * 深底专用亮色类名。用于**底色不随主题变化**的两处：资源卡底部黑色遮罩、hero 大图上的署名。
 * 这两处的底永远是深色，用 nameColorClass 会在亮色主题下给出深色值（对比度不足），必须走这一支。
 *
 * 同样地，渲染处不要直接调本函数，走 components/ui/NicknameText 的 tone="dark"。
 */
export function nameColorBrightClass(
  key: string | null | undefined,
  enabled = true,
): string | null {
  if (!enabled) return null;
  return nameColorOf(key)?.brightClassName ?? null;
}
