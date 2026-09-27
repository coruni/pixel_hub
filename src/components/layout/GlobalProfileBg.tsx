"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";

// 主页背景「全局显示」：把当前登录用户自己的主页背景铺到**全站每一页**（后台除外）。
//
// 【渲染写法与资源详情页 / 个人主页完全一致】
//   profile-bg-pc / profile-bg-mobile + fixed inset-0 -z-10 + bg-cover bg-center + 内联 --profile-bg-mask。
//   三处（这里 / 资源页 / 个人主页）共用同一套遮罩类，改一处形状三处一起变。
//
// 【两个槽位，按断点互斥】
//   桌面端与移动端是两张独立的图（横图 / 竖图）、各配一份遮罩，display 由 Tailwind 的
//   `hidden sm:block` / `sm:hidden` 控制。只设了一端时另一端**不渲染** —— 不做跨槽回落，
//   把横图塞进竖屏会被 cover 裁得看不出原图，比素底更像坏了（与个人主页 / 资源页同口径）。
//
// 【后台怎么排除 —— 用路由判断】
//   根 layout 在 Server Component 里拿不到 pathname，但本层是纯展示、本来就该是客户端组件，
//   直接用 usePathname() 判前缀即可。不需要「同层叠色盖住」那种绕法。
//
// 【优先级：页面自己铺的背景高于全局层】
//   资源详情页上作者的背景优先于访客自己的全局背景 —— 作者在自己的页面上话语权更高。
//   实现是**纯 CSS**（见 globals.css）：页面把作者背景层标上 data-profile-bg-owner-pc /
//   -mobile，全局层标上 data-profile-bg-global-pc / -mobile，由
//       body:has([data-profile-bg-owner-pc]) [data-profile-bg-global-pc] { display: none }
//   （移动端那一对同理，各自包在自己的媒体查询里）隐掉全局层。
//
//   为什么按槽位 + 断点拆成两对而不是一条通用规则：两个槽位是靠 Tailwind 的 hidden / sm:hidden
//   互斥显示的，而 `:has()` 看的是「元素在不在 DOM 里」、不看它是否 display:none。用一条不分
//   断点的规则会串槽 —— 作者只设了桌面端那张图时，移动端的 owner 元素照样在 DOM 里，
//   于是移动端的全局背景被无理由隐掉，而它本该照常显示。
//
//   为什么不在客户端判断「作者开没开、达没达等级」：那些信息在服务端，本层在根 layout 拿不到；
//   复制一遍服务端口径既贵又会在门槛/开关变更后走偏。判断**渲染结果**（页面上有没有那一层）
//   天然与上游口径同步 —— 上游不管怎么改，这里都不用动。
//
//   为什么不用 MutationObserver + state 自隐：SSR 首帧拿不到 DOM，只能先假设「没有」
//   （→ 会闪一帧自己的背景）或先假设「有」（→ 全站每页都闪一帧空白）。:has() 是渲染期求值，
//   零闪烁、零 JS、零 hydration 差异。
//
// 【「全局显示」是**自见**开关 —— 它不会把谁的背景推给别人】
//   本层取的是「当前登录者自己」的 User（见 GlobalProfileBgLoader 的 where: { id: userId }），
//   所以开了全局显示只是**自己**在更多页面上看到自己的背景；它不改变资源页上「铺谁」的判定，
//   也不让别人的页面出现你的背景。资源详情页到底铺谁，只由两件事决定：
//     ① 作者有图 + 达等级 + 「资源页对他人可见」开着 → 铺作者的，访客自己的全局层被隐掉；
//     ② 其余情况（作者没图 / 未达等级 / 没开对他人可见）→ 访客自己的全局背景照常铺。
//   作者看自己的页面时不受那个开关约束（资源页 isOwnResourcePage、个人主页无条件铺）
//   —— 开关只约束别人，不约束作者自己。
//
// 【别人的个人主页：一律不铺】（见下方 myUsername 判断）
//   那是对方的展示空间，哪怕对方没设背景也保持素底 —— 不拿我的背景去填别人的主页。
//   自己的主页照常铺（那里 owner 层就是自己，由 :has() 保证只剩一层）。
//   注意这条与上面的「owner 存在才让位」是两回事：资源页上作者没背景时仍会回落
//   显示我的全局背景，个人主页则**不回落**（显式排除）。
export default function GlobalProfileBg({
  pcUrl,
  mobileUrl,
  pcMask,
  mobileMask,
  myUsername,
}: {
  /** 服务端算好的**桌面端**背景图 URL；null = 该槽无背景 / 未开全局 / 未达等级 */
  pcUrl: string | null;
  /** 服务端算好的**移动端**背景图 URL；null 同上（两槽各自独立，不做回落） */
  mobileUrl: string | null;
  /** 服务端校验过的桌面端遮罩值 */
  pcMask: string;
  /** 服务端校验过的移动端遮罩值 */
  mobileMask: string;
  /** 当前登录用户自己的 username，用于识别「/u/xxx 是不是我自己的主页」 */
  myUsername: string;
}) {
  const pathname = usePathname();
  // 后台整段不铺（用户口径：除后台外的所有页面）
  if ((!pcUrl && !mobileUrl) || pathname?.startsWith("/admin")) return null;

  // 别人的个人主页：一律不铺自己的全局背景 —— 那是对方的展示空间，
  // 哪怕对方没设背景也保持素底，不要拿我的背景去填别人的主页。
  // 自己的主页照常铺（那里 owner 层就是自己，由 :has() 规则保证只剩一层）。
  const profileUser = pathname?.match(/^\/u\/([^/]+)/)?.[1];
  if (profileUser && decodeURIComponent(profileUser) !== myUsername) return null;

  return (
    <>
      {pcUrl && (
        <div
          aria-hidden
          data-profile-bg-global-pc
          className="profile-bg-pc pointer-events-none fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat sm:block"
          style={{ backgroundImage: `url(${pcUrl})`, "--profile-bg-mask": pcMask } as CSSProperties}
        />
      )}
      {mobileUrl && (
        <div
          aria-hidden
          data-profile-bg-global-mobile
          className="profile-bg-mobile pointer-events-none fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat sm:hidden"
          style={
            {
              backgroundImage: `url(${mobileUrl})`,
              "--profile-bg-mask": mobileMask,
            } as CSSProperties
          }
        />
      )}
    </>
  );
}
