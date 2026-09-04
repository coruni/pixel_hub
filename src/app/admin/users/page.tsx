import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { formatCount, timeAgo } from "@/lib/format";
import { UserActions } from "@/components/admin/buttons";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "用户管理" };

const roleLabel: Record<string, string> = { USER: "用户", MODERATOR: "版主", ADMIN: "管理员" };

export default async function UsersPage() {
 const session = await auth();
 const isAdmin = session?.user?.role === "ADMIN";
 // 全站用户列表（含邮箱等 PII）仅 ADMIN 可见；MODERATOR 直接输 URL 也不放行
 if (!isAdmin) redirect("/admin");
 const rows = await prisma.user.findMany({
 orderBy: { createdAt: "asc" },
 take: 500,
 include: { _count: { select: { resources: true } } },
 });

 return (
 <div>
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-lg font-medium text-neutral-900">用户（{rows.length}）</h2>
 </div>

 <div className="overflow-x-auto rounded-none border border-brand-200 bg-surface">
 <table className="w-full min-w-[760px] text-sm">
 <thead>
 <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400">
 <th className="px-4 py-2.5 font-medium">用户</th>
 <th className="px-4 py-2.5 font-medium">角色</th>
 <th className="px-4 py-2.5 font-medium">状态</th>
 <th className="px-4 py-2.5 font-medium">作品</th>
 <th className="px-4 py-2.5 font-medium">加入</th>
 {isAdmin && <th className="px-4 py-2.5 text-right font-medium">操作</th>}
 </tr>
 </thead>
 <tbody className="divide-y divide-neutral-100">
 {rows.map((u) => (
 <tr key={u.id} className="hover:bg-neutral-50/60">
 <td className="px-4 py-2.5">
 <Link href={`/u/${u.username}`} className="flex items-center gap-2.5">
 <span className="grid h-8 w-8 place-items-center rounded-none bg-neutral-200 text-xs font-semibold text-neutral-700">
 {(u.name ?? u.username).slice(0, 1).toUpperCase()}
 </span>
 <span>
 <span className="block font-medium text-neutral-900">{u.name ?? u.username}</span>
 <span className="block text-xs text-neutral-400">
 @{u.username}
 {isAdmin && ` · ${u.email}`}
 </span>
 </span>
 </Link>
 </td>
 <td className="px-4 py-2.5 text-neutral-700">{roleLabel[u.role]}</td>
 <td className="px-4 py-2.5">
 <div className="flex flex-wrap gap-1">
 {u.trusted && (
 <span className="rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">免审</span>
 )}
 {u.bannedAt ? (
 <span className="rounded-none bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">已封禁</span>
 ) : (
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">正常</span>
 )}
 {u.bannedReason && <span className="text-[10px] text-neutral-400">· {u.bannedReason}</span>}
 </div>
 </td>
 <td className="px-4 py-2.5 text-neutral-500">
 {formatCount(u._count.resources)} 作
 </td>
 <td className="px-4 py-2.5 text-xs text-neutral-400">{timeAgo(u.createdAt)}</td>
 {isAdmin && (
 <td className="px-4 py-2.5 text-right">
 <UserActions
 userId={u.id}
 isSelf={u.id === session?.user?.id}
 role={u.role}
 trusted={u.trusted}
 banned={!!u.bannedAt}
 />
 </td>
 )}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 );
}
