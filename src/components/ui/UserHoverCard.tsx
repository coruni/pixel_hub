"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import NicknameText from "@/components/ui/NicknameText";
import { useLiveOnline } from "@/lib/realtime/use-realtime";
import { formatCount } from "@/lib/format";

export type HoverCardUser = {
  id?: string;
  username: string;
  name: string | null;
  avatarKey?: string | null;
  /** 昵称特效色 key（User.nameColor）；缺省 = 站点默认前景色 */
  nameColor?: string | null;
  // 统计与身份信息可缺省：缺省时对应区块不渲染
  bio?: string | null;
  role?: string;
  trusted?: boolean;
  resourceCount?: number;
  followerCount?: number;
  joinedAt?: string | Date;
  online?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "管理员",
  MODERATOR: "版主",
};

/**
 * hover 用户头像显示信息卡：包裹任意触发元素（通常是 Avatar），展示昵称/用户名/简介/
 * 身份徽标/统计，点击卡片进入主页。
 *
 * 显隐**纯 CSS**（group-hover / group-focus-within），不用任何鼠标事件。下面三点缺任一条，
 * 指针从头像移向弹层时都会提前收起（表现就是「弹层点不进去」）：
 * ① 触发器与弹层之间的 6px 间隙做成**桥接层的 padding**（不是 margin）——绝对定位的 margin
 *    间隙不属于任何元素的盒，指针划过去时 .group 就丢了 :hover；做成 padding 后这段间隙
 *    本身就是容器的子孙盒，:hover 沿命中链一路传回 .group。
 * ② 弹层常驻 DOM、用 visibility 控制显隐：:hover 依赖命中测试，弹层一旦不可命中，指针进到
 *    弹层上就断链了。所以不能用 display:none，也不能用立即切换的 visibility。
 * ③ 关侧靠 `transition-[opacity,visibility] duration-150` 撑出 150ms 缓冲：visibility 是离散
 *    可过渡属性，过渡进度落在 0~1 之间时插值结果仍是 visible —— 也就是「刚离开的 150ms 内
 *    弹层依然可命中」，足够指针移到弹层上把 :hover 续上。开侧同一过渡即时生效，不影响手感。
 * 键盘可达性由 group-focus-within 承担：触发器（头像链接）获得焦点即展开，弹层内的链接
 * 才能被 Tab 到。
 */
export default function UserHoverCard({
  user,
  nicknameEnabled = true,
  children,
}: {
  user: HoverCardUser;
  /** 昵称特效色开关（后台 incentive.decoration.nicknameEnabled）；客户端组件读不到配置，由服务端调用方转交 */
  nicknameEnabled?: boolean;
  children: ReactNode;
}) {
  const roleLabel = user.role ? ROLE_LABEL[user.role] : undefined;
  const liveOnline = useLiveOnline(user.id, user.online ?? false);
  const stats: [string, number][] = [
    ["作品", user.resourceCount ?? 0],
    ["关注者", user.followerCount ?? 0],
  ];
  const hasStats = user.resourceCount !== undefined || user.followerCount !== undefined;

  return (
    <span className="group relative inline-flex">
      {children}
      {/* 触发器与弹层之间的 6px 桥接区：外层 span 只负责这段 padding，弹层本体在内层 block 里，
          指针从触发器滑到弹层的整条路径都落在本容器的子树内 → .group 的 :hover 不断。
          弹层头部是链接（进主页），其余部分仅展示。 */}
      <span className="invisible absolute top-full left-0 z-40 block w-56 pt-1.5 opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <span className="block rounded-none border border-brand-300 bg-surface p-3 shadow-lg">
          <Link href={`/u/${user.username}`} className="flex items-center gap-2.5">
            <PresenceAvatar
              userId={user.id}
              name={user.name}
              username={user.username}
              avatarKey={user.avatarKey}
              size="md"
              online={liveOnline}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {/* 弹层是浅底（bg-surface）→ 默认 tone="light" */}
                <NicknameText
                  name={user.name}
                  username={user.username}
                  color={user.nameColor}
                  enabled={nicknameEnabled}
                  className="truncate text-sm font-semibold"
                  fallbackClassName="text-neutral-900"
                />
                {liveOnline && (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-none border border-emerald-600 bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 bg-emerald-500" aria-hidden /> 在线
                  </span>
                )}
                {roleLabel && (
                  <span className="shrink-0 rounded-none border border-brand-600 bg-stone-900/85 px-1.5 py-px text-[10px] font-medium text-white">
                    {roleLabel}
                  </span>
                )}
                {user.trusted && !roleLabel && (
                  <span className="shrink-0 rounded-none border border-emerald-600 bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
                    认证
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-neutral-500">@{user.username}</span>
            </span>
          </Link>
          {user.bio && (
            <span className="mt-2 block line-clamp-3 text-xs leading-5 text-neutral-600">
              {user.bio}
            </span>
          )}
          {hasStats && (
            <span className="rule-dot-t mt-2.5 flex items-center gap-4 pt-2.5">
              {stats.map(([label, n]) => (
                <span key={label} className="text-xs text-neutral-500">
                  {label}{" "}
                  <span className="font-medium text-neutral-800 tabular-nums">
                    {formatCount(n)}
                  </span>
                </span>
              ))}
              {user.joinedAt && (
                <span className="ml-auto text-[11px] text-neutral-400">
                  {formatJoined(user.joinedAt)}
                </span>
              )}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

function formatJoined(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()} 年加入`;
}
