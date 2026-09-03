import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { timeAgo } from "@/lib/format";
import { QueueActions } from "@/components/admin/buttons";

export const metadata = { title: "审核队列" };

const typeLabel: Record<string, string> = { GAME: "游戏", IMAGE: "图片" };

export default async function QueuePage() {
 const rows = await prisma.resource.findMany({
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

 return (
 <div>
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-lg font-medium text-neutral-900">待审核（{rows.length}）</h2>
 <span className="text-xs text-neutral-400">白名单用户（trusted）发布会直接上架，不进入此队列</span>
 </div>

 {rows.length === 0 ? (
 <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
 队列已清空 🎉
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
 </div>
 <p className="mt-1 text-xs text-neutral-500">
 作者{" "}
 <Link href={`/u/${r.author.username}`} className="hover:underline">
 {r.author.name ?? r.author.username}
 </Link>{" "}
 · {timeAgo(r.createdAt)}
 </p>
 {r.summary && <p className="mt-2 text-sm text-neutral-600">{r.summary}</p>}
 </div>
 <QueueActions resourceId={r.id} />
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
