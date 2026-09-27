// 音视频控件的按钮原语 —— 播放器的分P 列表（av-playlist）与字幕开关（av-captions）共用。
//
// 单独立一个文件而不是让其中一个 import 另一个：两边是平级的功能模块，
// 「字幕开关要用列表的按钮样式」不构成依赖关系。
//
// 色调语义见 @/lib/ui/cls：onDark = 压在视频画面上（半透明白），onSurface = 落在暖白卡片里。

import {
  AV_CTRL_ON_DARK,
  AV_CTRL_ON_DARK_ACTIVE,
  AV_CTRL_ON_SURFACE,
  AV_CTRL_ON_SURFACE_ACTIVE,
} from "@/lib/ui/cls";

export type AvTone = "onDark" | "onSurface";
/** md = 控件行里的小方块；lg = 压在视频画面上的大方块（带半透明底，垫在亮画面上才看得清） */
export type AvBtnSize = "md" | "lg";

/** 色调 → 常规 / 激活两串类名。激活态**整串替换**，避免同属性类名互相覆盖 */
export const AV_TONE = {
  onDark: { off: AV_CTRL_ON_DARK, on: AV_CTRL_ON_DARK_ACTIVE },
  onSurface: { off: AV_CTRL_ON_SURFACE, on: AV_CTRL_ON_SURFACE_ACTIVE },
} as const;

// 不用 AV_CTRL_BTN：常量里写死了 h-9 w-9，再追加 h-11 会和它撞同一个属性
// （Tailwind 同属性类的产物顺序不可依赖），这里按尺寸拼。
export const AV_BTN =
  "grid shrink-0 place-items-center rounded-none transition focus-visible:ring-2 focus-visible:ring-brand-400";
export const AV_BTN_SIZE: Record<AvBtnSize, string> = { md: "h-9 w-9", lg: "h-11 w-11" };

/**
 * 带文本的自适应宽度按钮（如字幕切轨的「2/3」）只取高度。
 * 不能复用 AV_BTN_SIZE：那里写死了 w-9，再追加 w-auto 是同属性冲突，
 * 而 Tailwind 同属性类的产物顺序不保证 —— 会随机变成固定 36px 把文本挤出去。
 */
export const AV_BTN_HEIGHT: Record<AvBtnSize, string> = { md: "h-9", lg: "h-11" };
