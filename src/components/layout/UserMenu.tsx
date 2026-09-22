"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Coins,
  LayoutDashboard,
  LogOut,
  Bell,
  Settings,
  Upload,
  User,
} from "lucide-react";
import { logoutAction } from "@/lib/actions";
import Avatar from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { NAV_CONTROL_H } from "@/lib/ui/cls";

export type MenuUser = {
  name: string | null;
  username: string;
  role: string;
  trusted: boolean;
  avatarKey?: string | null;
};

/** 顶部导航右侧的用户菜单：头像 + 下拉（个人主页/通知/代币/设置/发布/管理/退出）。草稿箱已并入账户设置。 */
export default function UserMenu({
  user,
  unread = 0,
  showCoins = false,
}: {
  user: MenuUser;
  unread?: number;
  /** 激励体系开启时才出现「我的代币」（关闭后留一个 0 余额的死链更糟） */
  showCoins?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(unread);
  const boxRef = useRef<HTMLDivElement>(null);

  // 未读角标：初值来自服务端（导航时已是最新），之后每 60s（页面可见时）自动校正一次，
  // 让角标不至于「必须刷新页面才更新」——通知本来就是越及时越有用。
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { unread?: number };
        if (alive && typeof data.unread === "number") setUnreadCount(data.unread);
      } catch {
        // 角标拉取失败静默：等下一次心跳，不影响任何主流程
      }
    };
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
  const itemCls =
    "flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-sm text-neutral-700 transition hover:bg-brand-50 hover:text-neutral-900";

  return (
    <div ref={boxRef} className="relative">
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${NAV_CONTROL_H} flex items-center gap-1.5 rounded-none pl-1 pr-2 text-sm text-neutral-700 transition hover:bg-brand-50`}
      >
        <span className="relative">
          <Avatar name={user.name} username={user.username} avatarKey={user.avatarKey} size="sm" />
          {/* 未读角标：头像右上角，直角方块与站点像素语言一致 */}
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} 条未读通知`}
              className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-none bg-red-500 px-0.5 text-[9px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </span>
        <span className="hidden max-w-[8rem] truncate sm:block">{user.name ?? user.username}</span>
        <ChevronDown
          size={14}
          className={`text-neutral-400 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-none border border-brand-200 bg-surface p-1.5"
        >
          {/* 用户信息头 */}
          <div className="border-b border-neutral-100 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {user.name ?? user.username}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="truncate">@{user.username}</span>
              {user.role === "ADMIN" && (
                <span className="rounded-none bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                  ADMIN
                </span>
              )}
              {user.trusted && (
                <span className="rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                  免审
                </span>
              )}
            </p>
          </div>

          <div className="mt-1.5 grid gap-0.5">
            <Link href={`/u/${user.username}`} className={itemCls} onClick={() => setOpen(false)}>
              <User size={15} className="text-neutral-400" aria-hidden /> 个人主页
            </Link>
            <Link href="/notifications" className={itemCls} onClick={() => setOpen(false)}>
              <Bell size={15} className="text-neutral-400" aria-hidden /> 我的通知
              {unreadCount > 0 && (
                <span className="ml-auto rounded-none bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
            {showCoins && (
              <Link href="/me/coins" className={itemCls} onClick={() => setOpen(false)}>
                <Coins size={15} className="text-neutral-400" aria-hidden /> 我的代币
              </Link>
            )}
            <Link href="/settings" className={itemCls} onClick={() => setOpen(false)}>
              <Settings size={15} className="text-neutral-400" aria-hidden /> 账号设置
            </Link>
            <Link href="/upload" className={itemCls} onClick={() => setOpen(false)}>
              <Upload size={15} className="text-neutral-400" aria-hidden /> 发布内容
            </Link>
            {isStaff && (
              <Link href="/admin" className={itemCls} onClick={() => setOpen(false)}>
                <LayoutDashboard size={15} className="text-neutral-400" aria-hidden /> 管理后台
              </Link>
            )}
          </div>

          <div className="mt-1.5 border-t border-neutral-100 pt-1.5">
            <form action={logoutAction}>
              <Button type="submit" className={`${itemCls} text-neutral-500`}>
                <LogOut size={15} className="text-neutral-400" aria-hidden /> 退出登录
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
