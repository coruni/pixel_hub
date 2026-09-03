import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { formatCount, timeAgo } from "@/lib/format";
import { MediaDeleteButton, MediaUploadForm } from "@/components/admin/media";
import { MediaThumb } from "@/components/admin/MediaThumb";

export const metadata = { title: "媒体库" };

const PAGE_SIZE = 30;

const kindLabel: Record<string, string> = {
 COVER: "封面",
 GALLERY: "图集",
 ORIGINAL: "原图",
 ATTACHMENT: "附件",
};

export default async function MediaPage({
 searchParams,
}: {
 searchParams: Promise<{ page?: string; user?: string; orphan?: string }>;
}) {
 const { page: pageRaw, user, orphan } = await searchParams;
 const session = await auth();
 const isAdmin = session?.user?.role === "ADMIN";
 const page = Math.max(1, Number(pageRaw) || 1);
 const username = (user ?? "").trim();

 // 过滤：按上传者（经所属资源的作者）/ 仅未关联媒体的孤儿
 const where = {
 ...(username ? { resource: { author: { username } } } : {}),
 ...(orphan === "1" ? { resourceId: null, commentId: null } : {}),
 };

 const [rows, total] = await Promise.all([
 prisma.media.findMany({
 where,
 orderBy: { createdAt: "desc" },
 skip: (page - 1) * PAGE_SIZE,
 take: PAGE_SIZE + 1,
 select: {
 id: true,
 kind: true,
 storageKey: true,
 thumbKey: true,
 bigKey: true,
 width: true,
 height: true,
 size: true,
 fileName: true,
 status: true,
 createdAt: true,
 resourceId: true,
 commentId: true,
 resource: { select: { slug: true, title: true, author: { select: { username: true } } } },
 comment: {
 select: {
 content: true,
 createdAt: true,
 resource: { select: { slug: true, title: true } },
 author: { select: { username: true, name: true } },
 },
 },
 _count: { select: { coverOf: true } },
 },
 }),
 prisma.media.count({ where }),
 ]);
 const hasMore = rows.length > PAGE_SIZE;
 const list = rows.slice(0, PAGE_SIZE);

 const query = (over: Record<string, string | undefined>) => {
 const params = new URLSearchParams();
 const merged = { user: username || undefined, orphan: orphan === "1" ? "1" : undefined, ...over };
 for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
 const qs = params.toString();
 return `/admin/media${qs ? `?${qs}` : ""}`;
 };

 const input =
 "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand-500";

 return (
 <div>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
 <h2 className="text-lg font-medium text-neutral-900">媒体库（{formatCount(total)}）</h2>
 {isAdmin && <MediaUploadForm />}
 </div>

 {/* 过滤：上传者 / 孤儿媒体 */}
 <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
 <input
 name="user"
 defaultValue={username}
 placeholder="按上传者用户名过滤"
 className={`${input} w-48 text-xs`}
 />
 <label className="flex items-center gap-1.5 text-xs text-neutral-600">
 <input type="checkbox" name="orphan" value="1" defaultChecked={orphan === "1"} className="accent-brand-500" />
 仅未关联（孤儿）
 </label>
 <button type="submit" className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 hover:border-brand-500">
 筛选
 </button>
 </form>

 {list.length === 0 ? (
 <div className="grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-400">
 没有匹配的媒体
 </div>
 ) : (
 <div className="overflow-x-auto rounded-none border border-brand-200 bg-surface">
 <table className="w-full min-w-[820px] text-sm">
 <thead>
 <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400">
 <th className="px-4 py-2.5 font-medium">预览</th>
 <th className="px-4 py-2.5 font-medium">文件</th>
 <th className="px-4 py-2.5 font-medium">尺寸 / 大小</th>
 <th className="px-4 py-2.5 font-medium">所属内容</th>
 <th className="px-4 py-2.5 font-medium">上传</th>
 <th className="px-4 py-2.5 text-right font-medium">操作</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-neutral-100">
 {list.map((m) => {
 const used = !!m.resourceId || !!m.commentId || (m._count.coverOf ?? 0) > 0;
 const url = publicUrl(m.thumbKey ?? m.storageKey);
 const bigUrl = publicUrl(m.bigKey ?? m.storageKey);
 return (
 <tr key={m.id} className="hover:bg-neutral-50/60">
 <td className="px-4 py-2">
 <MediaThumb url={url} bigUrl={bigUrl} fileName={m.fileName} />
 </td>
 <td className="px-4 py-2.5">
 <span className="block max-w-56 truncate font-medium text-neutral-900">{m.fileName ?? "—"}</span>
 <span className="block text-xs text-neutral-400">
 {kindLabel[m.kind]} · {m.status === "READY" ? "就绪" : m.status}
 </span>
 </td>
 <td className="px-4 py-2.5 text-neutral-500">
 {m.width && m.height ? `${m.width}×${m.height}` : "—"}
 <span className="block text-xs text-neutral-400">
 {m.size ? `${(m.size / 1024).toFixed(0)} KB` : "—"}
 </span>
 </td>
 <td className="px-4 py-2.5">
 {m.resource ? (
 <Link href={`/resources/${m.resource.slug}`} className="text-brand-700 hover:underline">
 <span className="block max-w-44 truncate">{m.resource.title}</span>
 <span className="block text-xs text-neutral-400">@{m.resource.author.username}</span>
 </Link>
 ) : m.comment ? (
 // 评论附图：链接到所属资源页并定位到评论区，附评论摘要与作者
 <Link href={`/resources/${m.comment.resource.slug}#comments`} className="text-brand-700 hover:underline">
 <span className="block max-w-44 truncate text-sm">{m.comment.resource.title}</span>
 <span className="block text-xs text-neutral-400">
 评论 @{m.comment.author.name ?? m.comment.author.username}
 </span>
 <span className="block max-w-44 truncate text-xs text-neutral-400">{m.comment.content}</span>
 </Link>
 ) : (
 <span className="text-xs text-neutral-400">未关联</span>
 )}
 </td>
 <td className="px-4 py-2.5 text-xs text-neutral-400">{timeAgo(m.createdAt)}</td>
 <td className="px-4 py-2.5 text-right">
 <MediaDeleteButton mediaId={m.id} used={used} />
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}

 {(page > 1 || hasMore) && (
 <div className="mt-6 flex items-center justify-center gap-3 text-sm">
 {page > 1 && (
 <Link
 href={query({ page: String(page - 1) })}
 className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm text-neutral-700 hover:border-brand-500"
 >
 上一页
 </Link>
 )}
 <span className="text-xs text-neutral-400">第 {page} 页</span>
 {hasMore && (
 <Link
 href={query({ page: String(page + 1) })}
 className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm text-neutral-700 hover:border-brand-500"
 >
 下一页
 </Link>
 )}
 </div>
 )}
 </div>
 );
}
