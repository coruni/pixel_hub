// 装饰目录 —— 纯数据层（不依赖 server，前后端与 seed 共用）。
//
// 【为什么清单和门槛硬编码在这里，而不是进后台配置】
//   ① 昵称色值必须落成 Tailwind **字面量**类名（只扫源码），清单天生是源码级资产；
//   ② 官方背景是随仓库发布的静态资源，后台不可能新增；
//   ③ 「哪一档解锁哪个色」是设计决策，写在色值旁边才改得动、看得懂。
//   后台只留功能开关（见 points-config.ts 的 incentive.decoration），不重复定义清单。
//
// 【口径】装饰一律走**贡献分等级门槛**、**不扣分**。贡献分是荣誉层（只增不减），
//   扣它等于掉级，会连带把已达标的其他装饰一起打回锁定 —— 见 profileBgUnlocked 同款纪律。

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
  /** 设置页色块底色类名（与 className 同源，避免两处各写一个色） */
  swatchClass: string;
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
    swatchClass: "bg-nick-flame",
  },
  {
    key: "frost",
    name: "冰霜",
    minLevel: 1,
    className: "text-nick-frost",
    brightClassName: "text-nick-frost-bright",
    swatchClass: "bg-nick-frost",
  },
  {
    key: "venom",
    name: "剧毒",
    minLevel: 2,
    className: "text-nick-venom",
    brightClassName: "text-nick-venom-bright",
    swatchClass: "bg-nick-venom",
  },
  {
    key: "thunder",
    name: "雷电",
    minLevel: 2,
    className: "text-nick-thunder",
    brightClassName: "text-nick-thunder-bright",
    swatchClass: "bg-nick-thunder",
  },
  {
    key: "abyss",
    name: "深渊",
    minLevel: 3,
    className: "text-nick-abyss",
    brightClassName: "text-nick-abyss-bright",
    swatchClass: "bg-nick-abyss",
  },
  {
    key: "shadow",
    name: "暗影",
    minLevel: 3,
    className: "text-nick-shadow",
    brightClassName: "text-nick-shadow-bright",
    swatchClass: "bg-nick-shadow",
  },
  {
    key: "radiance",
    name: "圣光",
    minLevel: 4,
    className: "text-nick-radiance",
    brightClassName: "text-nick-radiance-bright",
    swatchClass: "bg-nick-radiance",
  },
  {
    key: "blood",
    name: "血月",
    minLevel: 5,
    className: "text-nick-blood",
    brightClassName: "text-nick-blood-bright",
    swatchClass: "bg-nick-blood",
  },
];

/** 官方背景库预设。静态资源随仓库发布在 public/bg/ 下，见同目录 README 说明 */
export type ProfileBgPreset = {
  id: string;
  name: string;
  minLevel: number;
  /** public 下的绝对路径（交给 CSS background-image，不经过存储驱动） */
  url: string;
  /** 卡片预览用的主色调类名，缺图时兜底 */
  swatchClass: string;
};

export const PROFILE_BG_PRESETS: readonly ProfileBgPreset[] = [
  {
    id: "lava",
    name: "熔岩",
    minLevel: 1,
    url: "/bg/lava.svg",
    swatchClass: "bg-nick-flame",
  },
  {
    id: "glacier",
    name: "冰川",
    minLevel: 1,
    url: "/bg/glacier.svg",
    swatchClass: "bg-nick-frost",
  },
  {
    id: "nebula",
    name: "星野",
    minLevel: 2,
    url: "/bg/nebula.svg",
    swatchClass: "bg-nick-shadow",
  },
  {
    id: "trench",
    name: "深海",
    minLevel: 2,
    url: "/bg/trench.svg",
    swatchClass: "bg-nick-abyss",
  },
  {
    id: "swamp",
    name: "沼泽",
    minLevel: 3,
    url: "/bg/swamp.svg",
    swatchClass: "bg-nick-venom",
  },
  {
    id: "storm",
    name: "雷暴",
    minLevel: 3,
    url: "/bg/storm.svg",
    swatchClass: "bg-nick-thunder",
  },
  {
    id: "sanctum",
    name: "圣殿",
    minLevel: 4,
    url: "/bg/sanctum.svg",
    swatchClass: "bg-nick-radiance",
  },
  {
    id: "eclipse",
    name: "月蚀",
    minLevel: 4,
    url: "/bg/eclipse.svg",
    swatchClass: "bg-nick-blood",
  },
];

/**
 * 装饰解锁判定。与 upload-config.ts 的 profileBgUnlocked() 同构、同纪律：
 * **门槛 0 = 不限**；激励总开关关掉时等级不存在，门槛随之失效（否则会给全员上锁且无提升途径）。
 * 前台渲染、设置页表单、Server Action 三处必须共用这一个函数。
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
 * 昵称色类名（**渲染用**）。
 *
 * 与背景预设**刻意不同**：这里不做等级实时判定，只看「有没有值 + 功能开关」。
 * 原因是昵称出现在资源卡、评论、详情页、悬浮卡等几十个渲染点，逐点回查作者等级既贵又散；
 * 而门槛在**设置时**已经把过一次关（见 lib/actions/decorations.ts），且贡献分只增不减、
 * 装饰本身也不扣分，正常使用下不存在「掉了级还留着色」的场景。
 * 功能总开关仍在这里生效 —— 管理员一键关闭时，存量配色立即停止渲染。
 */
export function nameColorClass(key: string | null | undefined, enabled = true): string | null {
  if (!enabled) return null;
  return nameColorOf(key)?.className ?? null;
}

/**
 * 深底专用亮色类名。用于**底色不随主题变化**的两处：资源卡底部黑色遮罩、hero 大图上的署名。
 * 这两处的底永远是深色，用 nameColorClass 会在亮色主题下给出深色值（对比度不足），必须走这一支。
 */
export function nameColorBrightClass(
  key: string | null | undefined,
  enabled = true,
): string | null {
  if (!enabled) return null;
  return nameColorOf(key)?.brightClassName ?? null;
}

/** id → 官方背景预设。未知/空 id 返回 null（= 回落自传图或不着色） */
export function bgPresetOf(id: string | null | undefined): ProfileBgPreset | null {
  if (!id) return null;
  return PROFILE_BG_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * 官方背景预设的可渲染 URL：**服务端重算等级**后再给前台，与 nameColorClassOf 同纪律。
 * 返回 null 表示「该用户当前不可用这张预设」，调用方回落到自传背景。
 */
export function bgPresetUrlOf(
  id: string | null | undefined,
  level: number,
  enabled = true,
): string | null {
  const p = bgPresetOf(id);
  if (!p) return null;
  return decorationUnlocked(level, p.minLevel, enabled) ? p.url : null;
}
