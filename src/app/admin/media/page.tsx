import Link from "next/link";
import { FileArchive } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { formatCount, timeAgo } from "@/lib/format";
import { enumParam, intParam, str, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import { MediaDeleteButton, MediaUploadForm } from "@/components/admin/media";
import { MediaThumb } from "@/components/admin/MediaThumb";
import {
  MediaOrphanCheckbox,
  MediaOrphanProvider,
  MediaOrphanToolbar,
} from "@/components/admin/media-orphan";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import type { Metadata } from "next";
import { BTN_FILTER, INPUT_FILTER } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "媒体库" };

const kindLabel: Record<string, string> = {
  COVER: "封面",
  GALLERY: "图集",
  ORIGINAL: "原图",
  ATTACHMENT: "附件",
};
const KINDS = ["COVER", "GALLERY", "ORIGINAL", "ATTACHMENT"] as const;
const STATUSES = ["PENDING_PROCESS", "READY", "FAILED"] as const;
const statusLabel: Record<string, string> = {
  PENDING_PROCESS: "处理中",
  READY: "就绪",
  FAILED: "失败",
};

export default async function MediaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";
  const fileName = (str(sp, "fileName") ?? "").trim().slice(0, 120);
  const user = (str(sp, "user") ?? "").trim().slice(0, 60);
  const kindRaw = str(sp, "kind");
  const kind = (KINDS as readonly string[]).includes(kindRaw ?? "")
    ? (kindRaw as (typeof KINDS)[number])
    : undefined;
  const statusRaw = str(sp, "status");
  const status = (STATUSES as readonly string[]).includes(statusRaw ?? "")
    ? (statusRaw as (typeof STATUSES)[number])
    : undefined;
  const orphan = str(sp, "orphan") === "1" ? "1" : "";
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const where = {
    ...(fileName ? { fileName: { contains: fileName, mode: "insensitive" as const } } : {}),
    ...(user ? { uploader: { username: { contains: user, mode: "insensitive" as const } } } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    // 孤儿：既不在资源图集/封面里，也不属于评论附图（头像引用无法用 where 表达，由删除动作再查一次）
    ...(orphan ? { resourceId: null, commentId: null, coverOf: { none: {} } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.media.findMany({
      where,
      orderBy: [...STABLE_NEWEST],
      skip: (page - 1) * pageSize,
      take: pageSize,
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

  const base = {
    fileName: fileName || undefined,
    user: user || undefined,
    kind: kind || undefined,
    status: status || undefined,
    orphan: orphan || undefined,
    ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };
  const hasMore = (page - 1) * pageSize + rows.length < total;
  const href = (p: number) => `/admin/media${adminQuery(base, { page: String(p) })}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-neutral-900">媒体库（{formatCount(total)}）</h2>
        {isAdmin && <MediaUploadForm />}
      </div>

      {/* 过滤：文件名 / 上传者 / 类型 / 处理状态 / 孤儿 */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="media-file">
          文件名
        </label>
        <input
          id="media-file"
          name="fileName"
          defaultValue={fileName}
          placeholder="文件名"
          className={`${INPUT_FILTER} w-44`}
        />
        <label className="sr-only" htmlFor="media-user">
          上传者
        </label>
        <input
          id="media-user"
          name="user"
          defaultValue={user}
          placeholder="上传者用户名"
          className={`${INPUT_FILTER} w-36`}
        />
        <label className="sr-only" htmlFor="media-kind">
          媒体类型
        </label>
        <select id="media-kind" name="kind" defaultValue={kind} className={INPUT_FILTER}>
          <option value="">全部类型</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel[k]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="media-status">
          处理状态
        </label>
        <select id="media-status" name="status" defaultValue={status} className={INPUT_FILTER}>
          <option value="">全部状态</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <SquareCheckbox name="orphan" value="1" defaultChecked={orphan === "1"} ariaLabel="仅未关联" />
          仅未关联（孤儿）
        </label>
        <Button
          type="submit"
          className={BTN_FILTER}
        >
          筛选
        </Button>
        {(fileName || user || kind || status || orphan) && (
          <Link
            href="/admin/media"
            className="text-xs text-neutral-400 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            清空筛选
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-400">
          没有匹配的媒体
        </div>
      ) : (
        <MediaOrphanProvider ids={rows.filter((m) => !isUsed(m)).map((m) => m.id)}>
          {isAdmin && <MediaOrphanToolbar />}
          <div className="overflow-x-auto rounded-none border border-brand-200 bg-surface">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400">
                  <th className="w-16 px-3 py-2.5 text-center font-medium">选择</th>
                  <th className="px-4 py-2.5 font-medium">预览</th>
                  <th className="px-4 py-2.5 font-medium">文件</th>
                  <th className="px-4 py-2.5 font-medium">尺寸 / 大小</th>
                  <th className="px-4 py-2.5 font-medium">所属内容</th>
                  <th className="px-4 py-2.5 font-medium">上传</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((m) => {
                  const used = isUsed(m);
                  const url = publicUrl(m.thumbKey ?? m.storageKey);
                  const bigUrl = publicUrl(m.bigKey ?? m.storageKey);
                  return (
                    <tr key={m.id} className="hover:bg-neutral-50/60">
                      <td className="w-16 px-3 py-2 text-center align-middle">
                        {!used && isAdmin ? (
                          <MediaOrphanCheckbox id={m.id} fileName={m.fileName} />
                        ) : (
                          <span className="text-xs text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {/* 附件（zip 等）：非图片不请求缩略图/查看器，显示中性文件图标 */}
                        {m.kind === "ATTACHMENT" ? (
                          <span
                            className="grid h-12 w-12 place-items-center rounded-none border border-brand-200 bg-neutral-100 text-neutral-400"
                            title={m.fileName ?? "附件"}
                          >
                            <FileArchive size={20} aria-hidden />
                          </span>
                        ) : (
                          <MediaThumb url={url} bigUrl={bigUrl} fileName={m.fileName} />
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block max-w-56 truncate font-medium text-neutral-900">
                          {m.fileName ?? "—"}
                        </span>
                        <span className="block text-xs text-neutral-400">
                          {kindLabel[m.kind]} · {statusLabel[m.status] ?? m.status}
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
                          <Link
                            href={`/resources/${m.resource.slug}`}
                            className="text-brand-700 hover:underline"
                          >
                            <span className="block max-w-44 truncate">{m.resource.title}</span>
                            <span className="block text-xs text-neutral-400">
                              @{m.resource.author.username}
                            </span>
                          </Link>
                        ) : m.comment ? (
                          // 评论附图：链接到所属资源页并定位到评论区，附评论摘要与作者
                          <Link
                            href={`/resources/${m.comment.resource.slug}#comments`}
                            className="text-brand-700 hover:underline"
                          >
                            <span className="block max-w-44 truncate text-sm">
                              {m.comment.resource.title}
                            </span>
                            <span className="block text-xs text-neutral-400">
                              评论 @{m.comment.author.name ?? m.comment.author.username}
                            </span>
                            <span className="block max-w-44 truncate text-xs text-neutral-400">
                              {m.comment.content}
                            </span>
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
        </MediaOrphanProvider>
      )}

      <TableFooter
        page={page}
        hasMore={hasMore}
        total={total}
        pageSize={pageSize}
        href={href}
      />
    </div>
  );
}

/** 被资源（封面/图集）或评论引用 = 使用中，不可选也不可单条删除 */
function isUsed(m: { resourceId: string | null; commentId: string | null; _count: { coverOf: number } }) {
  return !!m.resourceId || !!m.commentId || (m._count.coverOf ?? 0) > 0;
}
