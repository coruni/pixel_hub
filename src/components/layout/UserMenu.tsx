"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LayoutDashboard, LogOut, Bell, Settings, Upload, User } from "lucide-react";
import { logoutAction } from "@/lib/actions";
import Avatar from "@/components/ui/Avatar";

export type MenuUser = {
 name: string | null;
 username: string;
 role: string;
 trusted: boolean;
 avatarKey?: string | null;
};

/** 顶部导航右侧的用户菜单：头像 + 下拉（个人主页/通知/设置/发布/管理/退出） */
export default function UserMenu({ user }: { user: MenuUser }) {
 const [open, setOpen] = useState(false);
 const boxRef = useRef<HTMLDivElement>(null);

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
 <button
 type="button"
 onClick={() => setOpen((v) => !v)}
 aria-haspopup="menu"
 aria-expanded={open}
 className="flex items-center gap-1.5 rounded-none py-1 pl-1 pr-2 text-sm text-neutral-700 transition hover:bg-brand-50"
 >
 <Avatar name={user.name} username={user.username} avatarKey={user.avatarKey} size="sm" />
 <span className="hidden max-w-[8rem] truncate sm:block">{user.name ?? user.username}</span>
 <ChevronDown size={14} className={`text-neutral-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
 </button>

 {open && (
 <div
 role="menu"
 className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-none border border-brand-200 bg-surface p-1.5"
 >
 {/* 用户信息头 */}
 <div className="border-b border-neutral-100 px-3 py-2.5">
 <p className="truncate text-sm font-semibold text-neutral-900">{user.name ?? user.username}</p>
 <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
 <span className="truncate">@{user.username}</span>
 {user.role === "ADMIN" && (
 <span className="rounded-none bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">ADMIN</span>
 )}
 {user.trusted && (
 <span className="rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">免审</span>
 )}
 </p>
 </div>

 <div className="mt-1.5 grid gap-0.5">
 <Link href={`/u/${user.username}`} className={itemCls} onClick={() => setOpen(false)}>
 <User size={15} className="text-neutral-400" aria-hidden /> 个人主页
 </Link>
 <Link href="/notifications" className={itemCls} onClick={() => setOpen(false)}>
 <Bell size={15} className="text-neutral-400" aria-hidden /> 我的通知
 </Link>
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
 <button type="submit" className={`${itemCls} text-neutral-500`}>
 <LogOut size={15} className="text-neutral-400" aria-hidden /> 退出登录
 </button>
 </form>
 </div>
 </div>
 )}
 </div>
 );
}
