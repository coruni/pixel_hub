import Link from "next/link";
import { prisma } from "@/lib/db/prisma";

export const metadata = { title: "管理概览" };

export default async function AdminIndex() {
 const [pending, reports, published, removed, users, openReports] = await Promise.all([
 prisma.resource.count({ where: { status: "PENDING" } }),
 prisma.resource.count({ where: { status: "REJECTED" } }),
 prisma.resource.count({ where: { status: "PUBLISHED" } }),
 prisma.resource.count({ where: { status: "REMOVED" } }),
 prisma.user.count(),
 prisma.report.count({ where: { status: "OPEN" } }),
 ]);

 const cards = [
 { k: "待审核内容", v: pending, href: "/admin/queue", hl: pending > 0 },
 { k: "已上架内容", v: published, href: "/admin/content", hl: false },
 { k: "待处理举报", v: openReports, href: "/admin/reports", hl: openReports > 0 },
 { k: "注册用户", v: users, href: "/admin/users", hl: false },
 { k: "已下架", v: removed, href: "/admin/content?status=REMOVED", hl: false },
 { k: "已打回", v: reports, href: "/admin/content?status=REJECTED", hl: false },
 ];

 return (
 <div>
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
 {cards.map((c) => (
 <Link
 key={c.k}
 href={c.href}
 className={`rounded-none border p-4 transition ${
 c.hl ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-surface"
 }`}
 >
 <div className={`text-2xl font-semibold ${c.hl ? "text-amber-700" : "text-neutral-900"}`}>{c.v}</div>
 <div className="mt-0.5 text-xs text-neutral-500">{c.k}</div>
 </Link>
 ))}
 </div>

 {pending > 0 && (
 <div className="mt-6 rounded-none border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
 有 <b>{pending}</b> 条内容等待审核，<Link href="/admin/queue" className="underline">前往队列 →</Link>
 </div>
 )}
 {openReports > 0 && (
 <div className="mt-3 rounded-none border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
 有 <b>{openReports}</b> 条举报待处理，<Link href="/admin/reports" className="underline">前往处理 →</Link>
 </div>
 )}
 {pending === 0 && openReports === 0 && (
 <p className="mt-6 rounded-none border border-brand-200 bg-surface px-5 py-4 text-sm text-neutral-500">
 一切正常，暂无待办事项 ✨
 </p>
 )}
 </div>
 );
}
