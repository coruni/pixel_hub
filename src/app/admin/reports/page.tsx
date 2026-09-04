import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { timeAgo } from "@/lib/format";
import { enumParam, type SP } from "@/lib/search-params";
import { ReportActions } from "@/components/admin/buttons";

export const metadata: Metadata = { title: "举报处理" };

const stLabel: Record<string, { text: string; cls: string }> = {
 OPEN: { text: "待处理", cls: "bg-red-50 text-red-600" },
 RESOLVED: { text: "已处理", cls: "bg-emerald-50 text-emerald-600" },
 DISMISSED: { text: "已驳回", cls: "bg-neutral-100 text-neutral-500" },
};
const typeText: Record<string, string> = { RESOURCE: "资源", COMMENT: "评论", USER: "用户" };

const REPORT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
 const sp = await searchParams;
 const status = enumParam(sp, "status", REPORT_STATUSES, "OPEN");

 const rows = await prisma.report.findMany({
 where: { status },
 orderBy: { createdAt: "asc" },
 take: 400,
 });
 type Row = (typeof rows)[number];

 // Report 关联均为标量，二次查询补可读名称（reporterId 可空：举报人删号后显示匿名）
 const reporterIds = [...new Set(rows.map((r) => r.reporterId).filter((x): x is string => !!x))];
 const reporterMap = new Map(
 (reporterIds.length
 ? await prisma.user.findMany({ where: { id: { in: reporterIds } }, select: { id: true, username: true, name: true } })
 : []
 ).map((u) => [u.id, u] as const)
 );
 const resIds = [...new Set(rows.filter((r) => r.type === "RESOURCE" && r.targetResourceId).map((r) => r.targetResourceId!))];
 const resMap = new Map(
 (resIds.length
 ? await prisma.resource.findMany({ where: { id: { in: resIds } }, select: { id: true, slug: true, title: true, status: true } })
 : []
 ).map((r) => [r.id, r] as const)
 );
 const uidTargets = [...new Set(rows.filter((r) => r.type === "USER" && r.targetUserId).map((r) => r.targetUserId!))];
 const userMap = new Map(
 (uidTargets.length
 ? await prisma.user.findMany({ where: { id: { in: uidTargets } }, select: { id: true, username: true } })
 : []
 ).map((u) => [u.id, u] as const)
 );

 // 同目标合并为一张卡：RESOURCE→按资源 / COMMENT→按评论 / USER→按用户
 const keyOf = (r: Row) =>
 r.type === "RESOURCE"
 ? `R:${r.targetResourceId}`
 : r.type === "COMMENT"
 ? `C:${r.targetCommentId}`
 : `U:${r.targetUserId}`;
 const groups = new Map<string, Row[]>();
 for (const r of rows) {
 const k = keyOf(r);
 const g = groups.get(k);
 if (g) g.push(r);
 else groups.set(k, [r]);
 }
 // 加权排序：同类举报越多越靠前；同权重时 OPEN 按最旧优先（先来先处理），历史按最新优先
 const list = [...groups.values()].sort((a, b) => {
 const dc = b.length - a.length;
 if (dc !== 0) return dc;
 const ta = a[0].createdAt.getTime();
 const tb = b[0].createdAt.getTime();
 return status === "OPEN" ? ta - tb : tb - ta;
 });

 const chip = (s: string) =>
 `rounded-none px-3 py-1 text-xs transition ${
 status === s ? "bg-brand-500 text-white" : "border border-brand-200 bg-surface text-neutral-500 hover:border-brand-500"
 }`;

 const describe = (r: Row): { href?: string; text: string } => {
 if (r.type === "RESOURCE" && r.targetResourceId) {
 const res = resMap.get(r.targetResourceId);
 return res ? { href: `/resources/${res.slug}`, text: `「${res.title}」` } : { text: "资源已不存在" };
 }
 if (r.type === "USER" && r.targetUserId) {
 const u = userMap.get(r.targetUserId);
 return u ? { href: `/u/${u.username}`, text: `@${u.username}` } : { text: "用户已不存在" };
 }
 return { text: `评论 #${(r.targetCommentId ?? "").slice(-6)}` };
 };

 return (
 <div>
 <div className="mb-4 flex flex-wrap gap-2">
 {REPORT_STATUSES.map((s) => (
 <Link key={s} href={`/admin/reports?status=${s}`} className={chip(s)}>
 {stLabel[s].text}
 </Link>
 ))}
 </div>

 {list.length === 0 ? (
 <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
 没有此类举报
 </p>
 ) : (
 <ul className="space-y-3">
 {list.map((group) => {
 const first = group[0];
 const target = describe(first);
 const st = stLabel[first.status];
 const isRes = first.type === "RESOURCE" && first.targetResourceId;
 const resStatus = isRes ? resMap.get(first.targetResourceId!)?.status ?? null : null;
 const actionsId = first.targetResourceId ?? first.targetCommentId ?? first.targetUserId ?? null;
 return (
 <li key={keyOf(first)} className="rounded-none border border-brand-200 bg-surface p-4">
 <div className="flex flex-wrap items-center gap-2 text-sm">
 <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.text}</span>
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">{typeText[first.type]}</span>
 {group.length > 1 && (
 <span className="rounded-none bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
 同类举报 ×{group.length}
 </span>
 )}
 {target.href ? (
 <Link href={target.href} className="font-medium text-neutral-900 hover:underline">
 {target.text}
 </Link>
 ) : (
 <span className="font-medium text-neutral-900">{target.text}</span>
 )}
 </div>

 <ul className="mt-2 divide-y divide-neutral-100">
 {group.map((r) => {
 const rep = r.reporterId ? reporterMap.get(r.reporterId) : undefined;
 return (
 <li key={r.id} className="py-2 text-sm first:pt-1.5 last:pb-0">
 <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">理由：{r.reason}</span>
 <span>
 举报人：
 {rep ? (
 <Link href={`/u/${rep.username}`} className="text-neutral-500 hover:underline">
 {rep.name ?? rep.username}
 </Link>
 ) : (
 "匿名"
 )}
 </span>
 <span>{timeAgo(r.createdAt)}</span>
 </div>
 {r.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-500">{r.detail}</p>}
 </li>
 );
 })}
 </ul>

 {first.status === "OPEN" && (
 <div className="mt-3 border-t border-neutral-100 pt-3">
 <ReportActions type={first.type} targetId={actionsId} resourceStatus={resStatus} />
 </div>
 )}
 </li>
 );
 })}
 </ul>
 )}
 </div>
 );
}
