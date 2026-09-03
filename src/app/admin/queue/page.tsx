import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { timeAgo } from "@/lib/format";
import { QueueActions } from "@/components/admin/buttons";
import SpotActions from "@/components/admin/spot-actions";

export const metadata = { title: "审核队列" };

const typeLabel: Record<string, string> = { GAME: "游戏", IMAGE: "图片", ARTICLE: "文章" };

type SP = Record<string, string | string[] | undefined>;

export default async function QueuePage({ searchParams }: { searchParams: Promise<SP> }) {
 const sp = await searchParams;
 // view=spot：trusted 用户直发（PUBLISHED）内容的事后抽查视图（DESIGN §6.4）
 const spot = sp.view === "spot";

 const rows = spot
 ? await prisma.resource.findMany({
 where: {
 status: "PUBLISHED",
 author: { trusted: true },
 publishedAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
 },
 orderBy: { publishedAt: "desc" },
 take: 50,
 include: {
 author: { select: { username: true, name: true } },
 category: { select: { name: true } },
 tags: { select: { tag: { select: { name: true } } } },
 media: {
 where: { resourceId: { not: null } },
 orderBy: { sort: "asc" },
 select: { id: true, storageKey: true, bigKey: true, thumbKey: true, width: true, height: true },
 },
 },
 })
 : await prisma.resource.findMany({
 where: { status: "PENDING" },
 orderBy: { createdAt: "asc" },
 include: {
 author: { select: { username: true, name: true } },
 category: { select: { name: true } },
 tags: { select: { tag: { select: { name: true } } } },
 media: {
 where: { resourceId: { not: null } },
 orderBy: { sort: "asc" },
 select: { id: true, storageKey: true, bigKey: true, thumbKey: true, width: true, height: true },
 },
 },
 });

 const tab = (active: boolean) =>
 `rounded-none border px-3 py-1.5 text-sm transition ${
 active
 ? "border-brand-600 bg-brand-500 text-white"
 : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
 }`;

 return (
 <div>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <Link href="/admin/queue" className={tab(!spot)}>
 待审核
 </Link>
 <Link href="/admin/queue?view=spot" className={tab(spot)}>
 直发抽查
 </Link>
 </div>
 <span className="text-xs text-neutral-400">
 {spot ? "可信用户（trusted）近 7 日直发内容，事后抽查；异常可直接下架" : "白名单用户（trusted）发布会直接上架，不进入此队列"}
 </span>
 </div>

 {rows.length === 0 ? (
 <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
 {spot ? "近 7 日没有可信用户的直发内容" : "队列已清空 🎉"}
 </p>
 ) : (
 <ul className="space-y-4">
 {rows.map((r) => (
 <li key={r.id} className="rounded-none border border-brand-200 bg-surface p-4">
 <div className="flex flex-wrap items-start gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <Link href={`/resources/${r.slug}`} className="text-base font-semibold text-neutral-900 hover:underline">
 {r.title}
 </Link>
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
 {typeLabel[r.type]}
 </span>
 {r.category && <span className="text-xs text-neutral-400">{r.category.name}</span>}
 {spot && (
 <span className="rounded-none border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
 直发
 </span>
 )}
 </div>
 <p className="mt-1 text-xs text-neutral-500">
 作者{" "}
 <Link href={`/u/${r.author.username}`} className="hover:underline">
 {r.author.name ?? r.author.username}
 </Link>{" "}
 · {timeAgo(spot ? r.publishedAt ?? r.createdAt : r.createdAt)}
 </p>
 {r.summary && <p className="mt-2 text-sm text-neutral-600">{r.summary}</p>}
 </div>
 {spot ? <SpotActions resourceId={r.id} /> : <QueueActions resourceId={r.id} />}
 </div>

 {/* 预览图：点击新窗口看原图核对 */}
 {r.media.length > 0 ? (
 <div className="mt-3 flex flex-wrap gap-2">
 {r.media.map((m, i) => (
 <a
 key={m.id}
 href={publicUrl(m.storageKey)}
 target="_blank"
 rel="noreferrer"
 title="新窗口打开原图"
 className="group relative block h-20 w-28 shrink-0 overflow-hidden rounded-none border border-brand-200 bg-neutral-100"
 >
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img
 src={publicUrl(m.bigKey ?? m.storageKey)}
 alt=""
 className="h-full w-full object-cover"
 />
 {i === 0 && (
 <span className="absolute left-1 top-1 rounded-none border border-brand-600 bg-brand-500 px-1 text-[9px] font-medium text-white">封面</span>
 )}
 <span className="absolute inset-0 grid place-items-center bg-black/0 text-[10px] text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
 查看原图 ↗
 </span>
 </a>
 ))}
 </div>
 ) : (
 <p className="mt-3 text-xs text-neutral-400">无预览图（纯外链内容）</p>
 )}
 </li>
 ))}
 </ul>
 )}
 </div>
 );
}
