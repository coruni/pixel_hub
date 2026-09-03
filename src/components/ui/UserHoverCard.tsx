"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import { formatCount } from "@/lib/format";

export type HoverCardUser = {
  username: string;
  name: string | null;
  avatarKey?: string | null;
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
 * hover 用户头像显示信息卡：包裹任意触发元素（通常是 Avatar），
 * 延迟 300ms 出现，展示昵称/用户名/简介/身份徽标/统计，点击卡片进入主页。
 */
export default function UserHoverCard({ user, children }: { user: HoverCardUser; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const roleLabel = user.role ? ROLE_LABEL[user.role] : undefined;
  const stats: [string, number][] = [
    ["作品", user.resourceCount ?? 0],
    ["关注者", user.followerCount ?? 0],
  ];
  const hasStats = user.resourceCount !== undefined || user.followerCount !== undefined;

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setOpen(true), 300);
      }}
      onMouseLeave={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        // 头像+昵称区域是链接（进主页），其余部分仅展示
        <span className="absolute top-full left-0 z-40 mt-1.5 block w-56 rounded-none border border-brand-200 bg-surface p-3 shadow-lg">
          <Link href={`/u/${user.username}`} className="flex items-center gap-2.5">
            <Avatar name={user.name} username={user.username} avatarKey={user.avatarKey} size="md" online={user.online} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-neutral-900">{user.name ?? user.username}</span>
                {user.online && (
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
          {user.bio && <span className="mt-2 block line-clamp-3 text-xs leading-5 text-neutral-600">{user.bio}</span>}
          {hasStats && (
            <span className="mt-2.5 flex items-center gap-4 border-t border-neutral-100 pt-2.5">
              {stats.map(([label, n]) => (
                <span key={label} className="text-xs text-neutral-500">
                  {label} <span className="font-medium text-neutral-800 tabular-nums">{formatCount(n)}</span>
                </span>
              ))}
              {user.joinedAt && (
                <span className="ml-auto text-[11px] text-neutral-400">{formatJoined(user.joinedAt)}</span>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function formatJoined(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()} 年加入`;
}
