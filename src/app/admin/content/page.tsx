import Link from "next/link";
import { Download, Heart, MessageSquare } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { formatCount, timeAgo } from "@/lib/format";
import { ContentActions } from "@/components/admin/buttons";

export const metadata = { title: "内容库" };

const typeLabel: Record<string, string> = { GAME: "游戏", IMAGE: "图片" };
const statusLabel: Record<string, { text: string; cls: string }> = {
 PUBLISHED: { text: "已上架", cls: "bg-emerald-50 text-emerald-600" },
 PENDING: { text: "待审核", cls: "bg-amber-50 text-amber-600" },
 REJECTED: { text: "已打回", cls: "bg-neutral-100 text-neutral-500" },
 REMOVED: { text: "已下架", cls: "bg-red-50 text-red-600" },
 DRAFT: { text: "草稿", cls: "bg-neutral-100 text-neutral-500" },
};

type SP = Record<string, string | string[] | undefined>;
export default async function ContentPage({ searchParams }: { searchParams: Promise<SP> }) {
 const sp = await searchParams;
 const statusRaw = typeof sp.status === "string" ? sp.status : "PUBLISHED";
 const status = (["PUBLISHED", "PENDING", "REJECTED", "REMOVED", "DRAFT"] as const).includes(statusRaw as never)
 ? (statusRaw as "PUBLISHED" | "PENDING" | "REJECTED" | "REMOVED" | "DRAFT")
 : "PUBLISHED";

 const rows = await prisma.resource.findMany({
 where: { status },
 orderBy: { createdAt: "desc" },
 take: 200,
 include: {
 author: { select: { username: true, name: true } },
 coverMedia: { select: { storageKey: true, bigKey: true, thumbKey: true } },
 media: {
 where: { resourceId: { not: null } },
 orderBy: { sort: "asc" },
 take: 1,
 select: { storageKey: true, bigKey: true, thumbKey: true },
 },
 },
 });

 const chip = (s: string) =>
 `rounded-none px-3 py-1 text-xs transition ${
 status === s ? "bg-brand-500 text-white" : "bg-surface text-neutral-500 border border-brand-200 hover:border-brand-500"
 }`;

 return (
 <div>
 <div className="mb-4 flex flex-wrap gap-2">
 {(["PUBLISHED", "PENDING", "REJECTED", "REMOVED", "DRAFT"] as const).map((s) => (
 <Link key={s} href={`/admin/content?status=${s}`} className={chip(s)}>
 {statusLabel[s]?.text ?? s}
 </Link>
 ))}
 </div>

 {rows.length === 0 ? (
 <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
 暂无内容
 </p>
 ) : (
 <ul className="divide-y divide-neutral-100 rounded-none border border-brand-200 bg-surface">
 {rows.map((r) => {
 const thumb = r.coverMedia ?? r.media[0];
 const st = statusLabel[r.status];
 return (
 <li key={r.id} className="flex items-center gap-3 px-4 py-3">
 <a href={thumb ? publicUrl(thumb.bigKey ?? thumb.storageKey) : undefined} target="_blank" rel="noreferrer">
 {thumb ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={publicUrl(thumb.thumbKey ?? thumb.bigKey ?? thumb.storageKey)} alt="" className="h-12 w-16 rounded-none border border-brand-200 object-cover" />
 ) : (
 <span className="grid h-12 w-16 place-items-center rounded-none bg-neutral-100 text-xs text-neutral-400">无图</span>
 )}
 </a>
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <Link href={`/resources/${r.slug}`} className="truncate text-sm font-medium text-neutral-900 hover:underline">
 {r.title}
 </Link>
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">{typeLabel[r.type]}</span>
 {st && <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>{st.text}</span>}
 </div>
 <p className="mt-0.5 truncate text-xs text-neutral-400">
 {r.author.name ?? r.author.username} · {timeAgo(r.createdAt)} ·{" "}
 <Heart size={11} className="mb-0.5 inline" /> {formatCount(r.likeCount)} ·{" "}
 <MessageSquare size={11} className="mb-0.5 inline" /> {formatCount(r.commentCount)} ·{" "}
 <Download size={11} className="mb-0.5 inline" /> {formatCount(r.downloadCount)}
 {r.rejectReason && <span className="text-amber-600"> · 打回：{r.rejectReason}</span>}
 </p>
 </div>
 <ContentActions resourceId={r.id} status={r.status} />
 </li>
 );
 })}
 </ul>
 )}
 </div>
 );
}
