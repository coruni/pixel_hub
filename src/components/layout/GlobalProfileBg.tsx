"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";

// 主页背景「全局显示」：把当前登录用户自己的主页背景铺到**全站每一页**（后台除外）。
//
// 【渲染写法与资源详情页 / 个人主页完全一致】
//   profile-bg-pc + fixed inset-0 -z-10 + bg-cover bg-center + 内联 --profile-bg-mask。
//   三处（这里 / 资源页 / 个人主页）共用同一个遮罩类，改一处形状三处一起变。
//
// 【后台怎么排除 —— 用路由判断】
//   根 layout 在 Server Component 里拿不到 pathname，但本层是纯展示、本来就该是客户端组件，
//   直接用 usePathname() 判前缀即可。不需要「同层叠色盖住」那种绕法。
//
// 【优先级：页面自己铺的背景高于全局层】
//   资源详情页上作者的背景优先于访客自己的全局背景 —— 作者在自己的页面上话语权更高。
//   实现是**纯 CSS**（见 globals.css）：页面把作者背景层标上 data-profile-bg-owner，
//   全局层标上 data-profile-bg-global，由
//       body:has([data-profile-bg-owner]) [data-profile-bg-global] { display: none }
//   隐掉全局层。
//
//   为什么不在客户端判断「作者开没开、达没达等级」：那些信息在服务端，本层在根 layout 拿不到；
//   复制一遍服务端口径既贵又会在门槛/开关变更后走偏。判断**渲染结果**（页面上有没有那一层）
//   天然与上游口径同步 —— 上游不管怎么改，这里都不用动。
//
//   为什么不用 MutationObserver + state 自隐：SSR 首帧拿不到 DOM，只能先假设「没有」
//   （→ 会闪一帧自己的背景）或先假设「有」（→ 全站每页都闪一帧空白）。:has() 是渲染期求值，
//   零闪烁、零 JS、零 hydration 差异。
//
// 【别人的个人主页：一律不铺】（见下方 myUsername 判断）
//   那是对方的展示空间，哪怕对方没设背景也保持素底 —— 不拿我的背景去填别人的主页。
//   自己的主页照常铺（那里 owner 层就是自己，由 :has() 保证只剩一层）。
//   注意这条与上面的「owner 存在才让位」是两回事：资源页上作者没背景时仍会回落
//   显示我的全局背景，个人主页则**不回落**（显式排除）。
export default function GlobalProfileBg({
  url,
  mask,
  myUsername,
}: {
  /** 服务端算好的背景图 URL；null = 无背景 / 未开全局 / 未达等级 */
  url: string | null;
  /** 服务端校验过的遮罩值 */
  mask: string;
  /** 当前登录用户自己的 username，用于识别「/u/xxx 是不是我自己的主页」 */
  myUsername: string;
}) {
  const pathname = usePathname();
  // 后台整段不铺（用户口径：除后台外的所有页面）
  if (!url || pathname?.startsWith("/admin")) return null;

  // 别人的个人主页：一律不铺自己的全局背景 —— 那是对方的展示空间，
  // 哪怕对方没设背景也保持素底，不要拿我的背景去填别人的主页。
  // 自己的主页照常铺（那里 owner 层就是自己，由 :has() 规则保证只剩一层）。
  const profileUser = pathname?.match(/^\/u\/([^/]+)/)?.[1];
  if (profileUser && decodeURIComponent(profileUser) !== myUsername) return null;

  return (
    <div
      aria-hidden
      data-profile-bg-global
      className="profile-bg-pc pointer-events-none fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat sm:block"
      style={{ backgroundImage: `url(${url})`, "--profile-bg-mask": mask } as CSSProperties}
    />
  );
}
